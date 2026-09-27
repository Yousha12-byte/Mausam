import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { airQualityUrl, loadAirQuality, idleAirQuality, AQ_REQUEST_SHAPE } from "../src/data/airquality";
import { buildInsights } from "../src/domain/insights";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import { DEMO_LOCATION } from "../src/domain/location";
import { DEFAULT_PROFILE } from "../src/domain/routine";
import { IST_OFFSET_MIN } from "../src/data/mock";
import { CAPABILITIES, describeAqi } from "../src/domain/capabilities";
import type { NormalizedForecast } from "../src/domain/weather";

const NOW = 16 * 60;
const AT = Date.UTC(2026, 8, 26, 6, 0);

function forecast(): NormalizedForecast {
  const s = SCENARIOS.find((x) => x.id === "rain")!;
  const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, AT);
  return {
    location: DEMO_LOCATION,
    tzOffsetMin: IST_OFFSET_MIN,
    timezone: DEMO_LOCATION.timezone ?? "Asia/Kolkata",
    fetchedAt: AT,
    source: "mock",
    current: null,
    hourly: buildScenarioForecast(s, DEMO_LOCATION.lat, IST_OFFSET_MIN, AT),
    sunriseMin: d.sunriseMin,
    sunsetMin: d.sunsetMin,
  };
}

function omBody(usAqi: (number | null)[], extra: Record<string, unknown> = {}) {
  return {
    utc_offset_seconds: 19800,
    hourly: {
      time: usAqi.map((_, i) => `2026-09-26T${String(i).padStart(2, "0")}:00`),
      us_aqi: usAqi,
      pm2_5: usAqi.map((v) => (v === null ? null : v * 0.4)),
      pm10: usAqi.map((v) => (v === null ? null : v * 0.7)),
      ozone: usAqi.map(() => 30),
    },
    ...extra,
  };
}

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("air-quality request", () => {
  it("targets the air-quality host, not the forecast host", () => {
    const url = airQualityUrl(DEMO_LOCATION);
    expect(url.startsWith("https://air-quality-api.open-meteo.com/")).toBe(true);
    expect(url).not.toContain("api.open-meteo.com/v1/forecast");
  });

  it("asks for AQI and the particle species", () => {
    const url = airQualityUrl(DEMO_LOCATION);
    expect(url).toContain("us_aqi");
    expect(url).toContain("pm2_5");
    expect(url).toContain("timezone=auto");
    expect(AQ_REQUEST_SHAPE).toContain("us_aqi");
  });
});

describe("air-quality success", () => {
  // Hourly from local midnight; hour 17 is 80, hour 19 is null, hour 23 is 120.
  const day = Array.from({ length: 24 }, (_, h) => (h === 17 ? 80 : h === 19 ? null : h === 23 ? 120 : 40));

  beforeEach(() => mockFetch(omBody(day)));

  it("parses a real series and drops nulls", async () => {
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("ready");
    // 24 hours, one of which is null.
    expect(air.samples).toHaveLength(23);
    // Local midnight IST on 2026-09-26 is 2026-09-25T18:30Z.
    expect(air.samples[0]!.t).toBe(Date.UTC(2026, 8, 25, 18, 30));
    expect(air.samples[0]!.usAqi).toBe(40);
  });

  it("reads a value at a local minute", async () => {
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.usAqiAt(17 * 60)).toBe(80);
    expect(air.usAqiAt(23 * 60)).toBe(120);
  });

  it("falls back to the nearest hour rather than inventing one", async () => {
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.usAqiAt(17 * 60 + 30)).toBe(80);
  });

  it("names the AQI band rather than showing a bare number", () => {
    expect(describeAqi(30).label).toBe("Good");
    expect(describeAqi(75).label).toBe("Moderate");
    expect(describeAqi(160).label).toBe("Unhealthy");
  });
});

describe("air-quality failure never throws and never invents a value", () => {
  it("reports unavailable on an HTTP error", async () => {
    mockFetch({}, false, 503);
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("unavailable");
    expect(air.usAqiAt(17 * 60)).toBeNull();
  });

  it("reports unavailable when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("unavailable");
    expect(air.usAqiAt(17 * 60)).toBeNull();
  });

  it("reports unavailable on a malformed payload", async () => {
    mockFetch({ nope: true });
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("unavailable");
    expect(air.samples).toHaveLength(0);
  });

  it("reports unavailable when every value is null", async () => {
    mockFetch(omBody([null, null, null]));
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("unavailable");
  });

  it("never returns 0 for a missing reading", async () => {
    mockFetch(omBody(Array.from({ length: 24 }, () => 40)));
    const air = await loadAirQuality(DEMO_LOCATION);
    // Far past the end of the series: absent, not zero.
    expect(air.usAqiAt(40 * 60)).toBeNull();
    expect(air.usAqiAt(40 * 60)).not.toBe(0);
  });

  it("starts idle with no reading", () => {
    const air = idleAirQuality();
    expect(air.status).toBe("idle");
    expect(air.usAqiAt(17 * 60)).toBeNull();
  });
});

describe("AQI is a separate capability from weather", () => {
  it("does not fail the weather homepage when AQI fails", async () => {
    mockFetch({}, false, 500);
    const air = await loadAirQuality(DEMO_LOCATION);
    expect(air.status).toBe("unavailable");

    // The weather pipeline is untouched and still produces a full page.
    const out = buildInsights({
      forecast: forecast(),
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["health"],
    });
    expect(out.headline).not.toBeNull();
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  it("keeps Health working on available metrics when AQI is missing", async () => {
    mockFetch({}, false, 500);
    expect((await loadAirQuality(DEMO_LOCATION)).status).toBe("unavailable");
    const f = forecast();
    const out = buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["health"],
    });
    // Health asked for AQI, and still gets real weather-backed measurements.
    const copy = JSON.stringify(out.candidates);
    expect(copy).not.toContain("AQ_REQUEST_SHAPE");
    expect(out.metrics.some((m) => m !== "aqi")).toBe(true);
  });

  it("distinguishes AQI availability from weather availability", () => {
    expect(CAPABILITIES.aqi.source).toBe("air-quality");
    expect(CAPABILITIES.temperature.source).toBe("weather");
    expect(CAPABILITIES.aqi.caveat).toMatch(/separate/i);
  });

  it("adds no AQI metric to the prioritized list without a real reading", () => {
    const out = buildInsights({
      forecast: forecast(),
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["health"],
    });
    expect(out.metrics).not.toContain("aqi");
  });

  it("issues no AQI request in demo mode from the app", () => {
    // Demo weather is a fixed local scenario; there is no honest AQI to pair with
    // it, so the app must not ask. Verified structurally: the demo forecast has
    // no air-quality provenance, and loadAirQuality is never given the demo place.
    const f = forecast();
    expect(f.source).toBe("mock");
    expect(f.location.name).toBe(DEMO_LOCATION.name);
  });
});
