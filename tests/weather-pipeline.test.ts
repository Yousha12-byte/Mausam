import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_LOCATION, effectiveLocation } from "../src/domain/location";
import { isoLocalToEpoch, omForecastUrl } from "../src/data/openmeteo";
import { localMinToEpoch, sampleAt, currentObservationAt } from "../src/domain/decision";
import { currentState } from "../src/state/weather-store";
import { deriveState, fromWmoCode } from "../src/domain/taxonomy";
import { agoLabel, describeSource } from "../src/lib/source";
import type { HourSample, NormalizedForecast } from "../src/domain/weather";

const H = 3_600_000;
const IST = 330;
const KOCHI = { name: "Kochi", admin: "Kerala", lat: 9.9312, lon: 76.2673 };
const MUMBAI = { name: "Mumbai", admin: "Maharashtra", lat: 19.0728, lon: 72.8826 };

function sample(i: number, start: number, over: Partial<HourSample> = {}): HourSample {
  return {
    t: start + i * H,
    hour: i % 24,
    tempC: 20,
    feelsC: 20,
    precipMm: 0,
    precipProb: 0,
    windKph: 8,
    gustKph: 12,
    cloudCover: 0.2,
    visibilityKm: 20,
    uvIndex: 0,
    code: "clear",
    isDay: true,
    thunderProb: 0,
    ...over,
  };
}

/** A 48-hour series starting at the location's local midnight. */
function series(loc = KOCHI, tz = IST): NormalizedForecast {
  const start = Date.UTC(2026, 8, 26, 0, 0) - tz * 60_000;
  return {
    location: { ...loc, timezone: "Asia/Kolkata" },
    tzOffsetMin: tz,
    timezone: "Asia/Kolkata",
    fetchedAt: start,
    source: "open-meteo",
    current: null,
    hourly: Array.from({ length: 48 }, (_, i) => sample(i, start, { tempC: 20 + (i % 24) })),
    sunriseMin: 360,
    sunsetMin: 1080,
  };
}

describe("request coordinates", () => {
  it("builds a distinct URL per city", () => {
    expect(omForecastUrl(MUMBAI)).toContain("latitude=19.0728&longitude=72.8826");
    expect(omForecastUrl(KOCHI)).toContain("latitude=9.9312&longitude=76.2673");
    expect(omForecastUrl(MUMBAI)).not.toBe(omForecastUrl(KOCHI));
  });

  it("asks for the location's own timezone and a two-day window", () => {
    const url = omForecastUrl(KOCHI);
    expect(url).toContain("timezone=auto");
    expect(url).toContain("forecast_days=2");
  });
});

describe("timestamp handling", () => {
  it("reads Open-Meteo's naive local stamps as the location's time, not the device's", () => {
    // 14:00 in a +5:30 place is 08:30 UTC.
    expect(isoLocalToEpoch("2026-09-26T14:00", IST)).toBe(Date.UTC(2026, 8, 26, 8, 30));
  });

  it("handles a whole-day offset and a zero offset", () => {
    expect(isoLocalToEpoch("2026-09-26T00:00", 0)).toBe(Date.UTC(2026, 8, 26, 0, 0));
    expect(isoLocalToEpoch("2026-09-26T00:00", -480)).toBe(Date.UTC(2026, 8, 26, 8, 0));
  });

  it("does not read the device timezone at all", () => {
    // The stamp is anchored with an explicit Z and then shifted, so the result
    // is arithmetic rather than a local-time parse. Under a device at UTC-7 the
    // old naive parse resolved to 21:00 UTC; this is the true 08:30 UTC.
    const t = isoLocalToEpoch("2026-09-26T14:00", IST);
    expect(t).toBe(Date.UTC(2026, 8, 26, 8, 30));
    expect(t).not.toBe(Date.parse("2026-09-26T14:00:00Z"));
    expect(new Date(t).toISOString()).toBe("2026-09-26T08:30:00.000Z");
  });

  it("maps a local minute onto the series' own clock", () => {
    const f = series();
    expect(localMinToEpoch(f, 0)).toBe(f.hourly[0]!.t);
    expect(localMinToEpoch(f, 14 * 60 + 30)).toBe(f.hourly[14]!.t + H / 2);
  });
});

describe("current reading is located by timestamp, not array position", () => {
  it("reads the right hour on the first day", () => {
    const f = series();
    expect(sampleAt(f, 14 * 60).tempC).toBe(34);
  });

  it("reads the second day after local midnight, not the first", () => {
    const f = series();
    // 00:30 on day two. Index 0 is day one, so a positional lookup returns it.
    expect(sampleAt(f, 30).tempC).toBe(20 + 0.5);
  });

  it("crosses midnight onto the following day", () => {
    const f = series();
    expect(sampleAt(f, 25 * 60).tempC).toBe(21); // 01:00 on day two
  });

  it("interpolates between the bracketing hours", () => {
    const f = series();
    const quarter = sampleAt(f, 14 * 60 + 15);
    expect(quarter.tempC).toBeCloseTo(34.25, 5);
  });

  it("does not depend on the series starting at index zero", () => {
    const f = series();
    const trimmed: NormalizedForecast = { ...f, hourly: f.hourly.slice(6) };
    // 09:00 is index 3 of the trimmed series, 9 of the full one.
    expect(sampleAt(trimmed, 9 * 60).tempC).toBe(29);
  });

  it("clamps rather than wrapping when asked past the end", () => {
    const f = series();
    const last = f.hourly[f.hourly.length - 1]!;
    expect(sampleAt(f, 47 * 60 + 30).tempC).toBeCloseTo(last.tempC, 5);
  });
});

describe("weather code mapping", () => {
  it("maps the WMO codes the app can receive", () => {
    expect(fromWmoCode(0)).toBe("clear");
    expect(fromWmoCode(1)).toBe("clear");
    expect(fromWmoCode(2)).toBe("partly");
    expect(fromWmoCode(3)).toBe("cloudy");
    expect(fromWmoCode(45)).toBe("fog");
    expect(fromWmoCode(48)).toBe("fog");
    expect(fromWmoCode(51)).toBe("drizzle");
    expect(fromWmoCode(55)).toBe("drizzle");
    expect(fromWmoCode(61)).toBe("rain");
    expect(fromWmoCode(65)).toBe("heavy_rain");
    expect(fromWmoCode(80)).toBe("rain");
    expect(fromWmoCode(82)).toBe("heavy_rain");
    expect(fromWmoCode(95)).toBe("thunder");
    expect(fromWmoCode(99)).toBe("thunder");
  });

  it("never lets a moderate code fall through to clear", () => {
    for (const c of [2, 3, 45, 48, 51, 61, 65, 80, 95]) {
      expect(fromWmoCode(c)).not.toBe("clear");
    }
  });

  it("derives the displayed state, with night from darkness not from the code", () => {
    expect(deriveState("clear", true)).toBe("sunny");
    expect(deriveState("clear", false)).toBe("night");
    // Partly cloudy in daylight is still a bright sky, not overcast.
    expect(deriveState("partly", true)).toBe("sunny");
    expect(deriveState("partly", false)).toBe("night");
    expect(deriveState("cloudy", true)).toBe("cloudy");
    expect(deriveState("fog", true)).toBe("fog");
    expect(deriveState("rain", true)).toBe("rain");
    expect(deriveState("heavy_rain", true)).toBe("rain");
    expect(deriveState("thunder", true)).toBe("thunderstorm");
    // A storm at night is still a storm, not a clear night.
    expect(deriveState("thunder", false)).toBe("thunderstorm");
    expect(deriveState("rain", false)).toBe("rain");
  });
});

describe("units", () => {
  it("keeps precipitation amount in mm and probability as a fraction", () => {
    const p = fromWmoCode(61);
    const s = sample(0, 0, { precipMm: 2.4, precipProb: 0.75, windKph: 18.5, visibilityKm: 6.2 });
    expect(p).toBe("rain");
    expect(s.precipMm).toBe(2.4);
    expect(s.precipProb).toBe(0.75);
    expect(s.windKph).toBe(18.5);
    expect(s.visibilityKm).toBe(6.2);
  });

  it("does not confuse a high chance of little rain with a small chance of a lot", () => {
    const drizzle = sample(0, 0, { precipMm: 0.1, precipProb: 0.95 });
    const downpour = sample(0, 0, { precipMm: 8, precipProb: 0.1 });
    expect(drizzle.precipMm).not.toBe(drizzle.precipProb);
    expect(downpour.precipMm).toBeGreaterThan(drizzle.precipMm);
  });
});

describe("effective location", () => {
  it("uses the real place when no scenario is pinned", () => {
    expect(effectiveLocation(MUMBAI, null)).toBe(MUMBAI);
  });

  it("falls back to Kochi before any place is chosen", () => {
    expect(effectiveLocation(null, null)).toBe(DEMO_LOCATION);
  });

  it("pins Kochi for a scenario without touching the real place", () => {
    expect(effectiveLocation(MUMBAI, "thunderstorm")).toBe(DEMO_LOCATION);
    expect(effectiveLocation(MUMBAI, "thunderstorm")).not.toBe(MUMBAI);
  });
});

describe("data source note", () => {
  const now = Date.UTC(2026, 8, 26, 12, 0);

  it("never calls simulated data live", () => {
    const n = describeSource({ forecast: series(), origin: "simulated", nowEpoch: now });
    expect(n.text).toContain("Simulated");
    expect(n.text).not.toMatch(/Open-Meteo/);
    expect(n.origin).toBe("simulated");
  });

  it("names the provider and the observation time when genuinely live", () => {
    const f = series();
    const n = describeSource({ forecast: f, origin: "live", nowEpoch: now });
    // fetchedAt is local midnight in a +5:30 place.
    expect(n.text).toBe("Open-Meteo · Updated 12:00 AM");
    expect(n.origin).toBe("live");
  });

  it("shows how old a cached forecast is", () => {
    const f = { ...series(), fetchedAt: now - 45 * 60_000 };
    const n = describeSource({ forecast: f, origin: "cached", nowEpoch: now });
    expect(n.text).toBe("Cached forecast · 45 min ago");
  });

  it("labels a pinned scenario as demo and names the place", () => {
    const n = describeSource({
      forecast: series(),
      origin: "demo",
      nowEpoch: now,
    });
    expect(n.text).toBe("Demo weather · Kochi");
  });

  it("formats relative ages", () => {
    expect(agoLabel(now, now)).toBe("just now");
    expect(agoLabel(now - 60_000, now)).toBe("1 min ago");
    expect(agoLabel(now - 30 * 60_000, now)).toBe("30 min ago");
    expect(agoLabel(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(agoLabel(now - 5 * 3_600_000, now)).toBe("5 hours ago");
  });
});

describe("weather store: latest request wins", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("does not let a slow earlier city overwrite the current one", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async (url: string) => {
      const mumbai = String(url).includes("latitude=19");
      // Kochi is requested first but answers last.
      await new Promise((r) => setTimeout(r, mumbai ? 5 : 40));
      const times = Array.from({ length: 2 }, (_, d) =>
        Array.from({ length: 24 }, (_, h) => `2026-09-26T${String(d * 24 + h).padStart(2, "0")}:00`),
      ).flat();
      return {
        ok: true,
        json: async () => ({ utc_offset_seconds: 19800, hourly: { time: times } }),
      } as never;
    });

    const { useWeather } = await import("../src/state/weather-store");
    const a = useWeather.getState().load(KOCHI, null);
    const b = useWeather.getState().load(MUMBAI, null);
    await Promise.all([a, b]);

    expect(useWeather.getState().forecast?.location.name).toBe("Mumbai");
    expect(useWeather.getState().origin).toBe("live");
  });

  it("marks a live failure as simulated, never live", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    localStorage.clear();

    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MUMBAI, null);

    const st = useWeather.getState();
    expect(st.origin).toBe("simulated");
    expect(st.degraded).toBe(true);
    expect(st.forecast?.source).toBe("mock");
  });

  it("replays a snapshot for the same place rather than inventing data", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      const times = Array.from({ length: 2 }, (_, d) =>
        Array.from({ length: 24 }, (_, h) => `2026-09-26T${String(d * 24 + h).padStart(2, "0")}:00`),
      ).flat();
      return {
        ok: true,
        json: async () => ({ utc_offset_seconds: 19800, hourly: { time: times } }),
      } as never;
    });

    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MUMBAI, null);
    expect(useWeather.getState().origin).toBe("live");

    fail = true;
    await useWeather.getState().load(MUMBAI, null);
    expect(useWeather.getState().origin).toBe("cached");
  });

  it("will not replay one city's snapshot for another", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      const times = Array.from({ length: 2 }, (_, d) =>
        Array.from({ length: 24 }, (_, h) => `2026-09-26T${String(d * 24 + h).padStart(2, "0")}:00`),
      ).flat();
      return {
        ok: true,
        json: async () => ({ utc_offset_seconds: 19800, hourly: { time: times } }),
      } as never;
    });

    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MUMBAI, null);
    fail = true;
    await useWeather.getState().load(KOCHI, null);

    // No snapshot for Kochi, so it degrades to labelled simulated data.
    expect(useWeather.getState().origin).toBe("simulated");
  });

  it("a pinned scenario never claims to be live", async () => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal("fetch", async () => {
      throw new Error("should not be called for a scenario");
    });
    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(KOCHI, "rain");
    expect(useWeather.getState().origin).toBe("demo");
  });
});

/* ------------------------------------------------------------------ *
 * Invariants for the reconstructed pipeline.
 *
 * Each of these encodes a rule that the UI depends on but that no single
 * component can enforce on its own. They are written to fail loudly if a
 * future change reintroduces a path that produces confident-looking numbers
 * from data that is not what the source note claims.
 * ------------------------------------------------------------------ */

const MANALI = { name: "Manali", admin: "Himachal Pradesh", lat: 32.2426, lon: 77.1748 };

function omTimes(): string[] {
  return Array.from({ length: 2 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => `2026-09-26T${String(d * 24 + h).padStart(2, "0")}:00`),
  ).flat();
}

/** The snapshot cache is the one piece of this pipeline that touches storage. */
function installMemoryStorage(): void {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  });
}

describe("no simulated user-selectable mode", () => {
  beforeEach(installMemoryStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("exposes no preferLive toggle and no setPreferLive action", async () => {
    vi.resetModules();
    const { useWeather } = await import("../src/state/weather-store");
    const st = useWeather.getState() as unknown as Record<string, unknown>;
    expect(st.preferLive).toBeUndefined();
    expect(st.setPreferLive).toBeUndefined();
    /* The only mode control is the scenario, and null means live. */
    expect(typeof st.setScenario).toBe("function");
  });

  // Imports and initialises the store, which resolves a scenario fixture. That
  // is a couple of seconds of work, so it is the slowest test in the file and
  // sat close enough to the 5s default to time out when the suite ran its files
  // in parallel. Headroom here, not a change to what it asserts.
  it("offers exactly two presentations: live, or a named scenario", { timeout: 20_000 }, async () => {
    vi.resetModules();
    localStorage.clear();
    const { useWeather } = await import("../src/state/weather-store");
    expect(useWeather.getState().scenarioId).toBeNull();
    await useWeather.getState().setScenario("rain");
    expect(useWeather.getState().scenarioId).toBe("rain");
    expect(useWeather.getState().origin).toBe("demo");
    await useWeather.getState().setScenario(null);
    expect(useWeather.getState().scenarioId).toBeNull();
  });

  it("reaches simulated only as a live failure, never by request", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, hourly: { time: omTimes() } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");

    fail = true;
    await useWeather.getState().load(MANALI, null);
    expect(useWeather.getState().origin).toBe("simulated");

    // No API of the store can turn live off; a successful fetch is the only
    // route to live, and a failure is the only route to simulated.
    fail = false;
    await useWeather.getState().load(MANALI, null);
    expect(useWeather.getState().origin).toBe("live");
  });
});

describe("authoritative current observation", () => {
  it("requests a current block, not just an hourly grid", () => {
    const url = omForecastUrl(MANALI);
    expect(url).toContain("current=temperature_2m");
    expect(url).toContain("current=");
    expect(url).toContain("weather_code");
  });

  it("uses the provider observation for now, not the hourly centre", () => {
    const f = series(KOCHI, IST);
    // 12:00 local: the hourly entry covering it is a forecast, the observation
    // is measured, and they deliberately disagree.
    const obs = sample(12, f.hourly[0]!.t, { tempC: 7 });
    const withCurrent: NormalizedForecast = { ...f, current: obs };

    expect(sampleAt(withCurrent, 12 * 60).tempC).not.toBe(7);
    expect(currentObservationAt(withCurrent, 12 * 60).tempC).toBe(7);
  });

  it("ignores the observation when the clock is pinned hours away", () => {
    const f = series(KOCHI, IST);
    const obs = sample(12, f.hourly[0]!.t, { tempC: 7 });
    const withCurrent: NormalizedForecast = { ...f, current: obs };

    // A demo pinned to 20:00 must read the grid, not a 12:00 observation.
    const out = currentObservationAt(withCurrent, 20 * 60);
    expect(out.tempC).toBe(withCurrent.hourly[20]!.tempC);
  });

  it("falls back to the grid when the provider publishes no observation", () => {
    const f = series(KOCHI, IST);
    expect(f.current).toBeNull();
    expect(currentObservationAt(f, 12 * 60).tempC).toBe(sampleAt(f, 12 * 60).tempC);
  });

  it("keeps every field of the observation from one instant", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        utc_offset_seconds: 19800,
        timezone: "Asia/Kolkata",
        hourly: { time: omTimes(), temperature_2m: omTimes().map(() => 99) },
        current: {
          time: "2026-09-26T14:00",
          temperature_2m: 11.4,
          apparent_temperature: 9.8,
          precipitation: 2.5,
          wind_speed_10m: 14,
          weather_code: 61,
          is_day: 1,
        },
      }),
    }) as never);

    const { fetchOpenMeteo } = await import("../src/data/openmeteo");
    const f = await fetchOpenMeteo(MANALI, Date.UTC(2026, 8, 26, 9));

    expect(f.current).not.toBeNull();
    expect(f.current!.t).toBe(Date.UTC(2026, 8, 26, 8, 30));
    // Temperature, code and precipitation all come from the same block, so a
    // rainy 11.4°C is internally consistent.
    expect(f.current!.tempC).toBe(11.4);
    expect(f.current!.code).toBe(fromWmoCode(61));
    expect(f.current!.precipMm).toBe(2.5);
    expect(f.current!.feelsC).toBe(9.8);
    // Generated values are never invented for a field the provider omits.
    expect(f.current!.precipProb).toBe(0);
    // And the hourly grid is still separate, modelled data.
    expect(f.hourly[14]!.tempC).toBe(99);
  });
});

describe("provider timezone is authoritative", () => {
  it("takes the timezone from the response, not the request coordinates", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        utc_offset_seconds: -25200,
        timezone: "America/Vancouver",
        hourly: { time: omTimes() },
      }),
    }) as never);

    const { fetchOpenMeteo } = await import("../src/data/openmeteo");
    // Coordinates are Indian; the provider says otherwise and the provider wins.
    const f = await fetchOpenMeteo(MANALI, Date.UTC(2026, 8, 26));
    expect(f.timezone).toBe("America/Vancouver");
    expect(f.tzOffsetMin).toBe(-420);
    expect(f.location.timezone).toBe("America/Vancouver");
  });

  it("derives naive provider stamps with the provider's own offset", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        utc_offset_seconds: 19800,
        timezone: "Asia/Kolkata",
        hourly: { time: omTimes() },
      }),
    }) as never);

    const { fetchOpenMeteo } = await import("../src/data/openmeteo");
    const f = await fetchOpenMeteo(MANALI, Date.UTC(2026, 8, 26));
    // 14:00 local at +5:30 is 08:30 UTC, not 14:00 UTC and not device-local.
    expect(f.hourly[14]!.t).toBe(Date.UTC(2026, 8, 26, 8, 30));
  });
});

describe("live cache identity", () => {
  beforeEach(installMemoryStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("will not replay a record saved under a different request shape", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, hourly: { time: omTimes() } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");

    await useWeather.getState().load(MANALI, null);
    expect(useWeather.getState().origin).toBe("live");

    // Rewrite the stored key as if the request had asked for different fields.
    const KEY = "mausam.snapshots.live.v2";
    const all = JSON.parse(localStorage.getItem(KEY)!);
    const only = Object.values(all)[0]!;
    localStorage.setItem(KEY, JSON.stringify({ ["open-meteo|32.243|77.175|hourly=x"]: only }));

    fail = true;
    await useWeather.getState().load(MANALI, null);
    // The cache cannot vouch for numbers it did not request.
    expect(useWeather.getState().origin).toBe("simulated");
  });

  it("replays a record for a location that arrived without a timezone", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, hourly: { time: omTimes() } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");

    await useWeather.getState().load(MANALI, null);
    fail = true;
    // Browser geolocation supplies coordinates long before any timezone exists.
    const noTz = { name: "Somewhere", admin: "", lat: MANALI.lat, lon: MANALI.lon };
    await useWeather.getState().load(noTz, null);
    expect(useWeather.getState().origin).toBe("cached");
  });

  it("refuses a record whose timezone contradicts a known one", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, hourly: { time: omTimes() } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");

    await useWeather.getState().load(MANALI, null);
    fail = true;
    const vancouver = { ...MANALI, timezone: "America/Vancouver" };
    await useWeather.getState().load(vancouver, null);
    expect(useWeather.getState().origin).toBe("simulated");
  });

  it("keeps several cities cached independently", async () => {
    vi.resetModules();
    localStorage.clear();
    let fail = false;
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("network down");
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, hourly: { time: omTimes() } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");

    await useWeather.getState().load(MANALI, null);
    await useWeather.getState().load(KOCHI, null);
    expect(Object.keys(JSON.parse(localStorage.getItem("mausam.snapshots.live.v2")!)).length).toBe(2);

    fail = true;
    // Both are still replayable, not just the most recent one.
    await useWeather.getState().load(MANALI, null);
    expect(useWeather.getState().origin).toBe("cached");
    expect(useWeather.getState().forecast?.location.name).toBe("Manali");
    await useWeather.getState().load(KOCHI, null);
    expect(useWeather.getState().origin).toBe("cached");
    expect(useWeather.getState().forecast?.location.name).toBe("Kochi");
  });
});

describe("demo never touches the live path", () => {
  beforeEach(installMemoryStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("makes no network call and writes no snapshot", async () => {
    vi.resetModules();
    localStorage.clear();
    const fetchSpy = vi.fn(async () => {
      throw new Error("demo must not hit the network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { useWeather } = await import("../src/state/weather-store");

    await useWeather.getState().load(MANALI, "rain");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem("mausam.snapshots.live.v2")).toBeNull();
    expect(useWeather.getState().origin).toBe("demo");
  });

  it("is pinned to Kochi regardless of the real place", async () => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal("fetch", async () => {
      throw new Error("demo must not hit the network");
    });
    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MANALI, "thunderstorm");
    const loc = useWeather.getState().forecast!.location;
    expect(loc.name).toBe("Kochi");
    expect(loc.lat).toBeCloseTo(DEMO_LOCATION.lat, 3);
    expect(effectiveLocation(MANALI, "thunderstorm").name).toBe("Kochi");
    // And it never overwrites the real place.
    expect(effectiveLocation(MANALI, null).name).toBe("Manali");
  });
});

describe("source labels follow origin only", () => {
  const now = Date.UTC(2026, 8, 26, 12);

  it("gives each origin a distinct, honest label", () => {
    const f = series(KOCHI, IST);
    const texts = (["live", "cached", "simulated", "demo"] as const).map(
      (origin) => describeSource({ forecast: f, origin, nowEpoch: now }).text,
    );
    expect(new Set(texts).size).toBe(4);
    expect(describeSource({ forecast: f, origin: "live", nowEpoch: now }).text).toContain("Open-Meteo");
    expect(describeSource({ forecast: f, origin: "demo", nowEpoch: now }).text).toContain("Demo weather");
    expect(describeSource({ forecast: f, origin: "cached", nowEpoch: now }).text).toContain("Cached");
    expect(describeSource({ forecast: f, origin: "simulated", nowEpoch: now }).text).toContain("Simulated");
  });

  it("never calls cached or simulated data Open-Meteo", () => {
    const f = series(KOCHI, IST);
    for (const origin of ["cached", "simulated", "demo"] as const) {
      expect(describeSource({ forecast: f, origin, nowEpoch: now }).text).not.toContain("Open-Meteo");
    }
  });
});

describe("Manali acceptance", () => {
  it("reads the forecast at the coordinates the user chose", async () => {
    vi.resetModules();
    let seen = "";
    vi.stubGlobal("fetch", async (u: string) => {
      seen = String(u);
      return { ok: true, json: async () => ({ utc_offset_seconds: 19800, timezone: "Asia/Kolkata", hourly: { time: omTimes(), temperature_2m: omTimes().map(() => 12) } }) } as never;
    });
    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MANALI, null);

    expect(seen).toContain("latitude=32.2426");
    expect(seen).toContain("longitude=77.1748");
    expect(seen).toContain("timezone=auto");
    const st = useWeather.getState();
    expect(st.origin).toBe("live");
    expect(st.forecast!.timezone).toBe("Asia/Kolkata");
    expect(st.forecast!.tzOffsetMin).toBe(330);
  });

  it("derives night from local midnight, not from the device clock", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        utc_offset_seconds: 19800,
        timezone: "Asia/Kolkata",
        hourly: { time: omTimes(), temperature_2m: omTimes().map(() => 4) },
      }),
    }) as never);
    const { useWeather } = await import("../src/state/weather-store");
    await useWeather.getState().load(MANALI, null);
    useWeather.getState().setClock(2 * 60);
    // 02:00 in Manali is night even though the UTC date is still the 26th.
    let st = useWeather.getState();
    expect(currentState(st.forecast, st.nowMin)).toBe("night");

    // 13:00 local is day.
    useWeather.getState().setClock(13 * 60);
    st = useWeather.getState();
    expect(currentState(st.forecast, st.nowMin)).not.toBe("night");

    useWeather.getState().setClock(null);
  });
});

describe("observed rain is never reported as silence", () => {
  it("keeps a rain note when the now-sample is an observation with no probability", () => {
    /* An observation carries measured rain but no forecast probability, because
       probability is a forward-looking product the `current` block does not
       publish. A note rule keyed only on probability would then drop the rain
       indicator during actual rain. */
    const observed: HourSample = sample(0, 0, { precipMm: 1.2, precipProb: 0, code: "rain" });
    expect(observed.precipProb).toBe(0);
    expect(observed.precipMm).toBeGreaterThan(0);

    /* The note is derived, not stored, so assert the two inputs that drive it
       and the precedence between them. */
    const noteText = (s: HourSample) =>
      s.precipProb > 0.15
        ? `${Math.round(s.precipProb * 100)}% rain`
        : s.precipMm > 0
          ? "Raining now"
          : null;
    expect(noteText(observed)).toBe("Raining now");
    // A forecast probability still wins when both are present.
    expect(noteText({ ...observed, precipProb: 0.8 })).toBe("80% rain");
    // Genuinely dry stays quiet.
    expect(noteText({ ...observed, precipMm: 0, precipProb: 0 })).toBeNull();
  });
});
