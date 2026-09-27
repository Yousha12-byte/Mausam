import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, scheduleFor, scopeProfile } from "../src/domain/routine";
import { DEMO_LOCATION } from "../src/domain/location";
import {
  CONFLICT_THRESHOLD,
  findMitigation,
  peakIn,
  runDecisionEngine,
  sampleAt,
  severityOf,
} from "../src/domain/decision";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import type { NormalizedForecast } from "../src/domain/weather";
import type { UserProfile } from "../src/domain/routine";
import { IST_OFFSET_MIN } from "../src/data/mock";
import { deriveState } from "../src/domain/taxonomy";
import { deriveAtmosphere } from "../src/atmosphere/derive";

const NOW = 16 * 60; // 4:00 PM
const AT = Date.UTC(2026, 8, 26, 6, 0);

/* The engine scores a list of windows, and the profile is only the source of
   them. These tests are about the engine's arithmetic on a known set of commute
   windows, so the windows are handed over explicitly — exactly as
   `buildInsights` does — and every assertion below is unchanged. */
const COMMUTE = scopeProfile(DEFAULT_PROFILE, ["commute"]);

const spec = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function forecast(id: string): NormalizedForecast {
  const s = spec(id);
  return {
    location: DEMO_LOCATION,
    tzOffsetMin: IST_OFFSET_MIN,
    timezone: DEMO_LOCATION.timezone ?? "Asia/Kolkata",
    fetchedAt: AT,
    source: "mock",
    current: null,
    hourly: buildScenarioForecast(s, DEMO_LOCATION.lat, IST_OFFSET_MIN, AT),
    ...(() => {
      const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, AT);
      return { sunriseMin: d.sunriseMin, sunsetMin: d.sunsetMin };
    })(),
  };
}

function run(id: string, nowMin = NOW, profile = COMMUTE) {
  return runDecisionEngine({ forecast: forecast(id), profile, nowMin, scenario: true });
}

describe("sampleAt", () => {
  it("interpolates between hourly samples", () => {
    const f = forecast("rain");
    const at1730 = sampleAt(f, 17 * 60 + 30);
    const at1700 = sampleAt(f, 17 * 60);
    const at1800 = sampleAt(f, 18 * 60);
    expect(at1730.precipProb).toBeGreaterThan(at1700.precipProb);
    expect(at1730.precipProb).toBeLessThan(at1800.precipProb);
    expect(at1730.hour).toBeCloseTo(17.5);
  });
});

describe("severity", () => {
  it("scales with user sensitivity — a walker is more exposed than a driver", () => {
    const f = forecast("rain");
    const wet = sampleAt(f, 17 * 60 + 30);
    const walker = severityOf(wet, COMMUTE, "walk");
    const driver = severityOf(wet, COMMUTE, "car");
    expect(walker).toBeGreaterThan(driver);
    expect(walker).toBeGreaterThan(CONFLICT_THRESHOLD);
    expect(driver).toBeLessThan(walker);
  });

  it("keeps lightning significant even for an enclosed vehicle", () => {
    const f = forecast("thunderstorm");
    const storm = sampleAt(f, 17 * 60);
    expect(severityOf(storm, COMMUTE, "car")).toBeGreaterThan(0.5);
  });
});

describe("the SIH reference case", () => {
  it("detects that rain conflicts with a 5:30 PM commute", () => {
    const decisions = run("rain");
    const conflict = decisions.find((d) => d.kind === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.title).toContain("5:30 PM");
    expect(conflict!.title.toLowerCase()).toContain("may be affected");
  });

  it("proposes an EARLIER departure, derived from the forecast", () => {
    const conflict = run("rain").find((d) => d.kind === "conflict")!;
    expect(conflict.action).toBeDefined();
    expect(conflict.action).toMatch(/earlier/);
    // The suggestion must be a real departure time, not a canned string.
    expect(conflict.action).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
    const shift = Math.abs(
      Number(/(\d+) min earlier/.exec(conflict.action!)![1]),
    );
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThanOrEqual(180);
  });

  it("verifies the suggested departure actually clears the threshold", () => {
    const f = forecast("rain");
    const profile = COMMUTE;
    const commute = profile.routine[0]!;
    const original = peakIn(f, profile, commute.startMin, 35, commute.mode);
    expect(original.severity).toBeGreaterThan(CONFLICT_THRESHOLD);

    const mit = findMitigation(f, profile, commute.startMin, 35, commute.mode);
    expect(mit).not.toBeNull();
    expect(mit!.shiftMin).toBeLessThan(0); // earlier
    const after = peakIn(f, profile, mit!.departureMin, 35, commute.mode);
    expect(after.severity).toBeLessThan(original.severity);
    expect(after.severity).toBeLessThanOrEqual(CONFLICT_THRESHOLD);
  });
});

describe("explainability", () => {
  it("every conflict explains itself with data and profile evidence", () => {
    const conflict = run("rain").find((d) => d.kind === "conflict")!;
    expect(conflict.why.length).toBeGreaterThanOrEqual(3);
    expect(conflict.why.some((w) => w.kind === "data")).toBe(true);
    expect(conflict.why.some((w) => w.kind === "profile")).toBe(true);
    expect(conflict.why.some((w) => w.kind === "action")).toBe(true);
    expect(conflict.why.some((w) => w.text.includes("5:30"))).toBe(true);
    expect(conflict.why.some((w) => /%/.test(w.text))).toBe(true);
  });

  it("decomposes confidence into named factors, not a magic number", () => {
    const conflict = run("rain").find((d) => d.kind === "conflict")!;
    expect(conflict.confidence.factors.map((f) => f.label)).toEqual([
      "Data freshness",
      "Timing match",
      "Profile certainty",
    ]);
    for (const f of conflict.confidence.factors) {
      expect(f.value).toBeGreaterThan(0);
      expect(f.value).toBeLessThanOrEqual(1);
      expect(f.detail.length).toBeGreaterThan(0);
    }
    expect(conflict.confidence.overall).toBeLessThanOrEqual(1);
  });

  it("lowers confidence when data is simulated rather than live", () => {
    const f = forecast("rain");
    const simulated = runDecisionEngine({ forecast: f, profile: COMMUTE, nowMin: NOW, scenario: true });
    const live = runDecisionEngine({ forecast: f, profile: COMMUTE, nowMin: NOW, scenario: false });
    const a = simulated.find((d) => d.kind === "conflict")!;
    const b = live.find((d) => d.kind === "conflict")!;
    expect(a.confidence.overall).toBeLessThan(b.confidence.overall);
  });
});

describe("the engine discriminates rather than always warning", () => {
  it("reports all-clear on a sunny day", () => {
    const decisions = run("sunny");
    expect(decisions.some((d) => d.kind === "conflict")).toBe(false);
    expect(decisions[0]!.kind).toBe("all-clear");
  });

  it("reports all-clear on an overcast but dry day", () => {
    const decisions = run("cloudy");
    expect(decisions.some((d) => d.kind === "conflict")).toBe(false);
  });

  it("raises a severe banner for a thunderstorm regardless of routine", () => {
    const severe = run("thunderstorm").find((d) => d.kind === "severe");
    expect(severe).toBeDefined();
    expect(severe!.severity).toBe("avoid");
  });

  it("detects a morning fog conflict on the 8:15 AM routine", () => {
    const decisions = run("fog", 6 * 60);
    const conflict = decisions.find((d) => d.kind === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.why.some((w) => /visibility/i.test(w.text))).toBe(true);
  });

  it("does not raise a severe banner for a storm that has already passed", () => {
    // 22:00 — well after the afternoon storm, before tomorrow morning.
    const decisions = run("thunderstorm", 22 * 60);
    expect(decisions.some((d) => d.kind === "severe")).toBe(false);
  });

  it("does not let a distant advisory outrank an imminent commute conflict", () => {
    const decisions = run("thunderstorm", 16 * 60);
    const severe = decisions.find((d) => d.kind === "severe");
    const conflict = decisions.find((d) => d.kind === "conflict");
    expect(severe).toBeDefined();
    expect(conflict).toBeDefined();
    // Both are present; the commute card carries the actionable advice.
    expect(conflict!.action).toMatch(/Severe weather/);
  });
});

describe("what-if", () => {
  it("re-running with an earlier departure removes the conflict", () => {
    const f = forecast("rain");
    const commute = COMMUTE.routine[0]!;
    const mit = findMitigation(f, COMMUTE, commute.startMin, 35, commute.mode)!;
    const decisions = runDecisionEngine({
      forecast: f,
      profile: COMMUTE,
      nowMin: NOW,
      scenario: true,
      overrideEventId: commute.id,
      overrideStartMin: mit.departureMin,
    });
    expect(decisions.some((d) => d.kind === "conflict")).toBe(false);
  });
});

describe("personalization is arithmetic, not copy", () => {
  it("a different departure time produces different advice", () => {
    const commute = scheduleFor(DEFAULT_PROFILE, "commute")[0]!;
    const early = { ...commute, startMin: 14 * 60 };
    const profile: UserProfile = {
      ...DEFAULT_PROFILE,
      schedules: { commute: { focusId: "commute", events: [early] } },
    };
    const decisions = run("rain", 12 * 60, scopeProfile(profile, ["commute"]));
    expect(decisions.some((d) => d.kind === "conflict")).toBe(false);
  });

  it("a user insensitive to rain is not warned about rain", () => {
    const profile: UserProfile = {
      ...DEFAULT_PROFILE,
      sensitivity: { precip: 0.05, wind: 0.05, heat: 0.05, lowVis: 0.05, thunder: 0.05 },
    };
    const decisions = run("rain", NOW, scopeProfile(profile, ["commute"]));
    expect(decisions.some((d) => d.kind === "conflict")).toBe(false);
  });
});

describe("every scenario produces a renderable state", () => {
  it("covers all six demo scenarios without throwing", () => {
    for (const s of SCENARIOS) {
      const decisions = run(s.id);
      expect(Array.isArray(decisions)).toBe(true);
      expect(decisions.length).toBeGreaterThan(0);
    }
  });
});

describe("late in the day", () => {
  it("never leaves the homepage empty once today's routines have passed", () => {
    for (const id of ["sunny", "rain", "night"]) {
      const decisions = run(id, 22 * 60);
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0]!.title.length).toBeGreaterThan(0);
    }
  });

  it("labels the next routine as tomorrow rather than today", () => {
    const decisions = run("rain", 22 * 60);
    expect(decisions.some((d) => /tomorrow/i.test(d.detail))).toBe(true);
  });

  it("lowers confidence for a routine that is a day away", () => {
    const near = run("rain", 16 * 60).find((d) => d.kind === "conflict")!;
    // Past the last routine of the day the engine stops scoring and previews.
    const far = run("rain", 22 * 60).find((d) => d.kind === "preview")!;
    expect(far).toBeDefined();
    expect(far.confidence.overall).toBeLessThan(near.confidence.overall);
  });

  it("never claims to know tomorrow from today's data", () => {
    const far = run("rain", 22 * 60);
    // A forecast that does not reach tomorrow must not report a verdict on it.
    expect(far.some((d) => d.kind === "conflict" || d.kind === "all-clear")).toBe(false);
    expect(far.every((d) => d.kind === "preview" || d.kind === "severe")).toBe(true);
  });
});

describe("scenario demo integrity", () => {
  const PROFILE = DEFAULT_PROFILE;
  const LON = DEMO_LOCATION.lon;

  function runScenario(id: string, at: number) {
    const spec = SCENARIOS.find((s) => s.id === id)!;
    const d = scenarioDayTimes(DEMO_LOCATION.lat, LON, at);
    const forecast: NormalizedForecast = {
      location: { name: DEMO_LOCATION.name, admin: DEMO_LOCATION.admin, lat: DEMO_LOCATION.lat, lon: LON, timezone: "Asia/Kolkata" },
      tzOffsetMin: IST_OFFSET_MIN,
      timezone: "Asia/Kolkata",
      fetchedAt: at,
      source: "mock",
      current: null,
      hourly: buildScenarioForecast(spec, DEMO_LOCATION.lat, IST_OFFSET_MIN, at),
      sunriseMin: d.sunriseMin,
      sunsetMin: d.sunsetMin,
    };
    const nowMin = spec.clockMin ?? nowMinAt(at, IST_OFFSET_MIN);
    return { decisions: runDecisionEngine({ forecast, profile: scopeProfile(PROFILE, ["commute"]), nowMin, scenario: true }), nowMin };
  }

  function nowMinAt(at: number, tz: number): number {
    const utcMin = Math.floor(at / 60000) % 1440;
    return ((utcMin + tz) % 1440 + 1440) % 1440;
  }

  /* A scenario is a demo asset. It must show its point whenever the demo is
     run, which means it cannot depend on the real wall clock. */
  it("never degenerates to all-clear, at any hour of the day", () => {
    const calm = ["sunny", "cloudy"];
    const hazards = SCENARIOS.filter((s) => !calm.includes(s.id));
    for (const hour of [0, 4, 8, 12, 16, 20, 23]) {
      const at = Date.UTC(2026, 8, 26, hour, 0);
      for (const s of hazards) {
        const { decisions } = runScenario(s.id, at);
        const allClear = decisions.every((d) => d.kind === "all-clear");
        expect(`${s.id}@${hour}h:${allClear}`).toBe(`${s.id}@${hour}h:false`);
      }
    }
    expect(hazards.map((s) => s.id).sort()).toEqual(
      ["fog", "night", "rain", "thunderstorm"].sort(),
    );
  });

  /* The converse guard: the two calm baselines must stay calm. If these ever
     start raising conflicts, the engine is crying wolf and every other
     recommendation on the page loses credibility. */
  it("keeps the calm baselines genuinely all-clear", () => {
    for (const hour of [0, 8, 12, 20]) {
      const at = Date.UTC(2026, 8, 26, hour, 0);
      for (const id of ["sunny", "cloudy"]) {
        const { decisions } = runScenario(id, at);
        expect(`${id}@${hour}h`).toBe(`${id}@${hour}h`);
        expect(decisions.every((d) => d.kind === "all-clear")).toBe(true);
      }
    }
  });

  it("surfaces the commute conflict in the rain scenario", () => {
    const { decisions } = runScenario("rain", Date.UTC(2026, 8, 26, 12));
    const commute = decisions.find((d) => d.eventId === "commute-home");
    expect(commute).toBeDefined();
    expect(commute!.kind).toBe("conflict");
    expect(commute!.action).toBeTruthy();
  });

  it("raises a severe banner in the thunderstorm scenario", () => {
    const { decisions } = runScenario("thunderstorm", Date.UTC(2026, 8, 26, 12));
    expect(decisions.some((d) => d.kind === "severe")).toBe(true);
  });

  it("shows a fog conflict against the morning routine", () => {
    const { decisions } = runScenario("fog", Date.UTC(2026, 8, 26, 12));
    const morning = decisions.find((d) => d.eventId === "morning-college");
    expect(morning?.kind).toBe("conflict");
  });
});

describe("routine ordering is chronological, not declarative", () => {
  // The default profile lists the 17:30 commute before the 08:15 college run.
  const commute = scheduleFor(DEFAULT_PROFILE, "commute").find((e) => e.id === "commute-home")!;
  const college = scheduleFor(DEFAULT_PROFILE, "commute").find((e) => e.id === "morning-college")!;

  it("sorts events by time even when the profile lists them out of order", () => {
    const order = scheduleFor(DEFAULT_PROFILE, "commute").map((e) => e.startMin);
    expect(order).not.toEqual([...order].sort((a, b) => a - b));

    const d = run("night", 21 * 60);
    const preview = d.find((x) => x.kind === "preview")!;
    // With the day over, the earliest routine is what "tomorrow" means.
    expect(preview.eventId).toBe("morning-college");
    expect(preview.title).toContain("8:15 AM");
  });

  it("re-sorts when a user edits a routine time to cross another", () => {
    const swapped = scopeProfile(
      {
        ...DEFAULT_PROFILE,
        schedules: {
          commute: {
            focusId: "commute",
            events: [
              { ...commute, startMin: 6 * 60 }, // commute now declared first again
              { ...college, startMin: 8 * 60 + 15 },
            ],
          },
        },
      },
      ["commute"],
    );
    const at = Date.UTC(2026, 8, 26, 12);
    const spec = SCENARIOS.find((s) => s.id === "fog")!;
    const dt = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, at);
    const forecast: NormalizedForecast = {
      location: { name: "Kochi", admin: "Kerala", lat: DEMO_LOCATION.lat, lon: DEMO_LOCATION.lon, timezone: "Asia/Kolkata" },
      tzOffsetMin: IST_OFFSET_MIN, fetchedAt: at, source: "mock", current: null,
      hourly: buildScenarioForecast(spec, DEMO_LOCATION.lat, IST_OFFSET_MIN, at),
      sunriseMin: dt.sunriseMin, sunsetMin: dt.sunsetMin,
      timezone: "Asia/Kolkata",
    };
    const out = runDecisionEngine({ forecast, profile: swapped, nowMin: 5 * 60, scenario: true });
    // Both are ahead at 05:00; the earlier one must come first.
    const times = out.map((d) => d.atMin);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("user-facing sentences are grammatical", () => {
  it("uses the right article for every travel mode", () => {
    const at = Date.UTC(2026, 8, 26, 12);
    for (const mode of ["walk", "bike", "auto", "car"] as const) {
      const spec = SCENARIOS.find((s) => s.id === "night")!;
      const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, at);
      const forecast: NormalizedForecast = {
        location: { name: "Kochi", admin: "Kerala", lat: DEMO_LOCATION.lat, lon: DEMO_LOCATION.lon, timezone: "Asia/Kolkata" },
        tzOffsetMin: IST_OFFSET_MIN, fetchedAt: at, source: "mock", current: null,
        hourly: buildScenarioForecast(spec, DEMO_LOCATION.lat, IST_OFFSET_MIN, at),
        sunriseMin: d.sunriseMin, sunsetMin: d.sunsetMin,
        timezone: "Asia/Kolkata",
      };
      const profile = scopeProfile(
        {
          ...DEFAULT_PROFILE,
          schedules: {
            commute: {
              focusId: "commute",
              events: scheduleFor(DEFAULT_PROFILE, "commute").map((e) => ({ ...e, mode })),
            },
          },
        },
        ["commute"],
      );
      const out = runDecisionEngine({ forecast, profile, nowMin: 22 * 60, scenario: true });
      const text = out.flatMap((x) => x.why.map((w) => w.text)).join(" | ");
      expect(`${mode}:${/ on a auto /.test(text)}`).toBe(`${mode}:false`);
      expect(`${mode}:${/ on an auto /.test(text)}`).toBe(`${mode}:${mode === "auto"}`);
      // No doubled article anywhere.
      expect(text).not.toMatch(/\ba [aeiou]\w+/);
    }
  });
});

describe("daylight uses sunrise/sunset, not the nearest hourly is_day flag", () => {
  /* Regression: is_day is reported per hour, so reading the nearest row flipped
     the UI to a starry night from 17:30 while Kochi sunset is 18:18. Sunrise and
     sunset are already on the forecast, so daylight is read from those. */
  const SUNRISE = 6 * 60 + 13; // 06:13, matches Open-Meteo for 2026-09-26
  const SUNSET = 18 * 60 + 18; // 18:18

  function fc(hourIsDay: boolean[]): NormalizedForecast {
    return {
      location: { name: "Kochi", admin: "Kerala", lat: 9.9312, lon: 76.2673, timezone: "Asia/Kolkata" },
      tzOffsetMin: IST_OFFSET_MIN,
      timezone: "Asia/Kolkata",
      fetchedAt: Date.UTC(2026, 8, 26, 12),
      source: "open-meteo",
      current: null,
      sunriseMin: SUNRISE,
      sunsetMin: SUNSET,
      hourly: hourIsDay.map((isDay, h) => ({
        // The instant of that local hour, not the same clock reading in UTC.
        t: Math.floor(Date.UTC(2026, 8, 26, 12) / 86400000) * 86400000 - IST_OFFSET_MIN * 60000 + h * 3600_000,
        hour: h,
        code: "clear" as const,
        isDay,
        tempC: 28,
        feelsC: 28,
        precipMm: 0,
        precipProb: 0,
        windKph: 10,
        gustKph: 16,
        cloudCover: 0.1,
        visibilityKm: 18,
        uvIndex: isDay ? 6 : 0,
        thunderProb: 0,
      })),
    };
  }

  /* Open-Meteo reports is_day=1 up to 17:00 and 0 from 18:00. */
  const live = fc(
    Array.from({ length: 24 }, (_, h) => h >= 6 && h <= 17),
  );

  it("stays in daylight right up to the real sunset minute", () => {
    expect(sampleAt(live, 17 * 60 + 30).isDay).toBe(true);
    expect(sampleAt(live, 17 * 60 + 59).isDay).toBe(true);
    expect(deriveState(sampleAt(live, 17 * 60 + 45).code, sampleAt(live, 17 * 60 + 45).isDay)).toBe("sunny");
  });

  it("switches to night at sunset, not at the hour boundary", () => {
    expect(sampleAt(live, SUNSET - 1).isDay).toBe(true);
    expect(sampleAt(live, SUNSET).isDay).toBe(false);
    expect(deriveState(sampleAt(live, SUNSET + 30).code, sampleAt(live, SUNSET + 30).isDay)).toBe("night");
  });

  it("switches to day at sunrise", () => {
    expect(sampleAt(live, SUNRISE - 1).isDay).toBe(false);
    expect(sampleAt(live, SUNRISE).isDay).toBe(true);
  });

  it("would have been wrong under the old nearest-hour rule", () => {
    // 17:45 sits in the 18:00 row, which is is_day=0.
    expect(live.hourly[18]!.isDay).toBe(false);
    expect(sampleAt(live, 17 * 60 + 45).isDay).toBe(true); // corrected
  });

  it("falls back to the sampled flag when day bounds are unusable", () => {
    const broken = { ...fc(Array.from({ length: 24 }, (_, h) => h >= 6 && h <= 17)), sunriseMin: 0, sunsetMin: 0 };
    expect(sampleAt(broken, 17 * 60 + 45).isDay).toBe(false);
  });

  it("keeps every scenario's daylight state unchanged", () => {
    for (const s of SCENARIOS) {
      const want: Record<string, boolean> = {
        sunny: true, cloudy: true, rain: true, thunderstorm: true, fog: true, night: false,
      };
      const a = deriveAtmosphere(
        (() => {
          const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, Date.UTC(2026, 8, 26, 12));
          return {
            location: { name: "Kochi", admin: "Kerala", lat: DEMO_LOCATION.lat, lon: DEMO_LOCATION.lon, timezone: "Asia/Kolkata" },
            tzOffsetMin: IST_OFFSET_MIN,
            timezone: "Asia/Kolkata",
            fetchedAt: Date.UTC(2026, 8, 26, 12),
            source: "mock" as const,
            current: null,
            hourly: buildScenarioForecast(s, DEMO_LOCATION.lat, IST_OFFSET_MIN, Date.UTC(2026, 8, 26, 12)),
            sunriseMin: d.sunriseMin, sunsetMin: d.sunsetMin,
          };
        })(),
        s.clockMin!,
      );
      expect(`${s.id}:${a.isDaylight}`).toBe(`${s.id}:${want[s.id]}`);
    }
  });
});
