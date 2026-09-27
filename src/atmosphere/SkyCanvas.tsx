import { useRef } from "react";
import { live, qualityTier } from "./derive";
import { mulberry32 } from "../lib/prng";
import { useAnimationLoop, useCanvasSurface } from "./useCanvasSurface";

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  phase: number;
  /** Slight colour temperature variation so the field is not uniformly white. */
  warm: number;
}

interface Cloud {
  sprite: number;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  speed: number;
  /** High cirrus drifts faster and thinner than low cumulus. */
  band: 0 | 1;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  a: number;
  spd: number;
  phase: number;
}

/**
 * A broad, soft mass rather than a puff. Many overlapping low-alpha lobes with
 * a wide falloff read as vapour; a few tight bright ones read as a cartoon.
 */
function darken(src: HTMLCanvasElement, alpha: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = `rgba(9,12,19,${alpha})`;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function makeCloudSprite(rng: () => number, soft: boolean): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size / 2;
  const g = c.getContext("2d")!;
  const lobes = soft ? 16 + Math.floor(rng() * 8) : 11 + Math.floor(rng() * 5);
  const peak = soft ? 0.2 : 0.34;
  for (let i = 0; i < lobes; i++) {
    // Squash lobes toward a horizontal band so the mass looks wind-combed.
    const t = i / (lobes - 1);
    const px = 60 + t * (size - 120) + (rng() - 0.5) * 70;
    const bell = Math.sin(t * Math.PI);
    const py = size / 4 + (rng() - 0.5) * 30 * bell;
    const pr = (28 + rng() * 40) * (0.45 + bell * 0.9);
    const grad = g.createRadialGradient(px, py, 0, px, py, pr);
    grad.addColorStop(0, `rgba(255,255,255,${peak})`);
    grad.addColorStop(0.45, `rgba(255,255,255,${peak * 0.45})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function SkyCanvas({ motion }: { motion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useCanvasSurface(canvasRef);
  const fieldRef = useRef<Field | null>(null);

  useAnimationLoop(
    ({ now, dt, surface }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = live.current;
      if (!a) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { w, h, dpr } = surface;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const low = qualityTier() === "low";
      const isStorm = a.state === "thunderstorm";
      const isDaylight = a.isDaylight;
      const isFog = a.state === "fog";
      const overcast = Math.max(a.cloudCover, isStorm ? 0.85 : 0);

      /* ---------- particle field, built once per mount ---------- */
      if (!fieldRef.current) fieldRef.current = buildField(low, w);
      const f = fieldRef.current;

      /** Azimuth 90°E sits left, 180°S centre, 270°W right. */
      const celestialX = (az: number) => (0.14 + ((az - 90) / 180) * 0.72) * w;
      const celestialY = (el: number) => (0.74 - Math.max(-8, el) / 72 * 0.68) * h;

      /* ---------- 1. stars ---------- */
      if (!isDaylight) {
        const vis =
          (1 - overcast) * (1 - Math.min(1, a.precipIntensity * 1.7)) * (isFog ? 0.3 : 1);
        if (vis > 0.03) {
          for (const s of f.stars) {
            const tw = 0.68 + 0.32 * Math.sin(now / 1000 * s.tw + s.phase);
            ctx.globalAlpha = s.a * tw * vis;
            // Cool white through to faintly warm, like a real sky.
            ctx.fillStyle = s.warm > 0.72 ? "#ffeedd" : s.warm < 0.28 ? "#dce8ff" : "#ffffff";
            ctx.beginPath();
            ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }

      /* ---------- 2. sun: bloom, not a disc ---------- */
      const sunUp = a.sunElevation > -4;
      if (sunUp && overcast < 0.92) {
        const sx = celestialX(a.sunAzimuth);
        const sy = celestialY(a.sunElevation);
        // Brightest when the sun is low and shining through more air.
        const lowSun = 1 - Math.min(1, Math.max(0, a.sunElevation) / 55);
        /* Two very slow, out-of-phase swells (~11s and ~29s). Light through
           moving air is never perfectly steady, but it must never read as a
           pulse: at these periods the eye sees warmth shifting, not blinking. */
        const breathe =
          1 + 0.18 * Math.sin(now / 11000) + 0.11 * Math.sin(now / 29000 + 1.7);
        const through = 1 - overcast * 0.85;
        const amp = (0.36 + lowSun * 0.5) * breathe * through;

        ctx.globalCompositeOperation = "lighter";

        /* Warm halo: the whole sky near the sun should feel lit, not just the
           small hot core. This is what separates "sunny" from "blue gradient". */
        const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 1.25);
        halo.addColorStop(0, `rgba(255,214,138,${amp * 0.42})`);
        halo.addColorStop(0.22, `rgba(255,199,124,${amp * 0.2})`);
        halo.addColorStop(0.55, `rgba(246,180,116,${amp * 0.07})`);
        halo.addColorStop(1, "rgba(230,160,100,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, w, h);

        // Wide atmospheric wash
        const wash = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.8);
        wash.addColorStop(0, `rgba(255,232,176,${amp * 0.5})`);
        wash.addColorStop(0.25, `rgba(255,210,138,${amp * 0.22})`);
        wash.addColorStop(1, "rgba(255,196,120,0)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, w, h);

        // Tight core bloom, kept soft: a hard white centre would look like a lens
        // flare rather than the sun seen through atmosphere.
        const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(80, w * 0.22));
        core.addColorStop(0, `rgba(255,250,232,${amp * 0.78})`);
        core.addColorStop(0.3, `rgba(255,232,172,${amp * 0.4})`);
        core.addColorStop(0.62, `rgba(255,214,140,${amp * 0.14})`);
        core.addColorStop(1, "rgba(255,214,140,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(80, w * 0.22), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      /* ---------- 3. sunlit motes: only when the air is clear and bright ---- */
      if (isDaylight && a.cloudCover < 0.45 && a.precipIntensity < 0.05) {
        /* Drawn as soft radial blobs rather than hard dots. A 1px dot at low
           alpha moving a few pixels a second produces no visible change at all;
           a soft, slightly larger mote reads as dust turning in a shaft of
           light, which is the effect we actually want. */
        for (const m of f.motes) {
          const y = (m.y - (now / 1000 / 34) * m.spd) % 1;
          const yy = (y < 0 ? y + 1 : y) * h;
          const drift = Math.sin(now / 1000 * 0.42 + m.phase) * 20;
          const mx = m.x * w + drift;
          // Brighter the closer a mote drifts to the sun's side of the sky.
          const near = 1 - Math.min(1, Math.hypot(mx / w - celestialX(a.sunAzimuth) / w, yy / h - celestialY(a.sunElevation) / h));
          const alpha = m.a * (0.34 + near * 0.5);
          const r = m.r * (1 + near * 0.5);
          const g = ctx.createRadialGradient(mx, yy, 0, mx, yy, r * 2.6);
          g.addColorStop(0, `rgba(255,247,220,${alpha})`);
          g.addColorStop(0.4, `rgba(255,238,196,${alpha * 0.4})`);
          g.addColorStop(1, "rgba(255,232,180,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(mx, yy, r * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* ---------- 4. cloud masses ---------- */
      /* Large, very slow luminance fields drifting under the sprites. Overcast
         skies read as flat grey without them; with them the cloud has depth and
         a direction even where the sprites are thin. */
      if (overcast > 0.05 && !isFog) {
        const masses = isStorm ? 5 : 4;
        for (let i = 0; i < masses; i++) {
          const speed = 3.5 + i * 2.6 + a.windKph * 0.5;
          const span = w + 900;
          const x = (((now / 1000) * speed + i * 263) % span) - 450;
          const y = (0.12 + i * 0.17) * h;
          const R = (260 + i * 74) * (0.7 + a.cloudCover * 0.6);
          const g = ctx.createRadialGradient(x, y, 0, x, y, R);
          if (isStorm) {
            g.addColorStop(0, `rgba(8,10,16,${0.3 * overcast})`);
            g.addColorStop(0.55, `rgba(10,13,20,${0.14 * overcast})`);
            g.addColorStop(1, "rgba(12,15,22,0)");
          } else {
            g.addColorStop(0, `rgba(214,222,232,${0.1 * overcast})`);
            g.addColorStop(0.55, `rgba(198,208,220,${0.045 * overcast})`);
            g.addColorStop(1, "rgba(198,208,220,0)");
          }
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, y, R, R * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (overcast > 0.05) {
        // Storm clouds run faster and heavier; high cirrus always drifts more.
        const drift = (0.004 + a.windKph * 0.00042) * dt * 60;
        const isNight = !isDaylight;
        for (const c of f.clouds) {
          c.x += drift * c.speed * (c.band === 0 ? 1.55 : 1);
          if (c.x > 1.35) c.x = -0.35;
          const sprite = (isStorm ? f.stormSprites : f.sprites)[c.sprite]!;
          const sw = sprite.width * c.scale;
          const sh = sprite.height * c.scale;
          // Night clouds are lit from behind by the city/moon, not white.
          const lit = isNight ? 0.42 : 1;
          const bandThin = c.band === 0 ? 0.55 : 1;
          ctx.globalAlpha = Math.min(1, c.alpha * overcast * bandThin * lit);
          ctx.drawImage(sprite, c.x * w - sw / 2, c.y * h - sh / 2, sw, sh);
        }
        ctx.globalAlpha = 1;
      }

      /* ---------- 5. moon with glow ---------- */
      if (!isDaylight && a.moonElevation > -6 && overcast < 0.9) {
        const mx = celestialX(a.moonAzimuth);
        const my = celestialY(a.moonElevation);
        const mr = Math.max(9, w * 0.018);
        const clear = 1 - overcast;
        // Halo first, so the disc sits inside its own glow.
        ctx.globalCompositeOperation = "lighter";
        const halo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 9);
        halo.addColorStop(0, `rgba(214,228,255,${0.3 * clear})`);
        halo.addColorStop(0.3, `rgba(170,196,246,${0.1 * clear})`);
        halo.addColorStop(1, "rgba(140,170,230,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(mx, my, mr * 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";

        // Phase: carve the shadow terminator out of the disc.
        ctx.save();
        ctx.beginPath();
        ctx.arc(mx, my, mr, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = `rgba(232,238,250,${0.94 * clear})`;
        ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
        const off = Math.cos(a.moonPhase * Math.PI * 2) * mr * 1.9;
        ctx.fillStyle = `rgba(6,10,20,${0.62 * clear})`;
        ctx.beginPath();
        ctx.arc(mx + off, my, mr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* ---------- 6. layered fog through the whole depth ---------- */
      if (isFog || a.visibilityKm < 5) {
        const density = Math.min(1, (5 - a.visibilityKm) / 4.4);

        /* Diffusion first. Fog has no edges: it lifts the blacks, crushes the
           highlights and flattens local contrast. Laying a light, near-uniform
           film over the frame is what separates it from a grey overcast, which
           keeps its contrast. This is the single biggest cue that the two are
           different weather. */
        const film = ctx.createLinearGradient(0, 0, w * 0.35, h);
        film.addColorStop(0, `rgba(206,214,224,${0.3 * density})`);
        film.addColorStop(0.5, `rgba(196,205,216,${0.34 * density})`);
        film.addColorStop(1, `rgba(186,196,208,${0.3 * density})`);
        ctx.fillStyle = film;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = "screen";
        // More banks, larger and softer than before, at differing depths.
        for (let i = 0; i < 11; i++) {
          const speed = 2.5 + i * 4.2 + a.windKph * 0.4;
          const span = w + 900;
          const x = (((now / 1000) * speed + i * 311) % span) - 450;
          const y = (0.1 + i * 0.082) * h;
          const R = (230 + i * 58) * (0.8 + density * 0.5);
          const g = ctx.createRadialGradient(x, y, 0, x, y, R);
          g.addColorStop(0, `rgba(206,216,228,${0.15 * density})`);
          g.addColorStop(0.45, `rgba(198,208,222,${0.075 * density})`);
          g.addColorStop(1, "rgba(198,208,222,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, y, R, R * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      /* ---------- 7. storm ambience: the air itself darkens before rain ---- */
      if (isStorm) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(3,5,10,0.46)");
        g.addColorStop(0.5, "rgba(3,5,10,0.2)");
        g.addColorStop(1, "rgba(3,5,10,0.3)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      /* ---------- 8. horizon: the bottom of the frame is not empty ------- */
      /* The page ends well above the bottom of the app on a typical screen, so
         whatever sits behind the lower third is the part of the sky a viewer
         is actually looking at. Left alone it is a flat wash and the page reads
         as though it ran out. Each state gets the one cue that belongs to it:
         warm light bouncing off haze on a bright day, city glow after dark,
         fog pooling low, a wet sheen under rain. Alphas are kept small because
         text sits over this. */
      {
        const rgb =
          a.state === "sunny"
            ? "255,216,156"
            : a.state === "night"
              ? "255,188,124"
              : a.state === "fog"
                ? "208,218,230"
                : a.state === "thunderstorm"
                  ? "126,148,196"
                  : a.state === "rain"
                    ? "152,180,210"
                    : "200,208,220";
        const peak =
          a.state === "sunny"
            ? 0.105
            : a.state === "fog"
              ? 0.13
              : a.state === "night"
                ? 0.1
                : a.state === "cloudy"
                  ? 0.07
                  : a.state === "rain"
                    ? 0.08
                    : 0.05;
        /* Fog breathes very slowly, like everything else low in the atmosphere. */
        const breathe = 1 + (isFog ? 0.22 * Math.sin(now / 9000) : 0);
        const top = h * 0.52;
        const g = ctx.createLinearGradient(0, top, 0, h);
        g.addColorStop(0, `rgba(${rgb},0)`);
        g.addColorStop(0.5, `rgba(${rgb},${peak * 0.3 * breathe})`);
        g.addColorStop(1, `rgba(${rgb},${peak * breathe})`);
        ctx.globalCompositeOperation = isFog ? "screen" : "lighter";
        ctx.fillStyle = g;
        ctx.fillRect(0, top, w, h - top);

        /* Rain leaves the ground reflective. A thin lift right at the bottom
           edge is the difference between "wet" and merely "damp". */
        if (a.state === "rain" || isStorm) {
          const sheen = ctx.createLinearGradient(0, h * 0.9, 0, h);
          sheen.addColorStop(0, "rgba(150,178,208,0)");
          sheen.addColorStop(1, `rgba(178,202,228,${isStorm ? 0.07 : 0.1})`);
          ctx.fillStyle = sheen;
          ctx.fillRect(0, h * 0.9, w, h * 0.1);
        }
        ctx.globalCompositeOperation = "source-over";
      }
    },
    sizeRef,
    canvasRef,
    motion,
  );

  return <canvas ref={canvasRef} className="wx-layer" aria-hidden />;
}

interface Field {
  stars: Star[];
  clouds: Cloud[];
  sprites: HTMLCanvasElement[];
  stormSprites: HTMLCanvasElement[];
  motes: Mote[];
}

function buildField(low: boolean, w: number): Field {
  const rng = mulberry32(20260926);
  const scale = Math.max(0.7, Math.min(2.2, w / 430));

  const stars: Star[] = Array.from({ length: low ? 150 : 340 }, () => ({
    x: rng(),
    y: rng() * 0.76,
    r: (0.4 + rng() * 1.5) * scale,
    a: 0.28 + rng() * 0.68,
    tw: 0.5 + rng() * 2.4,
    phase: rng() * Math.PI * 2,
    warm: rng(),
  }));

  const sprites = [makeCloudSprite(rng, true), makeCloudSprite(rng, true), makeCloudSprite(rng, false)];
  // Storm variants: the same masses, weighted down to slate.
  const stormSprites = sprites.map((sp) => darken(sp, 0.72));
  const clouds: Cloud[] = [];
  // Low cumulus first, then high cirrus on top.
  for (let i = 0; i < (low ? 5 : 9); i++) {
    clouds.push({
      sprite: 2,
      x: rng() * 1.6 - 0.3,
      y: 0.1 + rng() * 0.3,
      scale: (1.5 + rng() * 1.5) * scale,
      alpha: 0.4 + rng() * 0.34,
      speed: 0.55 + rng() * 0.7,
      band: 1,
    });
  }
  for (let i = 0; i < (low ? 4 : 7); i++) {
    clouds.push({
      sprite: rng() > 0.5 ? 0 : 1,
      x: rng() * 1.6 - 0.3,
      y: 0.04 + rng() * 0.22,
      scale: (2.1 + rng() * 1.6) * scale,
      alpha: 0.24 + rng() * 0.26,
      speed: 1.1 + rng() * 0.9,
      band: 0,
    });
  }

  const motes: Mote[] = Array.from({ length: low ? 26 : 58 }, () => ({
    x: rng(),
    y: rng(),
    r: (1.1 + rng() * 2.4) * scale,
    a: 0.2 + rng() * 0.34,
    spd: 0.4 + rng() * 1.2,
    phase: rng() * Math.PI * 2,
  }));

  return { stars, clouds, sprites, stormSprites, motes };
}
