import type { WeatherState } from "../domain/weather";

/**
 * Ambient sound, synthesised rather than sampled. Six states, no audio files,
 * nothing to download and nothing to license.
 *
 * Browser autoplay policy means this can only ever start from a user gesture,
 * so the sound toggle in the header is what creates the AudioContext.
 */

type Voice = { stop: () => void; gain: GainNode };

/** Broadband noise, the raw material for rain, wind and rumble. */
function noiseBuffer(ctx: AudioContext, seconds = 3): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Pink-ish noise: white noise integrated then differenced reads as weather
  // rather than as static.
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

function noiseSource(ctx: AudioContext, buf: AudioBuffer, loop = true): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = loop;
  return s;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private state: WeatherState = "sunny";
  private target = 0;
  private timer: number | null = null;
  private buf: AudioBuffer | null = null;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Must be called from a user gesture handler. */
  async start(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.buf = noiseBuffer(this.ctx);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.build();
  }

  stop(): void {
    this.target = 0;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.fadeOutAndClear();
  }

  setState(next: WeatherState): void {
    if (next === this.state) return;
    this.state = next;
    if (this.ctx) this.build();
  }

  /** 0 = silent, 1 = full. Kept low on purpose; this plays under a page of text. */
  setVolume(v: number): void {
    this.target = Math.max(0, Math.min(1, v)) * 0.16;
    this.rampMaster();
  }

  private rampMaster(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.target, t, 0.6);
  }

  private fadeOutAndClear(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.35);
    const dying = this.voices;
    this.voices = [];
    setTimeout(() => {
      for (const v of dying) {
        try {
          v.stop();
        } catch {
          /* already stopped */
        }
      }
    }, 1400);
  }

  private clearVoices(): void {
    for (const v of this.voices) {
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
    }
    this.voices = [];
  }

  /** Rebuild the voices for the current state. Cheap enough to do on change. */
  private build(): void {
    if (!this.ctx || !this.master || !this.buf) return;
    this.clearVoices();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const ctx = this.ctx;
    const out = this.master;
    const buf = this.buf;

    const layer = (
      build: (src: AudioBufferSourceNode, dest: AudioNode) => void,
      level: number,
    ): void => {
      const src = noiseSource(ctx, buf);
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(g);
      g.connect(out);
      build(src, g);
      src.start();
      this.voices.push({ stop: () => { try { src.stop(); } catch { /* noop */ } }, gain: g });
    };

    switch (this.state) {
      case "rain":
      case "thunderstorm": {
        // Hiss: bandpassed noise sitting in the midrange.
        layer((src, dest) => {
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = this.state === "thunderstorm" ? 900 : 1600;
          bp.Q.value = 0.6;
          src.disconnect();
          src.connect(bp);
          bp.connect(dest as AudioNode);
        }, this.state === "thunderstorm" ? 0.55 : 0.4);

        if (this.state === "thunderstorm") {
          // Low rumble under the hiss.
          layer((src, dest) => {
            const lp = ctx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 110;
            src.disconnect();
            src.connect(lp);
            lp.connect(dest as AudioNode);
          }, 0.5);
          this.scheduleThunder();
        }
        break;
      }
      case "cloudy":
      case "fog": {
        // Muffled air. Fog is darker and flatter than cloud.
        layer((src, dest) => {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = this.state === "fog" ? 240 : 420;
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfo.frequency.value = 0.07;
          lfoGain.gain.value = this.state === "fog" ? 40 : 90;
          lfo.connect(lfoGain);
          lfoGain.connect(lp.frequency);
          lfo.start();
          src.disconnect();
          src.connect(lp);
          lp.connect(dest as AudioNode);
        }, this.state === "fog" ? 0.45 : 0.22);
        break;
      }
      case "night": {
        layer((src, dest) => {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 300;
          src.disconnect();
          src.connect(lp);
          lp.connect(dest as AudioNode);
        }, 0.12);
        this.scheduleCrickets();
        break;
      }
      case "sunny":
      default: {
        // Barely-there breeze so a clear day is not silent.
        layer((src, dest) => {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 340;
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfo.frequency.value = 0.05;
          lfoGain.gain.value = 120;
          lfo.connect(lfoGain);
          lfoGain.connect(lp.frequency);
          lfo.start();
          src.disconnect();
          src.connect(lp);
          lp.connect(dest as AudioNode);
        }, 0.1);
        break;
      }
    }
  }

  private blip(freq: number, dur: number, level: number, type: OscillatorType = "sine"): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private rumble(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || !this.buf) return;
    const src = noiseSource(ctx, this.buf, false);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 2.4);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(lp);
    lp.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + 2.8);
  }

  private scheduleThunder(): void {
    const next = 4500 + Math.random() * 11000;
    this.timer = window.setTimeout(() => {
      if (this.state === "thunderstorm") this.rumble();
      this.scheduleThunder();
    }, next);
  }

  private scheduleCrickets(): void {
    const chirp = () => {
      if (this.state !== "night") return;
      const f = 4200 + Math.random() * 900;
      for (let i = 0; i < 3; i++) {
        window.setTimeout(() => this.blip(f, 0.045, 0.1, "triangle"), i * 70);
      }
    };
    this.timer = window.setInterval(chirp, 900 + Math.random() * 700);
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
