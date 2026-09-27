import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FOCUS, type FocusId } from "../src/domain/focus";
import { buildInsights } from "../src/domain/insights";
import { buildScenarioForecast, scenarioDayTimes, SCENARIOS } from "../src/data/scenarios";
import { DEMO_LOCATION } from "../src/domain/location";
import { DEFAULT_PROFILE } from "../src/domain/routine";
import { IST_OFFSET_MIN } from "../src/data/mock";
import type { NormalizedForecast } from "../src/domain/weather";

/* The focus store is the only persistence the personalisation feature owns, and
   it is a module-level singleton that reads localStorage during import. So each
   test installs a storage stub, resets the module registry, and re-imports the
   store — that re-runs `load()` and gives every test its own fresh instance
   rather than one store shared by the whole file. */

const KEY = "mausam.focus.v1";
const ONBOARDED_KEY = "mausam.onboarded.v1";

/** Minimal in-memory stand-in. The store only ever calls getItem/setItem. */
function stubStorage() {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
  return {
    raw: (k: string) => map.get(k) ?? null,
    seed: (k: string, v: unknown) => map.set(k, typeof v === "string" ? v : JSON.stringify(v)),
    has: (k: string) => map.has(k),
  };
}

type Store = typeof import("../src/state/focus-store").useFocus;

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return (await import("../src/state/focus-store")).useFocus;
}

let mem: ReturnType<typeof stubStorage>;

beforeEach(() => {
  mem = stubStorage();
});

const state = async (): Promise<ReturnType<Store["getState"]>> =>
  (await freshStore()).getState();
const loadWith = async (payload: unknown) => {
  mem.seed(KEY, payload);
  return (await freshStore()).getState();
};

/* ==================================================== THE SURFACE ITSELF === */

describe("the dead custom-metric surface is gone", () => {
  /* An earlier draft persisted an explicit metric-override list. Nothing ever
     read it. The failure mode it creates is subtle: dead state that looks
     load-bearing and is faithfully round-tripped through storage, so nobody can
     tell from the payload that the feature is not actually wired to anything.
     These tests fail if it creeps back. */

  it("exposes no metric-override state or actions", async () => {
    const s = await state();
    const store = s as unknown as Record<string, unknown>;
    expect(store.custom).toBeUndefined();
    expect(store.setCustom).toBeUndefined();
    expect(store.toggleCustom).toBeUndefined();
  });

  it("writes a payload with no custom key", async () => {
    const s = await freshStore();
    s.getState().toggle("health");
    const written = mem.raw(KEY);
    expect(written).not.toBeNull();
    expect(Object.keys(JSON.parse(written!)).sort()).toEqual(["selected"]);
  });
});

/* ==================================================== PERSISTENCE ========= */

describe("focus persistence", () => {
  it("round-trips a selection across a reload", async () => {
    const first = await freshStore();
    first.getState().toggle("health");
    first.getState().toggle("travel");
    first.getState().toggle("agri");
    expect(mem.has(ONBOARDED_KEY)).toBe(false);

    const reloaded = await state();
    expect(reloaded.selected).toEqual<FocusId[]>(["health", "travel", "agri"]);
  });

  it("keeps selection and onboarding as separate facts", async () => {
    /* Choosing focuses marks the user onboarded; toggling later from Settings
       must not be what makes onboarding reappear, and selecting a focus is not
       itself the onboarding signal. */
    const s = await freshStore();
    expect(s.getState().onboarded).toBe(false);
    s.getState().toggle("health");
    expect(mem.has(ONBOARDED_KEY)).toBe(false);
    s.getState().completeOnboarding(["health"]);
    expect(mem.raw(ONBOARDED_KEY)).toBe("1");
  });

  it("survives a payload written by a build that had a custom array", async () => {
    const s = await loadWith({
      selected: ["health", "agri"],
      custom: ["precipAccumulation", "humidity"],
    });
    expect(s.selected).toEqual<FocusId[]>(["health", "agri"]);
  });

  it("drops unknown focus ids from a payload", async () => {
    const s = await loadWith({ selected: ["health", "not_a_focus", 42, null] });
    expect(s.selected).toEqual<FocusId[]>(["health"]);
  });

  it("starts empty on a corrupt payload rather than throwing", async () => {
    const s = await loadWith("{ this is not json");
    expect(s.selected).toEqual<FocusId[]>([]);
  });

  it("starts empty when the payload is missing entirely", async () => {
    const s = await state();
    expect(s.selected).toEqual<FocusId[]>([]);
  });
});

/* ==================================================== SELECTION =========== */

describe("focus selection", () => {
  it("toggles a focus on and back off", async () => {
    const s = await freshStore();
    s.getState().toggle("agri");
    expect(s.getState().selected).toEqual<FocusId[]>(["agri"]);
    s.getState().toggle("agri");
    expect(s.getState().selected).toEqual<FocusId[]>([]);
  });

  it("keeps selection order as the user chose it", async () => {
    const s = await freshStore();
    s.getState().toggle("work");
    s.getState().toggle("health");
    s.getState().toggle("commute");
    expect(s.getState().selected).toEqual<FocusId[]>(["work", "health", "commute"]);
    expect((await state()).selected).toEqual<FocusId[]>(["work", "health", "commute"]);
  });

  it("allows an empty selection, which reads as Daily Life", async () => {
    /* An empty selection is a real state, not a bug — `combineFocuses` resolves
       it to Daily Life. Untick the last chip and the page keeps saying something
       honest instead of refusing to untick with no visible reason. */
    const s = await freshStore();
    s.getState().completeOnboarding(["health"]);
    s.getState().toggle("health");
    expect(s.getState().selected).toEqual<FocusId[]>([]);
    expect((await state()).selected).toEqual<FocusId[]>([]);
  });

  it("falls back to Daily Life when onboarding completes with nothing chosen", async () => {
    const s = await freshStore();
    s.getState().completeOnboarding([]);
    expect(s.getState().selected).toEqual<FocusId[]>([DEFAULT_FOCUS]);
  });

  it("ignores unknown ids passed to completeOnboarding", async () => {
    const s = await freshStore();
    s.getState().completeOnboarding(["nope", "health"] as FocusId[]);
    expect(s.getState().selected).toEqual<FocusId[]>(["health"]);
  });

  it("defaults to Daily Life when skipped", async () => {
    const s = await freshStore();
    s.getState().skipOnboarding();
    expect(s.getState().selected).toEqual<FocusId[]>([DEFAULT_FOCUS]);
    expect(s.getState().onboarded).toBe(true);
    expect((await state()).onboarded).toBe(true);
  });

  it("resets to Daily Life and marks onboarded", async () => {
    const s = await freshStore();
    s.getState().completeOnboarding(["agri", "events"]);
    s.getState().reset();
    expect(s.getState().selected).toEqual<FocusId[]>([DEFAULT_FOCUS]);
    expect(s.getState().onboarded).toBe(true);
    expect((await state()).selected).toEqual<FocusId[]>([DEFAULT_FOCUS]);
  });

  it("ignores a toggle for an id that is not a focus", async () => {
    const s = await freshStore();
    s.getState().toggle("ghost" as FocusId);
    expect(s.getState().selected).toEqual<FocusId[]>([]);
  });
});

/* =========================== PERSONALISATION IS DERIVED, NOT DECLARED ==== */

describe("selection alone drives the reading", () => {
  /* Nothing else feeds interpretation. If this breaks, a metric-override
     control somewhere is quietly required for the page to say anything — which
     is exactly what the deleted surface implied. */

  function forecast(): NormalizedForecast {
    const s = SCENARIOS.find((x) => x.id === "rain")!;
    const at = Date.UTC(2026, 8, 26, 6, 0);
    const d = scenarioDayTimes(DEMO_LOCATION.lat, DEMO_LOCATION.lon, at);
    return {
      location: DEMO_LOCATION,
      tzOffsetMin: IST_OFFSET_MIN,
      timezone: DEMO_LOCATION.timezone ?? "Asia/Kolkata",
      fetchedAt: at,
      source: "mock",
      current: null,
      hourly: buildScenarioForecast(s, DEMO_LOCATION.lat, IST_OFFSET_MIN, at),
      sunriseMin: d.sunriseMin,
      sunsetMin: d.sunsetMin,
    };
  }

  it("turns a restored selection into the right focus reading", async () => {
    const stored = await loadWith({ selected: ["health"] });
    expect(stored.selected).toEqual<FocusId[]>(["health"]);

    const out = buildInsights({
      forecast: forecast(),
      profile: DEFAULT_PROFILE,
      nowMin: 16 * 60,
      scenario: true,
      focusIds: stored.selected,
    });
    expect(out.candidates.map((c) => c.focusId)).toContain("health");
    expect(out.candidates.find((c) => c.focusId === "health")?.title).toBeTruthy();
  });

  it("reads as Daily Life for an empty selection", async () => {
    mem.seed(KEY, { selected: [] });
    const stored = (await freshStore()).getState();
    const out = buildInsights({
      forecast: forecast(),
      profile: DEFAULT_PROFILE,
      nowMin: 16 * 60,
      scenario: true,
      focusIds: stored.selected,
    });
    // Resolved rather than empty, so the page always has something to say.
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.ctx.windows.map((w) => w.focusId)).toContain(DEFAULT_FOCUS);
  });
});
