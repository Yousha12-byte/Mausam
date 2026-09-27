import { useEffect, useRef } from "react";
import { deriveAtmosphere, live } from "./derive";

/**
 * Writes the derived atmosphere into the mutable runtime holder. This is the
 * only place React and the render loops meet, and it never triggers a
 * re-render of the canvases.
 */
export function useAtmosphere(forecast: import("../domain/weather").NormalizedForecast | null, nowMin: number) {
  const raf = useRef(0);

  useEffect(() => {
    if (!forecast) return;
    live.current = deriveAtmosphere(forecast, nowMin);

    // Keep the sun and moon moving even when the forecast is not refreshing.
    const tick = () => {
      if (live.current) {
        const s = deriveAtmosphere(forecast, nowMin);
        live.current = s;
      }
      raf.current = window.setTimeout(tick, 30_000);
    };
    const id = window.setTimeout(tick, 30_000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(raf.current);
    };
  }, [forecast, nowMin]);

  return live.current;
}
