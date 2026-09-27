import { describe, expect, it } from "vitest";
import {
  dayOfYear,
  lunarPhase,
  moonPosition,
  phaseLabel,
  solarNoonMinutes,
  sunriseSunset,
  sunPosition,
} from "../src/domain/solar";
import { deriveAtmosphere } from "../src/atmosphere/derive";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import { IST_OFFSET_MIN } from "../src/data/mock";
import type { NormalizedForecast } from "../src/domain/weather";

const KOCHI = 9.9312;
const DELHI = 28.6139;
/** 2026-09-26 — day 269, near the equinox. */
const DAY = 269;
const DATE = new Date(Date.UTC(2026, 8, 26, 12, 0));

const LON = 76.2673;
const solarNoonH = (lon: number) => solarNoonMinutes(lon) / 60;

describe("sun azimuth", () => {
  it("rises in the east and sets in the west", () => {
    const { sunriseMin, sunsetMin } = sunriseSunset(KOCHI, DAY, LON);
    const noon = solarNoonH(LON);
    const rise = sunPosition(KOCHI, DAY, sunriseMin / 60 - noon);
    const set = sunPosition(KOCHI, DAY, sunsetMin / 60 - noon);

    // East is 90, west is 270. This is the check that catches an inverted sky.
    expect(rise.azimuth).toBeGreaterThan(60);
    expect(rise.azimuth).toBeLessThan(120);
    expect(set.azimuth).toBeGreaterThan(240);
    expect(set.azimuth).toBeLessThan(300);
  });

  it("is highest at solar noon and lowest at midnight", () => {
    const atNoon = sunPosition(KOCHI, DAY, 0).elevation;
    const before = sunPosition(KOCHI, DAY, -1).elevation;
    const after = sunPosition(KOCHI, DAY, 1).elevation;
    const midnight = sunPosition(KOCHI, DAY, 12).elevation;
    expect(atNoon).toBeGreaterThan(before);
    expect(atNoon).toBeGreaterThan(after);
    expect(midnight).toBeLessThan(0);
  });

  it("transits due south at solar noon in the northern hemisphere", () => {
    const az = sunPosition(KOCHI, DAY, 0).azimuth;
    const delta = Math.abs(((az - 180 + 540) % 360) - 180);
    expect(delta).toBeLessThan(25);
  });

  it("gives a longer day at lower latitude near the equinox", () => {
    const delhi = sunriseSunset(DELHI, DAY, 77.1);
    const kochi = sunriseSunset(KOCHI, DAY, LON);
    const dayLen = (s: { sunriseMin: number; sunsetMin: number }) => s.sunsetMin - s.sunriseMin;
    expect(dayLen(kochi)).toBeGreaterThan(dayLen(delhi));
  });

  it("gives a short day in northern winter", () => {
    const winter = sunriseSunset(KOCHI, 15, LON); // mid-January
    const summer = sunriseSunset(KOCHI, 196, LON); // mid-July
    expect(winter.sunsetMin - winter.sunriseMin).toBeLessThan(
      summer.sunsetMin - summer.sunriseMin,
    );
  });

  it("keeps sunrise before sunset for an Indian latitude all year", () => {
    for (let d = 1; d <= 365; d += 5) {
      const { sunriseMin, sunsetMin } = sunriseSunset(KOCHI, d, LON);
      expect(sunsetMin).toBeGreaterThan(sunriseMin);
      expect(sunriseMin).toBeGreaterThan(240); // before 4 AM
      expect(sunsetMin).toBeLessThan(1200); // before 8 PM
    }
  });
});

describe("moon", () => {
  it("runs a full 29.5-day cycle", () => {
    expect(lunarPhase(new Date(Date.UTC(2026, 8, 26)))).toBeGreaterThan(0.4);
    expect(lunarPhase(new Date(Date.UTC(2026, 8, 26)))).toBeLessThan(0.6);
  });

  it("rises in the east and sets in the west like the sun", () => {
    const p = moonPosition(KOCHI, DAY, 6, DATE);
    expect(p.azimuth).toBeGreaterThan(0);
    expect(p.azimuth).toBeLessThan(360);
    // Never straight overhead or at the nadir for this latitude.
    expect(Math.abs(p.elevation)).toBeLessThan(89);
  });

  it("is opposite the sun at full moon", () => {
    // A full moon rises around sunset, so it must be near the eastern horizon
    // at the hour the sun sets.
    const { sunsetMin } = sunriseSunset(KOCHI, DAY, LON);
    const noon = solarNoonH(LON);
    const moonAtSunset = moonPosition(KOCHI, DAY, sunsetMin / 60 - noon, DATE);
    const sunAtSunset = sunPosition(KOCHI, DAY, sunsetMin / 60 - noon);
    expect(Math.abs(moonAtSunset.elevation)).toBeLessThan(20);
    expect(sunAtSunset.elevation).toBeLessThan(5);
  });

  it("names every phase without throwing", () => {
    for (let p = 0; p < 1; p += 0.05) expect(phaseLabel(p).length).toBeGreaterThan(3);
  });
});

describe("deriveAtmosphere (pure)", () => {
  const AT = Date.UTC(2026, 8, 26, 6, 0);
  function fc(id: string): NormalizedForecast {
    const s = SCENARIOS.find((x) => x.id === id)!;
    const d = scenarioDayTimes(KOCHI, 76.2673, AT);
    return {
      location: { name: "Kochi", admin: "Kerala", lat: KOCHI, lon: 76.2673, timezone: "Asia/Kolkata" },
      tzOffsetMin: IST_OFFSET_MIN,
      timezone: "Asia/Kolkata",
      fetchedAt: AT,
      source: "mock",
      current: null,
      hourly: buildScenarioForecast(s, KOCHI, IST_OFFSET_MIN, AT),
      sunriseMin: d.sunriseMin,
      sunsetMin: d.sunsetMin,
    };
  }

  it("derives every scenario without throwing", () => {
    for (const s of SCENARIOS) {
      const a = deriveAtmosphere(fc(s.id), 12 * 60);
      expect(a.state).toBeTruthy();
      expect(a.precipIntensity).toBeGreaterThanOrEqual(0);
      expect(a.precipIntensity).toBeLessThanOrEqual(1);
      expect(a.cloudCover).toBeLessThanOrEqual(1);
    }
  });

  it("makes heavy rain visibly heavier than light rain", () => {
    const light = deriveAtmosphere(fc("rain"), 16 * 60);
    const heavy = deriveAtmosphere(fc("rain"), 18 * 60);
    const storm = deriveAtmosphere(fc("thunderstorm"), 17 * 60);
    expect(heavy.precipIntensity).toBeGreaterThan(light.precipIntensity);
    expect(storm.precipIntensity).toBeGreaterThan(heavy.precipIntensity);
  });

  it("reports night when the sun is well below the horizon", () => {
    const night = deriveAtmosphere(fc("night"), 21 * 60 + 40);
    expect(night.isDaylight).toBe(false);
    expect(night.state).toBe("night");
  });

  it("places the sun in the eastern half of the sky in the morning", () => {
    const morning = deriveAtmosphere(fc("sunny"), 8 * 60);
    expect(morning.sunAzimuth).toBeGreaterThan(45);
    expect(morning.sunAzimuth).toBeLessThan(180);
  });

  it("places the sun in the western half of the sky in the evening", () => {
    const evening = deriveAtmosphere(fc("sunny"), 17 * 60);
    expect(evening.sunAzimuth).toBeGreaterThan(240);
  });

  it("keeps dayOfYear stable", () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(dayOfYear(new Date(Date.UTC(2026, 8, 26)))).toBe(269);
  });
});

describe("scenario labels must match what the sky renders", () => {
  /* A scenario button that shows a different sky than its label is a lie the
     presenter cannot recover from. Each scenario therefore pins its own clock,
     and this test fails the moment someone edits a curve without re-pinning. */
  it("renders the state its id promises, at any hour of the day", () => {
    for (const hour of [0, 4, 8, 12, 16, 20, 23]) {
      const at = Date.UTC(2026, 8, 26, hour, 0);
      for (const s of SCENARIOS) {
        const d = scenarioDayTimes(KOCHI, 76.2673, at);
        const forecast: NormalizedForecast = {
          location: { name: "Kochi", admin: "Kerala", lat: KOCHI, lon: 76.2673, timezone: "Asia/Kolkata" },
          tzOffsetMin: IST_OFFSET_MIN,
          timezone: "Asia/Kolkata",
          fetchedAt: at,
          source: "mock",
          current: null,
          hourly: buildScenarioForecast(s, KOCHI, IST_OFFSET_MIN, at),
          sunriseMin: d.sunriseMin,
          sunsetMin: d.sunsetMin,
        };
        const nowMin = s.clockMin ?? ((at / 60000 + IST_OFFSET_MIN) % 1440);
        const a = deriveAtmosphere(forecast, nowMin);
        expect(`${s.id}@${hour}h -> ${a.state}`).toBe(`${s.id}@${hour}h -> ${s.id}`);
      }
    }
  });

  it("gives every scenario a pinned clock so the demo cannot drift", () => {
    for (const s of SCENARIOS) {
      expect(`${s.id}:${s.clockMin === undefined}`).toBe(`${s.id}:false`);
    }
  });
});

describe("time-of-day greeting is location-local, not device-local", () => {
  /* Regression: the greeting used to be `new Date(nowMin * 60000).getHours()`,
     which resolves in the *device's* timezone. A viewer in UTC therefore saw
     "Good morning" under a 9:40 PM Kerala sky, and "Good afternoon" at 6:30 AM
     fog. nowMin is already minutes-local-to-the-location, so it must be read
     with arithmetic only. */
  function greetingFor(nowMin: number): string {
    const hour24 = Math.floor((((nowMin % 1440) + 1440) % 1440) / 60);
    return hour24 < 12 ? "Good morning" : hour24 < 17 ? "Good afternoon" : "Good evening";
  }

  it("greets correctly for every scenario's pinned clock", () => {
    const want: Record<string, string> = {
      sunny: "Good afternoon", // 15:00
      cloudy: "Good morning", // 10:00
      rain: "Good afternoon", // 16:20 is still afternoon
      thunderstorm: "Good evening", // 17:10
      fog: "Good morning", // 06:30
      night: "Good evening", // 21:40
    };
    for (const s of SCENARIOS) {
      expect(`${s.id}:${greetingFor(s.clockMin!)}`).toBe(`${s.id}:${want[s.id]}`);
    }
  });

  it("is independent of the machine timezone", () => {
    // Same input, any TZ: the original implementation changed with TZ.
    for (const tz of ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"]) {
      expect(`${tz}:${greetingFor(21 * 60 + 40)}`).toBe(`${tz}:Good evening`);
      expect(`${tz}:${greetingFor(6 * 60 + 30)}`).toBe(`${tz}:Good morning`);
      expect(`${tz}:${greetingFor(15 * 60)}`).toBe(`${tz}:Good afternoon`);
    }
  });

  it("wraps safely at the day boundary", () => {
    expect(greetingFor(0)).toBe("Good morning");
    expect(greetingFor(1440)).toBe("Good morning");
    expect(greetingFor(23 * 60 + 59)).toBe("Good evening");
  });
});
