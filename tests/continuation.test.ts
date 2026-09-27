import { describe, expect, it } from "vitest";
import { continuation } from "../src/lib/continuation";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import type { HourSample, NormalizedForecast, WeatherState } from "../src/domain/weather";
import { IST_OFFSET_MIN } from "../src/data/mock";

const AT = Date.UTC(2026, 8, 26, 6, 0);
const spec = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function scenarioForecast(id: string): NormalizedForecast {
  const s = spec(id);
  return {
    location: { name: "Kochi", admin: "Kerala", lat: 9.93, lon: 76.27, timezone: "Asia/Kolkata" },
    tzOffsetMin: IST_OFFSET_MIN,
    timezone: "Asia/Kolkata",
    fetchedAt: AT,
    source: "mock",
    current: null,
    hourly: buildScenarioForecast(s, 9.93, IST_OFFSET_MIN, AT),
    ...(() => {
      const d = scenarioDayTimes(9.93, 76.27, AT);
      return { sunriseMin: d.sunriseMin, sunsetMin: d.sunsetMin };
    })(),
  };
}

/** Build a forecast from explicit hourly values, hour 0..23 local. */
function fromHours(hours: Array<Partial<HourSample>>): NormalizedForecast {
  const base: HourSample = {
    t: AT,
    hour: 0,
    tempC: 28,
    feelsC: 28,
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
  };
  // `t` must be the true instant of that local hour, otherwise the series
  // contradicts its own `hour` field once sampling reads real timestamps.
  const localMidnight = Math.floor(AT / 86400000) * 86400000 - IST_OFFSET_MIN * 60000;
  // 48 entries, as the live endpoint returns, so an 18-hour lookahead from late
  // in the day has real future hours to read instead of running off the end.
  const hourly: HourSample[] = Array.from({ length: 48 }, (_, i) => {
    const hour = i % 24;
    return { ...base, t: localMidnight + i * 3600_000, hour, ...hours[hour] };
  });
  return {
    location: { name: "Kochi", admin: "Kerala", lat: 9.93, lon: 76.27, timezone: "Asia/Kolkata" },
    tzOffsetMin: IST_OFFSET_MIN,
    timezone: "Asia/Kolkata",
    fetchedAt: AT,
    source: "mock",
    current: null,
    hourly,
    sunriseMin: 360,
    sunsetMin: 1080,
  };
}

describe("continuation", () => {
  it("always returns at most one line, for every state, from every scenario", () => {
    for (const s of SCENARIOS) {
      const f = scenarioForecast(s.id);
      // Walk the whole day so no hour of any scenario can produce a throw.
      for (let hour = 0; hour < 24; hour++) {
        const c = continuation(f, hour * 60, s.id as WeatherState);
        if (c) {
          expect(c.line.length, `${s.id} @ ${hour}:00`).toBeGreaterThan(0);
          expect(c.line.endsWith("."), `${s.id} @ ${hour}:00 — one sentence`).toBe(false);
        }
      }
    }
  });

  it("names the warmest stretch on a bright day", () => {
    // Peak plateau across 14:00-16:00. `fromHours` indexes by hour, so the
    // array has to be sparse up to 14 rather than listing hours in order.
    const hours = Array.from({ length: 24 }, () => ({ tempC: 30 }));
    hours[14] = { tempC: 33 };
    hours[15] = { tempC: 33.4 };
    hours[16] = { tempC: 32.6 };
    expect(continuation(fromHours(hours), 9 * 60, "sunny")?.line).toBe(
      "Warmest 2:00 PM–4:00 PM",
    );
  });

  it("does not claim a warm period that has already passed", () => {
    const hours = Array.from({ length: 24 }, () => ({ tempC: 30 }));
    hours[2] = { tempC: 33 };
    hours[3] = { tempC: 33.2 };
    // Looking from 6:00 PM, the warm stretch is behind us.
    expect(continuation(fromHours(hours), 18 * 60, "sunny")?.line).toMatch(/Holds warm near/);
  });

  it("says when rain lets up, and admits when it does not", () => {
    const easing = fromHours(
      Array.from({ length: 24 }, (_, hour) => ({
        precipProb: hour < 19 ? 0.8 : 0.05,
        precipMm: hour < 19 ? 3 : 0,
      })),
    );
    expect(continuation(easing, 16 * 60, "rain")?.line).toBe("Rain eases around 7:00 PM");

    const allDay = fromHours(
      Array.from({ length: 24 }, () => ({ precipProb: 0.9, precipMm: 4 })),
    );
    expect(continuation(allDay, 16 * 60, "rain")?.line).toBe("Rain holding on through the evening");
  });

  it("reports fog clearing only once visibility actually recovers", () => {
    const clearing = fromHours(
      Array.from({ length: 24 }, (_, hour) => ({ visibilityKm: hour < 9 ? 1.2 : 14 })),
    );
    expect(continuation(clearing, 6 * 60, "fog")?.line).toBe("Visibility improving around 9:00 AM");

    const stuck = fromHours(Array.from({ length: 24 }, () => ({ visibilityKm: 1.1 })));
    expect(continuation(stuck, 6 * 60, "fog")?.line).toBe("Visibility may stay reduced all night");
  });

  it("describes the direction cloud is actually moving", () => {
    const building = fromHours(
      Array.from({ length: 24 }, (_, hour) => ({ cloudCover: hour < 18 ? 0.3 : 0.85 })),
    );
    expect(continuation(building, 16 * 60, "cloudy")?.line).toBe(
      "Cloud cover building after 6:00 PM",
    );

    const steady = fromHours(Array.from({ length: 24 }, () => ({ cloudCover: 0.5 })));
    expect(continuation(steady, 16 * 60, "cloudy")?.line).toBe(
      "Cloud holding steady through the evening",
    );
  });

  it("summarises the night by the cloud that is actually left", () => {
    const clear = fromHours(Array.from({ length: 24 }, () => ({ cloudCover: 0.05 })));
    expect(continuation(clear, 22 * 60, "night")?.line).toBe("Clear skies hold until sunrise");

    const thick = fromHours(Array.from({ length: 24 }, () => ({ cloudCover: 0.9 })));
    expect(continuation(thick, 22 * 60, "night")?.line).toBe("Cloud thickening towards morning");
  });

  it("waits for a storm to actually ease before saying so", () => {
    const easing = fromHours(
      Array.from({ length: 24 }, (_, hour) => ({ thunderProb: hour < 20 ? 0.7 : 0.02 })),
    );
    expect(continuation(easing, 17 * 60, "thunderstorm")?.line).toBe(
      "Thunder easing after 8:00 PM",
    );
  });
});
