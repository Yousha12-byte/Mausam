import { describe, expect, it } from "vitest";
import { buildInsights } from "../src/domain/insights";
import { CONTEXT_COPY, windowSeed } from "../src/domain/focus-context";
import { FOCUSES, type FocusId } from "../src/domain/focus";
import {
  DEFAULT_PROFILE,
  activeEvents,
  allEvents,
  scheduleFor,
  scopeProfile,
  type RoutineEvent,
  type UserProfile,
} from "../src/domain/routine";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import { DEMO_LOCATION } from "../src/domain/location";
import { IST_OFFSET_MIN } from "../src/data/mock";
import type { NormalizedForecast } from "../src/domain/weather";

const AT = Date.UTC(2026, 8, 26, 6, 0);
const AT_AFTERNOON = 16 * 60;

function forecast(id: string): NormalizedForecast {
  const spec = SCENARIOS.find((s) => s.id === id)!;
  const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, AT);
  return {
    location: DEMO_LOCATION,
    tzOffsetMin: IST_OFFSET_MIN,
    timezone: "Asia/Kolkata",
    fetchedAt: AT,
    source: "mock",
    current: null,
    hourly: buildScenarioForecast(spec, DEMO_LOCATION.lat, IST_OFFSET_MIN, AT),
    sunriseMin: d.sunriseMin,
    sunsetMin: d.sunsetMin,
  };
}

function build(
  scenario: string,
  focusIds: FocusId[],
  nowMin = AT_AFTERNOON,
  profile: UserProfile = DEFAULT_PROFILE,
) {
  return buildInsights({
    forecast: forecast(scenario),
    profile,
    nowMin,
    scenario: true,
    focusIds,
  });
}

/** Everything the page would render, as one searchable string. */
function rendered(out: ReturnType<typeof build>): string {
  return out.candidates
    .flatMap((d) => [d.title, d.detail, d.action ?? "", ...d.why.map((w) => w.text)])
    .join(" | ");
}

const event = (over: Partial<RoutineEvent> & { id: string }): RoutineEvent => ({
  label: "Window",
  startMin: 17 * 60,
  durationMin: 60,
  travelMin: 60,
  mode: "walk",
  ...over,
});

const withSchedules = (
  entries: Partial<Record<FocusId, RoutineEvent[]>>,
): UserProfile => {
  const schedules: UserProfile["schedules"] = {};
  for (const [id, events] of Object.entries(entries) as Array<[FocusId, RoutineEvent[]]>) {
    if (events?.length) schedules[id] = { focusId: id, events };
  }
  return { ...DEFAULT_PROFILE, schedules };
};

const COMMUTE_WORDS = ["College to home", "Home to college", "17:30", "8:15 AM"];

describe("context belongs to the focus that gives it meaning", () => {
  it("1. Commute reads the commute schedule", () => {
    const out = build("rain", ["commute"]);
    const commute = activeEvents(out.ctx ? DEFAULT_PROFILE : DEFAULT_PROFILE, ["commute"]);
    expect(commute).toHaveLength(2);
    expect(commute.every((e) => e.focusId === "commute")).toBe(true);
    expect(rendered(out)).toMatch(/College to home|Home to college/);
  });

  /* The reported bug: one flat routine list meant every focus was scored against
     the student's college timetable. */
  for (const focus of ["agri", "work", "travel", "events", "outdoor", "health", "daily"] as const) {
    it(`${focus === "agri" ? "2" : focus === "work" ? "3" : focus === "travel" ? "4" : focus === "events" ? "5" : focus === "outdoor" ? "6" : "7"} + ${focus} never mentions the college commute`, () => {
      const out = build("rain", [focus]);
      const text = rendered(out);
      for (const word of COMMUTE_WORDS) {
        expect(text, `${focus} leaked "${word}"`).not.toContain(word);
      }
      /* And the engine was handed no window from another focus at all. */
      expect(activeEvents(DEFAULT_PROFILE, [focus]).some((e) => e.focusId === "commute")).toBe(false);
    });
  }

  it("7. Daily Life needs no schedule to say something", () => {
    const out = build("rain", ["daily"], 8 * 60, { ...DEFAULT_PROFILE, schedules: {} });
    expect(out.headline).not.toBeNull();
    expect(out.headline?.focusId).toBe("daily");
  });

  it("a Commute reading is absent entirely when Commute is not selected", () => {
    const agri = build("rain", ["agri"]);
    expect(rendered(agri)).not.toMatch(/College to home/);
    // ...and the commute decision is not merely relabelled, it is not produced.
    expect(agri.candidates.some((d) => d.eventId?.startsWith("commute"))).toBe(false);
  });
});

describe("a focus reads its own configured window", () => {
  const cases: Array<[FocusId, RoutineEvent[]]> = [
    ["agri", [event({ id: "field-1", label: "Field work", startMin: 6 * 60, durationMin: 300 })]],
    ["work", [event({ id: "work-1", label: "Office hours", startMin: 9 * 60, durationMin: 480, travelMin: 45 })]],
    ["travel", [event({ id: "trip-1", label: "Flight to Mumbai", startMin: 20 * 60, durationMin: 150, travelMin: 30, mode: "car" })]],
    ["events", [event({ id: "event-1", label: "Wedding", startMin: 19 * 60, durationMin: 180 })]],
    ["outdoor", [event({ id: "hike-1", label: "Trek", startMin: 17 * 60, durationMin: 240 })]],
    ["health", [event({ id: "walk-1", label: "Morning walk", startMin: 17 * 60, durationMin: 60 })]],
  ];

  for (const [focus, events] of cases) {
    it(`${focus} uses its own configured window`, () => {
      const profile = withSchedules({ [focus]: events });
      /* Read in the morning, so none of the configured windows has elapsed —
         an elapsed one is dropped by design, and tested separately below. */
      const out = build("rain", [focus], 5 * 60, profile);
      /* The configured window is the only one. The built-in part of the day is
         gone, because a 9-to-5 default that disagrees with the user is worse
         than no default at all. */
      expect(out.ctx.windows.map((w) => w.id)).toEqual([events[0]!.id]);
      expect(out.ctx.windows[0]!.focusId).toBe(focus);
      expect(rendered(out).toLowerCase()).toContain(events[0]!.label.toLowerCase());
    });
  }

  it("a focus with no configured schedule keeps its built-in windows", () => {
    const out = build("rain", ["work"], 16 * 60, { ...DEFAULT_PROFILE, schedules: {} });
    expect(out.ctx.windows.length).toBeGreaterThan(0);
    expect(out.headline?.focusId).toBe("work");
  });

  it("an elapsed window is dropped rather than re-dated to now", () => {
    const profile = withSchedules({ travel: [event({ id: "old", label: "Old trip", startMin: 6 * 60, durationMin: 60 })] });
    const out = build("rain", ["travel"], 16 * 60, profile);
    expect(out.ctx.windows.some((w) => w.id === "old")).toBe(false);
  });

  it("an under-way window is clipped to the time that is left", () => {
    const profile = withSchedules({ work: [event({ id: "now", label: "Shift", startMin: 15 * 60, durationMin: 240 })] });
    const out = build("rain", ["work"], 16 * 60, profile);
    const w = out.ctx.windows.find((x) => x.id === "now")!;
    expect(w.startMin).toBe(16 * 60);
    expect(w.durationMin).toBe(3 * 60);
  });
});

describe("a voice may only assert a hazard that exists", () => {
  it("16. Travel does not mention rain when there is no rain", () => {
    const out = build("night", ["travel"], 19 * 60);
    const text = rendered(out);
    expect(text.toLowerCase()).not.toContain("may affect travel");
    /* Guard the underlying fact too, so this cannot pass by accident. */
    const f = forecast("night");
    expect(Math.max(...f.hourly.map((h) => h.precipProb))).toBeLessThan(0.3);
  });

  it("Travel does not claim low visibility on a clear night", () => {
    const text = rendered(build("night", ["travel"], 19 * 60)).toLowerCase();
    expect(text).not.toContain("visibility");
  });

  it("Travel does say something when the window really is bad", () => {
    // Fog is a dawn scenario, so the claim is checked at dawn.
    const out = build("fog", ["travel"], 8 * 60);
    const fog = out.candidates.find((d) => d.focusId === "travel");
    expect(fog?.action ?? "").not.toBe("");
  });

  it("Travel names the hazard that is actually present, not a fixed list", () => {
    const out = build("thunderstorm", ["travel"], 19 * 60);
    const storm = out.candidates.find((d) => d.focusId === "travel");
    expect(storm?.action ?? "").toMatch(/rain|thunder|wind|visibility/);
    /* One claim, not a canned sentence listing everything at once. */
    expect(storm?.action).not.toMatch(/^Visibility and rain/);
  });
});

describe("WHY evidence is unique", () => {
  for (const focus of FOCUSES.map((f) => f.id)) {
    it(`17. ${focus} repeats no measurement`, () => {
      for (const scenario of ["rain", "fog", "thunderstorm", "night", "sunny"]) {
        for (const nowMin of [8 * 60, 16 * 60, 19 * 60]) {
          const out = build(scenario, [focus], nowMin);
          for (const d of out.candidates) {
            const texts = d.why.map((w) => w.text);
            expect(new Set(texts).size, `${focus}/${scenario}: ${texts.join(" | ")}`).toBe(texts.length);
          }
          const detail = out.candidates.map((d) => d.detail).join(" · ");
          const parts = detail.split(" · ").filter(Boolean);
          expect(new Set(parts).size, `${focus}/${scenario} detail: ${detail}`).toBe(parts.length);
          for (const d of out.candidates) {
            const metrics = d.metrics ?? [];
            expect(new Set(metrics).size, `${focus}/${scenario} metrics`).toBe(metrics.length);
          }
        }
      }
    });
  }

  it("a temperature already stated in the sentence is not stated again", () => {
    const out = build("night", ["health"], 20 * 60);
    const d = out.candidates.find((c) => c.focusId === "health")!;
    const saidTemp = /\d+°C and settled/.test(d.why[0]!.text);
    expect(saidTemp).toBe(true);
    expect(d.why.map((w) => w.text).join(" ")).not.toMatch(/High of \d+°C/);
  });
});

describe("the routine lane is scoped like everything else", () => {
  it("9. Commute -> Agriculture removes the commute reading", () => {
    const asCommute = build("rain", ["commute"], 16 * 60);
    expect(rendered(asCommute)).toMatch(/College to home/);
    const asAgri = build("rain", ["agri"], 16 * 60);
    expect(rendered(asAgri)).not.toMatch(/College to home/);
  });

  it("10. Agriculture -> Commute brings it back", () => {
    const back = build("rain", ["commute"], 16 * 60);
    expect(rendered(back)).toMatch(/College to home/);
    expect(back.candidates.some((d) => d.focusId === "commute")).toBe(true);
  });

  it("with two focuses selected, each window is read by its own focus", () => {
    const out = build("rain", ["commute", "agri"], 7 * 60);
    const byFocus = new Map(out.candidates.filter((d) => d.eventId).map((d) => [d.eventId, d.focusId]));
    expect(byFocus.get("commute-home")).toBe("commute");
    expect(byFocus.get("morning-college")).toBe("commute");
  });

  it("scopeProfile hands the engine only the selected focuses' windows", () => {
    expect(scopeProfile(DEFAULT_PROFILE, ["commute"]).routine).toHaveLength(2);
    for (const focus of ["agri", "work", "travel", "events", "outdoor", "daily", "health"] as const) {
      expect(scopeProfile(DEFAULT_PROFILE, [focus]).routine).toHaveLength(0);
    }
  });

  it("allEvents finds a window in any focus, for the editors", () => {
    expect(allEvents(DEFAULT_PROFILE).map((e) => e.id)).toEqual([
      "commute-home",
      "morning-college",
    ]);
    expect(scheduleFor(DEFAULT_PROFILE, "commute")).toHaveLength(2);
    expect(scheduleFor(DEFAULT_PROFILE, "work")).toHaveLength(0);
  });
});

describe("the context sheet describes the focus, not a generic routine", () => {
  const titles: Record<FocusId, string> = {
    daily: "Your day",
    commute: "Your commute",
    health: "Your environmental window",
    travel: "Your travel window",
    work: "Your workday",
    agri: "Your field window",
    outdoor: "Your outdoor window",
    events: "Your event",
  };

  for (const [focus, title] of Object.entries(titles) as Array<[FocusId, string]>) {
    it(`${focus} is titled "${title}" and never claims to compare against times it lacks`, () => {
      expect(CONTEXT_COPY[focus].title).toBe(title);
      const hasWindow = scheduleFor(DEFAULT_PROFILE, focus).length > 0;
      if (!hasWindow) {
        expect(CONTEXT_COPY[focus].blurb).not.toMatch(/compares the forecast against these times/);
        expect(CONTEXT_COPY[focus].empty).toBeTruthy();
      }
    });
  }

  it("every focus has copy and a seed, and no seed mentions college", () => {
    for (const f of FOCUSES) {
      expect(CONTEXT_COPY[f.id].title).toBeTruthy();
      const seed = windowSeed(f.id);
      expect(seed.label.toLowerCase()).not.toMatch(/college|commute/);
      expect(seed.id.startsWith(f.id)).toBe(true);
    }
  });

  it("only departure-based focuses offer departure uncertainty", () => {
    expect(CONTEXT_COPY.commute.hasDeparture).toBe(true);
    expect(CONTEXT_COPY.travel.hasDeparture).toBe(true);
    for (const f of ["agri", "outdoor", "events", "daily", "health", "work"] as const) {
      expect(CONTEXT_COPY[f].hasDeparture, f).toBe(false);
    }
  });

  it("Daily Life is never required to have a schedule", () => {
    expect(CONTEXT_COPY.daily.scheduleOptional).toBe(true);
    expect(build("rain", ["daily"], 16 * 60, { ...DEFAULT_PROFILE, schedules: {} }).headline).not.toBeNull();
  });
});
