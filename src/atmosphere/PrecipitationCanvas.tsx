import { useRef } from "react";
import { live, qualityTier } from "./derive";
import { mulberry32 } from "../lib/prng";
import { useAnimationLoop, useCanvasSurface } from "./useCanvasSurface";

/** Parallax depth bands. `scale` drives size, speed and opacity together so the
 *  eye reads distance rather than four unrelated effects. `blob` marks the
 *  nearest band, which is too close to the viewer to resolve into a streak. */
const LAYERS = [
  { name: "far", share: 0.4, scale: 0.5, speed: 0.6, alpha: 0.5, width: 0.9, blob: false },
  { name: "mid", share: 0.33, scale: 1.0, speed: 1.0, alpha: 0.85, width: 1.35, blob: false },
  { name: "near", share: 0.19, scale: 1.9, speed: 1.55, alpha: 1.2, width: 2.0, blob: false },
  { name: "front", share: 0.08, scale: 3.4, speed: 2.2, alpha: 0.34, width: 0, blob: true },
] as const;

interface Drop {
  layer: number;
  x: number;
  y: number;
  /** Per-drop length and speed jitter so no two streaks match. */
  len: number;
  spd: number;
  alpha: number;
  /** Phase offset for the wind gust oscillation. */
  gust: number;
  /** Per-drop size multiplier, deliberately wide so sizes are uneven. */
  fat: number;
  /** Per-drop wind susceptibility: not every drop catches the same gust. */
  wind: number;
}

interface Splash {
  x: number;
  y: number;
  born: number;
  r: number;
  layer: number;
}

/**
 * Rain as a volume rather than a pattern.
 *
 * Flat animated lines read as a screensaver. Real rain reads as depth: a fine
 * distant drizzle, a mid-field of streaks, and a few large near-field
 * droplets crossing the viewer, all sheared by the same wind and lit by the
 * same sky. Count, length, velocity and opacity all rise with the derived
 * precipitation intensity, and each drop lands, so the bottom of the frame
 * carries splashes and the ground reads as wet.
 */
export function PrecipitationCanvas({ motion }: { motion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useCanvasSurface(canvasRef);

  const poolRef = useRef<{ drops: Drop[]; splashes: Splash[] } | null>(null);
  const flashRef = useRef({ next: 0, t0: -1, x: 0.5, y: 0.3 });

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

      const I = a.precipIntensity;
      const fog = a.visibilityKm < 4 ? Math.min(1, (4 - a.visibilityKm) / 3.6) : 0;
      const isStorm = a.state === "thunderstorm";
      const isDay = a.isDaylight;

      /* ---- particle pool, allocated once per quality tier ---- */
      const low = qualityTier() === "low";
      const MAX = low ? 300 : 820;
      if (!poolRef.current) {
        const rng = mulberry32(90210);
        const drops: Drop[] = [];
        // Interleave the layers so shrinking the count thins every band evenly
        // instead of deleting the whole foreground.
        for (let li = 0; li < LAYERS.length; li++) {
          const n = Math.round(MAX * LAYERS[li]!.share);
          for (let i = 0; i < n; i++) {
            drops.push({
              layer: li,
              x: rng(),
              y: rng() * 1.2 - 0.1,
              // Wide jitter, and skewed small: a few fat drops among many fine
              // ones is what real rain looks like. A narrow range reads as a
              // repeating pattern.
              len: 0.4 + rng() * rng() * 1.5,
              spd: 0.66 + rng() * 0.78,
              alpha: 0.5 + rng() * 0.5,
              gust: rng() * Math.PI * 2,
              fat: 0.55 + rng() * rng() * 1.5,
              wind: 0.7 + rng() * 0.6,
            });
          }
        }
        poolRef.current = { drops, splashes: [] };
      }
      const { drops, splashes } = poolRef.current;

      /* ---- 1. haze: the volume of air the rain falls through ---- */
      if (I > 0.03) {
        const hazeA = (0.05 + I * 0.13 + fog * 0.1) * (isDay ? 1 : 0.72);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `rgba(150,176,200,${hazeA * 1.15})`);
        g.addColorStop(0.55, `rgba(130,158,186,${hazeA * 0.55})`);
        g.addColorStop(1, `rgba(110,138,166,${hazeA * 0.3})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      /* ---- 2. rain ---- */
      if (I > 0.03) {
        // Intensity -> how much of the pool is alive, and how hard it falls.
        const alive = Math.round(drops.length * Math.min(1, 0.16 + I * 1.5));
        const baseSpeed = (250 + I * 940) * (isStorm ? 1.28 : 1);
        const baseLen = (9 + I * 34) * (isStorm ? 1.18 : 1);
        const opacity = 0.15 + I * 0.42;
        /* Wind shears every band by the same angle, with a slow gust plus a
           faster flutter. Storms blow visibly harder. */
        const windPx = a.windKph * (isStorm ? 3.4 : 2.6);
        const gustNow = Math.sin(now / 2600) * 0.35 + Math.sin(now / 830) * 0.18;

        const tint = isDay ? "222,238,252" : "168,196,224";
        const tintNear = isDay ? "236,246,255" : "198,220,244";

        ctx.lineCap = "round";
        for (let i = 0; i < alive; i++) {
          const d = drops[i]!;
          const L = LAYERS[d.layer]!;

          const vy = (baseSpeed * L.speed * d.spd * dt) / h;
          // Shear in normalised-x per normalised-y, so all layers lean alike.
          const vx = ((windPx * (1 + gustNow) * L.speed * d.wind) / w) * dt;
          d.y += vy;
          d.x += vx;

          const groundY = 1.02;
          if (d.y > groundY) {
            // Only the near and mid bands are big enough to leave a visible mark.
            if (d.layer > 0 && !L.blob && I > 0.2 && splashes.length < 110) {
              splashes.push({
                x: d.x,
                y: 0.965 + Math.random() * 0.03,
                born: now,
                r: (2.5 + d.len * 5) * L.scale,
                layer: d.layer,
              });
            }
            d.y = -0.06 - Math.random() * 0.1;
            d.x = Math.random();
          }
          if (d.x > 1.08) d.x -= 1.16;
          if (d.x < -0.08) d.x += 1.16;

          const lenPx = baseLen * d.len * L.scale;
          const x = d.x * w;
          const y = d.y * h;
          // Lean: the streak trails up-wind from the drop head.
          const lean = (windPx * (1 + gustNow) * d.wind * dt) * 0.9;

          if (L.blob) {
            /* The nearest band is out of focus: a soft round droplet with a
               bright shoulder, not a streak. Drawing these as thick lines is
               what makes rain look like a screensaver. */
            const r = (5 + d.len * 9) * d.fat;
            const g = ctx.createRadialGradient(x - r * 0.28, y - r * 0.34, 0, x, y, r);
            const a = Math.min(0.5, d.alpha * opacity * L.alpha);
            g.addColorStop(0, `rgba(${tintNear},${a * 1.5})`);
            g.addColorStop(0.42, `rgba(${tint},${a * 0.7})`);
            g.addColorStop(1, `rgba(${tint},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            // Slightly elongated along the direction of travel.
            ctx.ellipse(x, y, r * 0.86, r * 1.12, -Math.atan2(lean, lenPx || 1), 0, Math.PI * 2);
            ctx.fill();
            continue;
          }

          ctx.globalAlpha = Math.min(1, d.alpha * opacity * L.alpha);
          ctx.strokeStyle = d.layer === 2 ? `rgb(${tintNear})` : `rgb(${tint})`;
          ctx.lineWidth = L.width * d.len * d.fat * 0.7;

          // Far rain is a hairline; near rain is a soft, tapering streak.
          ctx.beginPath();
          ctx.moveTo(x - lean, y - lenPx);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        /* ---- 3. splashes on the wet ground plane ---- */
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i]!;
          const age = (now - s.born) / 460;
          if (age >= 1) {
            splashes.splice(i, 1);
            continue;
          }
          const L = LAYERS[s.layer]!;
          const rx = s.r * (0.35 + age * 1.5);
          const fade = (1 - age) * (1 - age);
          ctx.globalAlpha = fade * 0.55 * L.alpha;
          ctx.strokeStyle = `rgb(${tint})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          // Flattened ellipse: read as a ring on a horizontal surface.
          ctx.ellipse(s.x * w, s.y * h, rx, rx * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();

          /* A short-lived crown of droplets thrown back up. Two or three specks
             per impact is what makes the ground read as wet rather than painted. */
          if (age < 0.5) {
            const kicks = 3;
            for (let k = 0; k < kicks; k++) {
              const ang = -Math.PI / 2 + (k - (kicks - 1) / 2) * 0.55;
              const reach = s.r * (0.5 + age * 5.5);
              ctx.globalAlpha = (1 - age * 2) * 0.5 * L.alpha;
              ctx.fillStyle = `rgb(${tint})`;
              ctx.beginPath();
              ctx.arc(
                s.x * w + Math.cos(ang) * reach,
                s.y * h + Math.sin(ang) * reach * 0.55,
                1.05 * L.scale,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      /* ---- 4. drifting fog banks, layered through the whole depth ---- */
      if (fog > 0.02) {
        for (let i = 0; i < 6; i++) {
          const speed = 5 + i * 7 + a.windKph * 0.6;
          const y = (0.2 + i * 0.135) * h;
          const span = w + 620;
          const drift = (((now / 1000) * speed + i * 397) % span) - 310;
          const R = 210 + i * 46;
          const g = ctx.createRadialGradient(drift, y, 0, drift, y, R);
          g.addColorStop(0, `rgba(206,216,228,${0.1 * fog})`);
          g.addColorStop(0.6, `rgba(196,208,222,${0.05 * fog})`);
          g.addColorStop(1, "rgba(196,208,222,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(drift, y, R, R * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* ---- 5. lightning pulse: illuminate the air, do not white out ---- */
      const f = flashRef.current;
      if (a.thunderProb > 0.12 && isStorm) {
        if (!f.next) f.next = now + 900;
        if (now > f.next) {
          f.next = now + 2400 + (1 - a.thunderProb) * 11000;
          f.t0 = now;
          f.x = 0.18 + Math.random() * 0.64;
          f.y = 0.1 + Math.random() * 0.22;
        }
      } else {
        f.t0 = -1;
      }

      if (f.t0 > 0) {
        const age = (now - f.t0) / 640;
        if (age < 1) {
          // Two-beat flicker: a leader, a gap, then the main return stroke.
          const beat =
            age < 0.14
              ? age / 0.14
              : age < 0.26
                ? 0
                : age < 0.48
                  ? 1 - (age - 0.26) / 0.22
                  : Math.max(0, 1 - (age - 0.48) / 0.52) * 0.42;
          if (beat > 0.01) {
            const cx = f.x * w;
            const cy = f.y * h;
            ctx.globalCompositeOperation = "lighter";

            /* 1. The sheet of light over the whole app. This is the part that
               makes a strike feel like it happens in the sky you are standing
               in rather than on a panel: it reaches every edge, and it is wide
               and weak enough that it lifts the scene instead of blowing it out. */
            const sheet = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 1.15);
            const sheetAmp = beat * (0.1 + a.thunderProb * 0.13);
            sheet.addColorStop(0, `rgba(176,196,242,${sheetAmp})`);
            sheet.addColorStop(0.4, `rgba(146,170,226,${sheetAmp * 0.55})`);
            sheet.addColorStop(1, `rgba(120,144,206,${sheetAmp * 0.16})`);
            ctx.fillStyle = sheet;
            ctx.fillRect(0, 0, w, h);

            /* 2. The strike itself: tighter, brighter, violet-white and
               vertically stretched, so it still reads as a bolt shape. Kept
               well below full white — a flat white flash is the failure mode. */
            const bolt = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.62);
            const boltAmp = beat * (0.14 + a.thunderProb * 0.16);
            bolt.addColorStop(0, `rgba(206,214,255,${boltAmp})`);
            bolt.addColorStop(0.24, `rgba(168,178,240,${boltAmp * 0.5})`);
            bolt.addColorStop(0.6, `rgba(140,150,214,${boltAmp * 0.16})`);
            bolt.addColorStop(1, "rgba(130,140,200,0)");
            ctx.fillStyle = bolt;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(0.62, 1.45);
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(w, h) * 0.62, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.globalCompositeOperation = "source-over";
          }
        } else {
          f.t0 = -1;
        }
      }
    },
    sizeRef,
    canvasRef,
    motion,
  );

  return <canvas ref={canvasRef} className="wx-layer" aria-hidden />;
}
