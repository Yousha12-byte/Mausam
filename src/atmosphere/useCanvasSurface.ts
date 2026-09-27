import { useEffect, useRef, type RefObject } from "react";
import { DPR_CAP, qualityTier } from "./derive";

export interface Surface {
  /** CSS pixels of the canvas container. */
  w: number;
  h: number;
  dpr: number;
}

/**
 * Sizes a canvas to its own container rather than to the window.
 *
 * This is what lets the weather live *inside* the app viewport: on a projector
 * the app is a centred window with the atmosphere clipped to its bounds, so a
 * canvas measured against `window.innerWidth` would be far too wide and would
 * bleed past the rounded corners. The render loop reads `sizeRef.current` each
 * frame, so a resize never restarts the animation.
 */
export function useCanvasSurface(
  ref: RefObject<HTMLCanvasElement | null>,
  onResize?: (s: Surface) => void,
) {
  const sizeRef = useRef<Surface>({ w: 0, h: 0, dpr: 1 });
  const cb = useRef(onResize);
  cb.current = onResize;

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const measure = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      const low = qualityTier() === "low";
      /* The presentation viewport is scaled with CSS `zoom` (see globals.css),
         which changes the painted size but not the layout size. Sampling at the
         painted ratio keeps the backing store at 1:1 with device pixels, so the
         weather stays crisp instead of being upscaled on a projector. When there
         is no zoom the ratio is 1 and nothing changes. */
      const rect = host.getBoundingClientRect();
      const zoom = w > 0 ? rect.width / w : 1;
      const safeZoom = zoom > 0.5 && zoom < 3 ? zoom : 1;
      const dpr = Math.min(3, Math.min(window.devicePixelRatio || 1, DPR_CAP[low ? "low" : "high"]) * safeZoom);
      const prev = sizeRef.current;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (prev.w !== w || prev.h !== h) cb.current?.(sizeRef.current);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);

  return sizeRef;
}

export interface Frame {
  now: number;
  /** Seconds since the previous frame, clamped so a backgrounded tab cannot
   *  teleport every particle across the screen on return. */
  dt: number;
  surface: Surface;
}

/**
 * Shared rAF loop: pauses when the tab is hidden, clamps dt, and renders a
 * single representative frame when motion is reduced. The draw function is held
 * in a ref so a forecast update never restarts the loop.
 */
export function useAnimationLoop(
  draw: (f: Frame) => void,
  sizeRef: RefObject<Surface>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  motion: boolean,
) {
  const loop = useRef(draw);
  loop.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvas.getContext("2d")) return;

    let raf = 0;
    let running = true;
    let last = 0;

    const tick = (now: number) => {
      if (!running) return;
      const surface = sizeRef.current;
      if (surface.w && surface.h) {
        const dt = Math.min(0.05, (now - (last || now)) / 1000);
        last = now;
        loop.current({ now, dt, surface });
      }
      raf = requestAnimationFrame(tick);
    };

    const drawOnce = (n: number) => {
      const surface = sizeRef.current;
      if (surface.w && surface.h) loop.current({ now: n, dt: 1 / 60, surface });
    };

    if (motion) {
      raf = requestAnimationFrame(tick);
    } else {
      // Reduced motion: draw one frame, then hold.
      raf = requestAnimationFrame((n) => {
        last = n;
        drawOnce(n);
        cancelAnimationFrame(raf);
      });
    }

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        last = 0;
        // Honour reduced motion on resume too: coming back to the tab must not
        // silently start a continuous animation the user asked us not to run.
        raf = requestAnimationFrame(motion ? tick : (n) => { last = n; drawOnce(n); });
      } else {
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [motion, sizeRef, canvasRef]);
}
