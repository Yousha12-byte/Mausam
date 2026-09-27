import { create } from "zustand";
import {
  loadAirQuality,
  idleAirQuality,
  type AirQuality,
} from "../data/airquality";
import type { GeoLocation } from "../domain/weather";

/* Air quality, on its own clock.

   This store is intentionally small and intentionally separate. The weather
   store has a cache, a scenario mode and a simulated fallback; none of that
   applies here. Air quality is fetched live for the real location, in parallel
   with the forecast, and when it fails it simply holds `unavailable` while the
   weather carries on.

   Caching was the one thing worth arguing about. It is omitted: air quality
   moves on a scale of hours, the request is cheap, and a stale AQI reading
   presented beside a fresh temperature is a worse error than a slightly late
   one. The single genuinely useful behaviour here is *not* showing anything
   while stale, which the `status` already encodes. */

interface AirStore {
  air: AirQuality;
  load: (loc: GeoLocation | null) => void;
  clear: () => void;
}

/** Bumped per request; a late response from a superseded request is discarded. */
let generation = 0;
let controller: AbortController | null = null;

export const useAirQuality = create<AirStore>((set) => ({
  air: idleAirQuality(),

  load(loc) {
    // Releasing the previous controller means switching places does not leave a
    // request in flight against coordinates the user has already navigated away
    // from.
    controller?.abort();

    if (!loc) {
      generation++;
      set({ air: idleAirQuality() });
      return;
    }

    const gen = ++generation;
    controller = new AbortController();
    set({ air: { status: "loading", samples: [], usAqiAt: () => null } });

    void loadAirQuality(loc, controller.signal).then((air) => {
      if (gen !== generation) return;
      set({ air });
    });
  },

  clear() {
    generation++;
    controller?.abort();
    controller = null;
    set({ air: idleAirQuality() });
  },
}));

/** Test hook: the current request generation. */
export const airGeneration = () => generation;

/** Test hook: the store's current state, outside React. */
export const airState = () => useAirQuality.getState();
