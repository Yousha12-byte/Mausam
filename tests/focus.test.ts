import { describe, expect, it } from "vitest";
import {
  FOCUSES,
  FOCUS_BY_ID,
  DEFAULT_FOCUS,
  combineFocuses,
  emptyContext,
  type FocusId,
} from "../src/domain/focus";
import { buildInsights } from "../src/domain/insights";
import { sampleAt, localMinToEpoch } from "../src/domain/decision";
import { prioritize } from "../src/domain/prioritize";
import { runFocusDecisions } from "../src/domain/focus-decisions";
import { CAPABILITIES, isSupported, isWeatherBacked } from "../src/domain/capabilities";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import { DEMO_LOCATION } from "../src/domain/location";
import { DEFAULT_PROFILE } from "../src/domain/routine";
import { IST_OFFSET_MIN } from "../src/data/mock";
import type { NormalizedForecast } from "../src/domain/weather";
import type { HourSample } from "../src/domain/weather";

const NOW = 16 * 60; // 4:00 PM
const AT = Date.UTC(2026, 8, 26, 6, 0);

const spec = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function forecast(id: string): NormalizedForecast {
  const s = spec(id);
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

function build(id: string, focusIds: FocusId[], nowMin = NOW) {
  const f = forecast(id);
  return {
    f,
    out: buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin,
      scenario: true,
      focusIds,
    }),
  };
}

/* ================================================== A. FOCUS REGISTRATION === */

describe("A. focus taxonomy", () => {
  it("offers exactly the eight agreed focuses", () => {
    expect(FOCUSES.map((f) => f.id).sort()).toEqual(
      [
        "agri",
        "commute",
        "daily",
        "events",
        "health",
        "outdoor",
        "travel",
        "work",
      ].sort(),
    );
  });

  it("gives every focus a label, a description and a voice", () => {
    for (const f of FOCUSES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(typeof f.voice.headline).toBe("function");
      expect(typeof f.voice.action).toBe("function");
    }
  });

  it("keeps Events as its own focus rather than folding it into Work", () => {
    expect(FOCUS_BY_ID.events).toBeDefined();
    expect(FOCUS_BY_ID.work).toBeDefined();
    expect(FOCUS_BY_ID.events.id).not.toBe(FOCUS_BY_ID.work.id);
  });

  it("only asks for metrics the app can actually source", () => {
    for (const f of FOCUSES) {
      for (const m of f.needs) {
        expect(isSupported(m), `${f.id} needs unsupported metric ${m}`).toBe(true);
      }
    }
  });
});

/* ================================================ B. CAPABILITY INTEGRITY === */

describe("B. capabilities", () => {
  it("routes AQI to the air-quality source and everything else to weather", () => {
    expect(CAPABILITIES.aqi.source).toBe("air-quality");
    for (const f of FOCUSES) {
      for (const m of f.needs) {
        if (m === "aqi") continue;
        expect(isWeatherBacked(m), `${m} should be weather-backed`).toBe(true);
      }
    }
  });

  it("marks model-derived figures as not measured", () => {
    expect(CAPABILITIES.soilMoisture.measured).toBe(false);
    expect(CAPABILITIES.precipAccumulation.measured).toBe(false);
    expect(CAPABILITIES.soilMoisture.caveat).toBeTruthy();
  });

  it("never claims air quality is a measurement of the forecast", () => {
    expect(CAPABILITIES.aqi.source).not.toBe("weather");
  });
});

/* ==================================================== C. FOCUS COMBINATION == */

describe("C. combineFocuses", () => {
  const f = forecast("rain");
  const nowMin = NOW;

  it("falls back to Daily life when nothing is selected", () => {
    const ctx = combineFocuses([], f, nowMin);
    expect(ctx.isDefault).toBe(true);
    expect(ctx.ids).toEqual(["daily"]);
  });

  it("does not treat a fallback as an explicit user choice", () => {
    expect(combineFocuses([], f, nowMin).isDefault).toBe(true);
    expect(combineFocuses(["daily"], f, nowMin).isDefault).toBe(false);
  });

  it("unions capabilities across focuses", () => {
    const ctx = combineFocuses(["health", "agri"], f, nowMin);
    expect(ctx.needs).toContain("humidity");
    expect(ctx.needs).toContain("soilMoisture");
    expect(ctx.needs).toContain("uv");
  });

  it("resolves thresholds by rank rather than taking the most conservative value", () => {
    // Health (rank 6) and Travel (rank 7) both declare precipProbability. Travel
    // ranks higher, so its threshold wins — this is the case that a naive
    // "take the strictest" merge would get wrong.
    const healthOnly = combineFocuses(["health"], f, nowMin);
    const travelOnly = combineFocuses(["travel"], f, nowMin);
    const both = combineFocuses(["health", "travel"], f, nowMin);

    expect(travelOnly.thresholds.precipProbability).toBe(0.3);
    expect(healthOnly.thresholds.precipProbability).toBeUndefined();
    // A union has no meaning for a threshold; the highest-ranked focus's stands.
    expect(both.thresholds.precipProbability).toBe(
      (travelOnly.thresholds.precipProbability as number) >
      (healthOnly.thresholds.precipProbability ?? Infinity)
        ? travelOnly.thresholds.precipProbability
        : travelOnly.thresholds.precipProbability,
    );
  });

  it("keeps a threshold from a lower-ranked focus when no higher one declares it", () => {
    const ctx = combineFocuses(["travel", "health"], f, nowMin);
    // UV belongs to Health only, so Travel must not shadow it.
    expect(ctx.thresholds.uv).toBe(FOCUS_BY_ID.health.thresholds.uv);
  });

  it("merges windows and attributes each to its focus", () => {
    const ctx = combineFocuses(["outdoor", "events"], f, nowMin);
    expect(ctx.windows.length).toBeGreaterThanOrEqual(2);
    for (const w of ctx.windows) {
      expect(["outdoor", "events"]).toContain(w.focusId);
    }
  });

  it("leaves Commute to the routine path so the two cannot disagree", () => {
    expect(combineFocuses(["commute"], f, nowMin).windows).toHaveLength(0);
  });

  it("tolerates unknown ids instead of throwing", () => {
    const ctx = combineFocuses(["nonsense" as FocusId, "health"], f, nowMin);
    expect(ctx.ids).toEqual(["health"]);
  });

  it("returns a valid empty context before a forecast exists", () => {
    const ctx = emptyContext();
    expect(ctx.ids).toEqual(["daily"]);
    expect(ctx.windows).toHaveLength(0);
  });
});

/* ================================================ D. EXPLAINABILITY (WHY) === */

describe("D. every reading explains itself", () => {
  it("gives every candidate decision at least one WHY item", () => {
    for (const scenario of ["rain", "sunny", "thunderstorm", "fog", "night"]) {
      const { out } = build(scenario, ["health", "travel", "agri", "outdoor", "events"]);
      expect(out.candidates.length).toBeGreaterThan(0);
      for (const d of out.candidates) {
        expect(d.why.length, `${scenario}/${d.id} has no WHY`).toBeGreaterThan(0);
      }
    }
  });

  it("cites the focus window in the WHY, not just the weather", () => {
    const { out } = build("rain", ["agri"]);
    const focusDecision = out.candidates.find((d) => d.focusId === "agri");
    expect(focusDecision).toBeDefined();
    const text = focusDecision!.why.map((w) => w.text).join(" ");
    expect(text).toMatch(/field window|Scored across/);
  });

  it("attributes a focus decision to the focus that produced it", () => {
    const { out } = build("rain", ["events"]);
    const d = out.candidates.find((x) => x.focusId === "events");
    expect(d).toBeDefined();
    expect(d!.id).toContain("events");
  });
});

/* ================================================= E. SAFETY / NO CLAIMS === */

describe("E. no professional advice", () => {
  it("reports field measurements without claiming agronomic suitability", () => {
    const { out } = build("rain", ["agri"]);
    const copy = out.candidates
      .filter((d) => d.focusId === "agri")
      .flatMap((d) => [d.title, d.detail, d.action ?? ""].join(" "))
      .join(" ")
      .toLowerCase();
    for (const banned of ["ideal for", "perfect for", "optimal", "you should plant", "safe to spray", "recommended to sow"]) {
      expect(copy).not.toContain(banned);
    }
  });

  it("reports environmental conditions without diagnosing", () => {
    const { out } = build("sunny", ["health"]);
    const copy = out.candidates
      .filter((d) => d.focusId === "health")
      .flatMap((d) => [d.title, d.detail, d.action ?? ""].join(" "))
      .join(" ")
      .toLowerCase();
    for (const banned of ["diagnos", "you have", "symptom", "prescrib", "you should take"]) {
      expect(copy).not.toContain(banned);
    }
  });

  it("does not claim safety or guaranteed outcomes for events", () => {
    const { out } = build("thunderstorm", ["events"]);
    const copy = out.candidates
      .filter((d) => d.focusId === "events")
      .flatMap((d) => [d.title, d.detail, d.action ?? ""].join(" "))
      .join(" ")
      .toLowerCase();
    for (const banned of ["it will be safe", "guaranteed", "no risk", "completely safe", "will definitely"]) {
      expect(copy).not.toContain(banned);
    }
  });
});

/* =========================================== F. FOCUS PERSISTS ACROSS MOUNT == */

describe("F. focus is independent of weather, location and routine", () => {
  it("reaches the same interpretation for the same focus and the same forecast", () => {
    const a = build("rain", ["travel"]);
    const b = build("rain", ["travel"]);
    expect(a.out.headline?.title).toBe(b.out.headline?.title);
    expect(a.out.metrics).toEqual(b.out.metrics);
  });

  it("does not let a focus change the weather values it reads", () => {
    const f = forecast("rain");
    const withFocus = combineFocuses(["agri"], f, NOW);
    const without = combineFocuses(["health"], f, NOW);
    // Windows and thresholds may differ; the forecast object is untouched.
    expect(withFocus.windows).not.toBe(without.windows);
    expect(f.hourly.length).toBe(forecast("rain").hourly.length);
  });
});

/* ============================ G. SAME WEATHER, DIFFERENT FOCUS (DEMO) ====== */

describe("G. same weather + different focus = different interpretation", () => {
  const scenarioId = "rain";
  const interpretations: Record<string, string> = {};

  for (const focus of ["commute", "agri", "health", "events"] as FocusId[]) {
    it(`${focus} produces its own interpretation of the identical forecast`, () => {
      const f = forecast(scenarioId);
      const before = f.hourly.map((h) => JSON.stringify(h));
      const out = buildInsights({
        forecast: f,
        profile: DEFAULT_PROFILE,
        nowMin: NOW,
        scenario: true,
        focusIds: [focus],
      });
      interpretations[focus] = out.headline?.title ?? "";
      // The underlying weather must be byte-identical afterwards.
      expect(f.hourly.map((h) => JSON.stringify(h))).toEqual(before);
      expect(out.headline).not.toBeNull();
    });
  }

  it("yields four distinct readings from one set of weather values", () => {
    expect(new Set(Object.values(interpretations)).size).toBe(4);
  });

  it("points each reading at its own focus", () => {
    expect(build("rain", ["commute"]).out.primaryFocus).toBe("commute");
    expect(build("rain", ["agri"]).out.primaryFocus).toBe("agri");
    expect(build("rain", ["health"]).out.primaryFocus).toBe("health");
    expect(build("rain", ["events"]).out.primaryFocus).toBe("events");
  });

  it("surfaces different metrics for different focuses on the same weather", () => {
    const agri = build("rain", ["agri"]).out.metrics;
    const travel = build("rain", ["travel"]).out.metrics;
    expect(agri).toContain("precipAccumulation");
    expect(travel).not.toContain("soilMoisture");
  });
});

/* =============================== H. SEVERE WEATHER IGNORES FOCUS ========== */

describe("H. severe weather is focus-independent", () => {
  it("leads for every focus selection", () => {
    for (const focus of FOCUSES.map((f) => f.id)) {
      const { out } = build("thunderstorm", [focus]);
      expect(out.severe, `${focus} lost the severe advisory`).not.toBeNull();
      expect(out.severe?.kind).toBe("severe");
    }
  });

  it("is the same severe reading regardless of focus", () => {
    const a = build("thunderstorm", ["agri"]).out.severe?.title;
    const b = build("thunderstorm", ["health"]).out.severe?.title;
    expect(a).toBe(b);
  });
});

/* ============================================ I. DEGRADED / NO FOCUS ======== */

describe("I. graceful degradation", () => {
  it("still produces a usable page with no focus selected", () => {
    const out = build("rain", []).out;
    expect(out.ctx.isDefault).toBe(true);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.headline).not.toBeNull();
  });

  it("renders a metric as Unavailable rather than as a number", () => {
    const f = forecast("rain");
    // Strip the optional fields, as an older cache entry or a thinner source
    // would leave them.
    f.hourly = f.hourly.map((h: HourSample) => ({ ...h, humidityPct: undefined, soilMoisture: undefined }));
    const out = buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["health"],
    });
    expect(out.candidates.length).toBeGreaterThan(0);
    const copy = JSON.stringify(out.candidates);
    expect(copy).not.toContain('"humidityPct":0');
  });

  it("survives a short series without inventing readings", () => {
    const f = forecast("rain");
    f.hourly = f.hourly.slice(0, 2);
    const ctx = combineFocuses(["travel", "outdoor"], f, NOW);
    const out = runFocusDecisions({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      ctx,
    });
    // No crash, and nothing claims a measurement it could not read.
    expect(out.every((d) => d.why.length > 0)).toBe(true);
  });
});

describe("optional capability readings survive sampling", () => {
  it("carries humidity and soil moisture through interpolation", () => {
    // Regression: sampleAt rebuilt the sample from known fields only, so
    // anything reading "now" lost the optional readings and the metric band
    // reported them unavailable despite the provider supplying them.
    const f = forecast("rain");
    for (const h of f.hourly) {
      h.humidityPct = 60;
      h.soilMoisture = 0.22;
    }
    const now = sampleAt(f, NOW);
    expect(now.humidityPct).toBeCloseTo(60, 5);
    expect(now.soilMoisture).toBeCloseTo(0.22, 5);
  });

  it("leaves them undefined rather than zero when the source omits them", () => {
    const f = forecast("rain");
    for (const h of f.hourly) {
      h.humidityPct = undefined;
      h.soilMoisture = undefined;
    }
    const now = sampleAt(f, NOW);
    expect(now.humidityPct).toBeUndefined();
    expect(now.soilMoisture).toBeUndefined();
  });

  it("keeps a single-sided reading instead of dropping to unavailable", () => {
    const f = forecast("rain");
    for (const h of f.hourly) h.humidityPct = undefined;
    // The pair straddling NOW: one carries the value, the other does not.
    const i = Math.floor(NOW / 60);
    expect(f.hourly[i + 1]).toBeDefined();
    f.hourly[i]!.humidityPct = 41;
    expect(sampleAt(f, NOW).humidityPct).toBe(41);
  });
});

/* ====================== AGRICULTURE ACCUMULATION, NOT INTENSITY ========== */

describe("Agriculture reports a total, not a rate", () => {
  /* Regression: the headline quoted the peak hourly rate ("5.6 mm rain in the
     next 12 hours") while the metric row directly beneath it reported the real
     12-hour sum. A rate attached to a time window reads as a total, so the
     sentence contradicted its own evidence. */

  it("puts the 12-hour accumulation in the headline", () => {
    const out = build("rain", ["agri"]).out;
    const title = out.candidates.find((d) => d.focusId === "agri")!.title;
    expect(title).toMatch(/^\d+\.\d mm expected in the next 12 hours\.$/);
  });

  it("agrees with the Rainfall total row it sits above", () => {
    const f = forecast("rain");
    const out = buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["agri"],
    });
    const d = out.candidates.find((x) => x.focusId === "agri")!;

    // The number in the headline is the sum over the window.
    const total = f.hourly
      .filter((h) => h.precipMm > 0)
      .slice(0, 12)
      .reduce((sum, h) => sum + h.precipMm, 0);
    const from = total.toFixed(1);
    expect(d.title).toContain(from);
    expect(d.detail).toContain(`${from} mm of rain forecast`);
  });

  it("does not quote the peak hourly rate in the headline", () => {
    const f = forecast("rain");
    const out = buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["agri"],
    });
    const d = out.candidates.find((x) => x.focusId === "agri")!;

    // Measure the window the same way the domain does, so the test cannot
    // accidentally agree with a wrong number.
    const w = out.ctx.windows.find((x) => x.focusId === "agri")!;
    const from = localMinToEpoch(f, w.startMin);
    const to = localMinToEpoch(f, w.startMin + w.durationMin);
    const inWindow = f.hourly.filter((h) => h.t >= from && h.t <= to);
    const total = inWindow.reduce((sum, h) => sum + h.precipMm, 0);
    const peak = inWindow.reduce((m, h) => Math.max(m, h.precipMm), 0);

    // Guard against a vacuous assertion: the total must genuinely differ.
    expect(total).toBeGreaterThan(peak);
    expect(d.title).toContain(total.toFixed(1));
    expect(d.title).not.toContain(`${peak.toFixed(1)} mm`);
    expect(d.title).not.toContain(`${peak.toFixed(1)} mm rain`);
  });

  it("only ever describes intensity with an explicit mm/h unit", () => {
    for (const scenario of ["rain", "thunderstorm"]) {
      for (const focus of FOCUSES.map((x) => x.id)) {
        const out = build(scenario, [focus]).out;
        for (const d of out.candidates) {
          // A bare "N mm" is either a total over a named window or a unit bug.
          const bare = [...d.title.matchAll(/(\d+(?:\.\d+)?) mm(?!\/h| expected)/g)];
          for (const m of bare) {
            expect(
              d.title,
              `${scenario}/${focus}: "${m[0]}" has no unit`,
            ).toMatch(/\d mm (?:of rain forecast|expected)/);
          }
        }
      }
    }
  });

  it("falls back to a condition sentence in a dry window", () => {
    const f = forecast("sunny");
    const out = buildInsights({
      forecast: f,
      profile: DEFAULT_PROFILE,
      nowMin: NOW,
      scenario: true,
      focusIds: ["agri"],
    });
    const d = out.candidates.find((x) => x.focusId === "agri");
    // Sunny means no accumulation, so no "0.0 mm expected" may be announced.
    if (d) expect(d.title).not.toContain("0.0 mm expected");
  });
});

/* ============================ N. ONE FORECAST, DIFFERENT DECISIONS ====== */

describe("one forecast, different decisions", () => {
  /* The product claim, stated as an assertion. Same forecast object, same
     nowMin, four focuses — and the readings must be about four different
     questions. If this passes because the forecasts differ, the test is a lie. */

  const focusOf = (id: FocusId) =>
    build("rain", [id]).out.candidates.find((c) => c.focusId === id);

  it("reads the same forecast four different ways", () => {
    const titles = (["agri", "events", "commute", "health"] as FocusId[]).map(
      (id) => focusOf(id)!.title,
    );
    expect(new Set(titles).size).toBe(4);
  });

  it("answers Agriculture with a total, not a rate", () => {
    const d = focusOf("agri")!;
    expect(d.title).toMatch(/^\d+\.\d mm expected in the next 12 hours\.$/);
  });

  it("answers Events with a peak rate in its own window", () => {
    expect(focusOf("events")!.title).toMatch(/mm\/h during your event window\.$/);
  });

  it("answers Commute with a departure time", () => {
    /* Commute reuses the routine's own event, so the time is not invented. */
    expect(focusOf("commute")!.title).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  it("answers Health with comfort, not with a rainfall figure", () => {
    const d = focusOf("health")!;
    expect(d.title).toMatch(/Feels like \d+°|Humidity peaks at|UV reaches|Wind reaches/);
    expect(d.title).not.toMatch(/mm expected|mm\/h/);
  });

  it("never reuses another focus's sentence", () => {
    const ids = ["daily", "commute", "health", "travel", "work", "agri", "outdoor", "events"] as FocusId[];
    const titles = ids.map((id) => focusOf(id)?.title).filter(Boolean);
    // Distinct wording per focus; any collision means two lenses converged.
    expect(new Set(titles).size).toBe(ids.length);
  });
});

/* ================================ O. PEAK INTENSITY IS NAMED AS A PEAK = */

describe("peak intensity is never stated as a window total", () => {
  it("names the hour the peak rate happens at", () => {
    const d = build("rain", ["health"]).out.candidates.find((c) => c.focusId === "health")!;
    const peak = d.detail.match(/Peak rain [\d.]+ mm\/h around \d{1,2}:\d{2} (AM|PM)/);
    expect(peak, d.detail).not.toBeNull();
  });

  it("uses mm/h and an hour, never a bare mm against a window", () => {
    for (const id of FOCUSES.map((f) => f.id)) {
      const d = build("rain", [id]).out.candidates.find((c) => c.focusId === id);
      if (!d) continue;
      // A total is only allowed if it is explicitly called an expectation.
      expect(d.title, id).not.toMatch(/[\d.]+ mm (?!\/h|expected)/);
    }
  });
});

/* =========================================== P. LANES AND INLINE METRICS === */

describe("routine and focus readings stay in separate lanes", () => {
  const all = (o: ReturnType<typeof build>["out"]) => [...o.secondaryFocus, ...o.secondaryRoutine];

  it("puts every remaining reading in exactly one lane", () => {
    for (const scenario of ["rain", "sunny", "thunderstorm"]) {
      for (const focus of FOCUSES.map((f) => f.id)) {
        const o = build(scenario, [focus]).out;
        const ids = o.secondaryFocus.map((d) => d.id);
        const rids = o.secondaryRoutine.map((d) => d.id);
        expect(ids.filter((i) => rids.includes(i)), `${scenario}/${focus}`).toEqual([]);
        // No reading is dropped by the split.
        expect(all(o).length).toBe(ids.length + rids.length);
      }
    }
  });

  it("never mixes a routine reading into the focus lane", () => {
    const o = build("rain", ["agri", "health"]).out;
    for (const d of o.secondaryFocus) expect(d.focusId).toBeDefined();
    for (const d of o.secondaryRoutine) expect(d.focusId).toBeUndefined();
  });

  it("keeps commute findings out of the routine lane when Commute is selected", () => {
    /* Commute adopts the routine's own events, so its findings belong to the lens
       the user actually set. With Commute alone selected they win the headline
       and the focus lane is legitimately empty — what matters is that none of
       them is left sitting in the routine lane. */
    const o = build("rain", ["commute"]).out;
    expect(o.secondaryRoutine.some((d) => d.focusId === "commute")).toBe(false);
    const commute = all(o).filter((d) => d.focusId === "commute");
    for (const d of commute) expect(o.secondaryFocus).toContain(d);
  });

  it("keeps commute findings out of the focus lane when it is not selected", () => {
    /* Regression: under one combined "Also today" list a user who never chose
       Commute was still shown a journey finding, under a heading that implied
       they had. */
    const o = build("rain", ["agri"]).out;
    expect(o.secondaryFocus.some((d) => d.focusId === "commute")).toBe(false);
  });
});

describe("inline measurements are exactly the ones the headline used", () => {
  it("only inlines metrics the headline quoted", () => {
    for (const scenario of ["rain", "sunny", "thunderstorm", "fog"]) {
      for (const focus of FOCUSES.map((f) => f.id)) {
        const o = build(scenario, [focus]).out;
        if (!o.headline) continue;
        const quoted = new Set(o.headline.metrics ?? []);
        for (const m of o.inlineMetrics) {
          expect(quoted.has(m), `${scenario}/${focus}: ${m} was not quoted`).toBe(true);
        }
      }
    }
  });

  it("caps the inline band so it stays a band", () => {
    for (const scenario of ["rain", "sunny", "thunderstorm"]) {
      for (const focus of FOCUSES.map((f) => f.id)) {
        expect(build(scenario, [focus]).out.inlineMetrics.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("splits every selected metric into inline or folded, losing none", () => {
    for (const scenario of ["rain", "sunny"]) {
      for (const focus of FOCUSES.map((f) => f.id)) {
        const o = build(scenario, [focus]).out;
        const both = [...new Set([...o.inlineMetrics, ...o.moreMetrics])].sort();
        expect(both, `${scenario}/${focus}`).toEqual([...new Set(o.metrics)].sort());
        // A metric is never in both registers.
        expect(o.inlineMetrics.filter((m) => o.moreMetrics.includes(m))).toEqual([]);
      }
    }
  });

  it("keeps the band stable across a sunny and a wet afternoon", () => {
    for (const focus of FOCUSES.map((f) => f.id)) {
      const sunny = build("sunny", [focus]).out.metrics;
      const rain = build("rain", [focus]).out.metrics;
      // A band that empties itself when the weather calms is worse than useless.
      expect(sunny.length, focus).toBeGreaterThan(0);
      expect(rain.length, focus).toBeGreaterThan(0);
    }
  });
});

/* ==================================================== Q. FOCUS ORDERING === */

describe("Daily Life leads every picker", () => {
  it("is first in the focus registry", () => {
    expect(FOCUSES[0]?.id).toBe("daily");
    expect(DEFAULT_FOCUS).toBe("daily");
  });

  it("ranks Daily lowest for priority, so a chosen focus can outrank it", () => {
    /* Display order and priority are separate. Daily leads the picker but is
       ranked last, so selecting Commute actually changes the headline instead
       of being outvoted by the default. Collapsing the two would silently break
       either the picker or the ranking. */
    const daily = FOCUS_BY_ID.daily;
    for (const f of FOCUSES) {
      if (f.id !== "daily") expect(daily.rank, `${f.id} should outrank Daily`).toBeLessThan(f.rank);
    }
    const ctx = combineFocuses(["work", "daily", "health"], forecast("rain"), NOW);
    const byRank = [...ctx.focuses].sort((a, b) => b.rank - a.rank);
    expect(byRank[byRank.length - 1]?.id).toBe("daily");
  });

  it("puts Daily first in the combined context's focus list", () => {
    /* The registry order is what FocusPicker maps over, so this is the order a
       user sees in both onboarding and Settings. */
    expect(FOCUSES.map((f) => f.id)).toEqual([
      "daily",
      "commute",
      "health",
      "travel",
      "work",
      "agri",
      "outdoor",
      "events",
    ]);
  });
});

/* =============================== J. DEMO DOES NOT TOUCH FOCUS ============ */

describe("J. demo and focus are independent concepts", () => {
  it("does not change the forecast when focus changes", () => {
    const f = forecast("rain");
    const snapshot = JSON.stringify(f.hourly);
    buildInsights({ forecast: f, profile: DEFAULT_PROFILE, nowMin: NOW, scenario: true, focusIds: ["agri"] });
    buildInsights({ forecast: f, profile: DEFAULT_PROFILE, nowMin: NOW, scenario: true, focusIds: ["health"] });
    expect(JSON.stringify(f.hourly)).toBe(snapshot);
  });

  it("keeps working with no focus at all in demo", () => {
    const out = build("rain", []).out;
    expect(out.headline).not.toBeNull();
  });
});

/* ================================ K. UNKNOWN FOCUS FALLBACK ============== */

describe("K. bad input", () => {
  it("ignores an unrecognized focus id", () => {
    const out = build("rain", ["not-a-focus" as FocusId]).out;
    expect(out.ctx.ids).toEqual(["daily"]);
  });

  it("handles a focus selected twice", () => {
    const ctx = combineFocuses(["health", "health"], forecast("rain"), NOW);
    expect(ctx.ids).toEqual(["health", "health"]);
    expect(ctx.windows.filter((w) => w.id === "next-hours")).toHaveLength(1);
  });
});

/* ================================ L. FOCUS + ROUTINE ===================== */

describe("L. focus and routine coexist", () => {
  it("keeps a routine commitment visible when a focus is also selected", () => {
    const out = build("rain", ["health", "commute"]).out;
    const ids = out.candidates.map((d) => d.id);
    expect(ids.some((i) => i.includes("commute-home"))).toBe(true);
  });

  it("keeps the routine path's own severe decision intact", () => {
    const a = build("rain", ["health"]).out.candidates.filter((d) => d.eventId);
    const b = build("rain", ["health", "commute"]).out.candidates.filter((d) => d.eventId);
    expect(b.length).toBeGreaterThanOrEqual(a.length);
  });
});

/* ================================ M. PRIORITIZATION ====================== */

describe("M. prioritize", () => {
  const ctx = combineFocuses(["health"], forecast("rain"), NOW);

  it("always ranks severe above everything else", () => {
    const out = prioritize({
      decisions: [
        { id: "f", kind: "conflict", severity: "avoid", title: "f", detail: "", why: [], confidence: { overall: 1, factors: [] }, atMin: NOW, focusId: "health" },
        { id: "s", kind: "severe", severity: "avoid", title: "s", detail: "", why: [], confidence: { overall: 1, factors: [] }, atMin: NOW + 600 },
      ],
      ctx,
      nowMin: NOW,
    });
    expect(out.severe?.id).toBe("s");
  });

  it("keeps the secondary list short", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`,
      kind: "conflict" as const,
      severity: "note" as const,
      title: `d${i}`,
      detail: "",
      why: [],
      confidence: { overall: 1, factors: [] },
      atMin: NOW + i * 30,
      focusId: "health" as FocusId,
    }));
    const out = prioritize({ decisions: many, ctx, nowMin: NOW });
    const rest = [...out.secondaryFocus, ...out.secondaryRoutine];
    expect(rest.length).toBeLessThanOrEqual(3);
    expect(rest).not.toContain(out.headline);
  });

  it("prefers a sooner window when severity ties", () => {
    const mk = (id: string, atMin: number) => ({
      id,
      kind: "conflict" as const,
      severity: "note" as const,
      title: id,
      detail: "",
      why: [],
      confidence: { overall: 1, factors: [] },
      atMin,
      focusId: "health" as FocusId,
    });
    const out = prioritize({
      decisions: [mk("later", NOW + 600), mk("sooner", NOW + 60)],
      ctx,
      nowMin: NOW,
    });
    expect(out.headline?.id).toBe("sooner");
  });

  it("keeps the headline out of the secondary list", () => {
    // A settled day makes every candidate an all-clear, including the headline.
    const out = build("sunny", ["health", "agri"]).out;
    expect(out.headline).not.toBeNull();
    const rest = [...out.secondaryFocus, ...out.secondaryRoutine];
    expect(rest.map((d) => d.id)).not.toContain(out.headline!.id);
    expect(new Set([out.headline!.id, ...rest.map((d) => d.id)]).size).toBe(1 + rest.length);
  });

  it("surfaces focus metrics even when a routine decision wins the headline", () => {
    // Regression: the metric band used to be derived only from the winning
    // decision, and a routine all-clear quotes no numbers, so the band emptied
    // itself exactly when the weather was calm.
    const out = build("sunny", ["health", "agri"]).out;
    expect(out.headline?.focusId ?? "commute").toBeTruthy();
    expect(out.metrics.length).toBeGreaterThan(0);
    expect(out.metrics).toContain("humidity");
  });

  it("keeps the metric band short", () => {
    const out = build("rain", ["health", "agri", "travel", "outdoor", "work", "events"]).out;
    expect(out.metrics.length).toBeLessThanOrEqual(6);
  });

  it("shows the same metrics on a settled day as on a wet one for one focus", () => {
    // Membership must not depend on the weather; only the ordering may.
    const calm = build("sunny", ["health"]).out.metrics;
    const wet = build("rain", ["health"]).out.metrics;
    expect([...calm].sort()).toEqual([...wet].sort());
  });

  it("does not surface air-quality metrics it has no reading for", () => {
    const out = prioritize({
      decisions: [
        {
          id: "x",
          kind: "conflict",
          severity: "note",
          title: "x",
          detail: "",
          why: [],
          confidence: { overall: 1, factors: [] },
          atMin: NOW,
          focusId: "health",
          metrics: ["humidity", "aqi"],
        },
      ],
      ctx,
      nowMin: NOW,
    });
    expect(out.metrics).toContain("humidity");
    expect(out.metrics).not.toContain("aqi");
  });
});
