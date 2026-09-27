import type { MetricId } from "./capabilities";
import type { HourSample, NormalizedForecast } from "./weather";
import { effectiveExposure, type RoutineEvent, type UserProfile } from "./routine";
import { formatClock } from "../lib/utils";

/* =================================================================== FOCUS ==

   A focus is a statement of what the weather is *for*. It does not change the
   weather, and it does not change how a hazard is scored — the existing
   exposure arithmetic in the decision engine remains the only thing that
   decides how bad a condition is. A focus only decides which windows are worth
   examining, which measurements are worth surfacing, and how the finding is put
   into words for someone who cares about that particular thing.

   This is why focus is a sibling of routine rather than a field on it. A
   farmer and a student may share a routine, or have none at all; the routine
   answers "when am I out", the focus answers "what does the weather mean to
   me". Keeping them apart is what lets a demo switch interpretation without
   touching a single weather value. */

export type FocusId =
  | "daily"
  | "commute"
  | "health"
  | "travel"
  | "work"
  | "agri"
  | "outdoor"
  | "events";

/** A window before it has been attributed to the focus that produced it. */
export type DraftWindow = Omit<FocusWindow, "focusId">;

/**
 * A stretch of time a focus cares about.
 *
 * Windows are the reason focus can produce advice at all. The existing engine
 * only ever looked at routine events, which silently assumed everyone has a
 * commute — a farmer with no routine would have been handed an empty homepage.
 * A window is the generalisation: some named span of the day, scored with the
 * same exposure math.
 */
export interface FocusWindow {
  id: string;
  label: string;
  /** Minutes after local midnight when the window opens. */
  startMin: number;
  /** Length of the window in minutes. */
  durationMin: number;
  /**
   * How exposed a person is across this window, 0..1, using the same scale as
   * `MODE_EXPOSURE`. A field is closer to 1 than a car journey is, because
   * there is no enclosure to discount it by.
   */
  exposure: number;
  /** Short phrase used in the WHY panel, e.g. "your field window". */
  reason: string;
  /** The focus that contributed this window. */
  focusId: FocusId;
}

/** How a focus phrases its findings. Wording is a focus's whole visible identity. */
export interface FocusVoice {
  /** Headline sentence when conditions in the window are worth attention. */
  headline: (ctx: VoiceContext) => string;
  /** The single action line beneath it. */
  action: (ctx: VoiceContext) => string | undefined;
}

export interface VoiceContext {
  /** Local minutes the window is centred on. */
  atMin: number;
  /** Peak severity inside the window, 0..1. */
  severity: number;
  /** What the condition is, in words, with units attached. */
  condition: string;
  /** Hours from now until the window opens, for lead-time wording. */
  leadHours: number;
  /**
   * The single forecast sample this reading was scored on — the worst moment in
   * the window, not an average. Exposed whole rather than as pre-picked fields so
   * each voice can quote whichever measure it actually cares about, and so the
   * number in a sentence can always be traced back to the row it came from.
   * Null when the window has no forecast coverage at all.
   */
  peak: HourSample | null;
  /** Total forecast rainfall across the whole window, mm. */
  totalRainMm: number;
  /** The window's length in minutes, so a quantity can be worded against a span. */
  windowMin: number;
  /**
   * Measurements that actually crossed this focus's own threshold, taken from
   * the same samples that produced this reading.
   *
   * A voice may only assert a hazard that appears here. The Travel focus used to
   * carry a fixed "Visibility and rain may affect travel", which is why a clear
   * night with a 0% chance of rain was still told that visibility and rain were
   * problems: the sentence was not derived from the weather at all. With this on
   * the context, "no notable hazards" is expressible, and a focus with nothing
   * to say says nothing.
   */
  notable: { metric: MetricId; text: string }[];
}

/**
 * Word a rainfall accumulation against the window it covers.
 *
 * A rate and a total are not interchangeable, and swapping them is the
 * difference between "10.9 mm expected in the next 12 hours" and "5.6 mm in the
 * next 12 hours" — the first is how much water arrives, the second is how hard
 * it is falling at one moment, and the reader has no way to tell which was
 * meant. So any voice that names a time window must quote a total from here,
 * and may only quote a rate when it says so explicitly.
 *
 * Returns null for a dry window, letting the caller fall back to a
 * condition-based sentence rather than announcing "0.0 mm".
 */
export function accumulation(totalMm: number, windowMin: number): string | null {
  if (!(totalMm > 0)) return null;
  return `${totalMm.toFixed(1)} mm expected in the next ${windowHours(windowMin)}`;
}

function windowHours(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hours` : `${h.toFixed(1)} hours`;
}

/**
 * Word the peak sample as something a person would feel.
 *
 * Health exists to answer "how does this weather feel?", which is a different
 * question from "how much of it is there?" — so it must not borrow Agriculture's
 * accumulation or Events' window. Every branch states a peak and the hour it
 * happens at, never a claim about how long a condition persists, because a
 * single sample cannot support one.
 */
export function comfort(peak: HourSample | null): string | null {
  if (!peak) return null;
  const at = formatClock(peak.hour * 60);
  const feels = Math.round(peak.feelsC);
  const humidity = peak.humidityPct;

  // Apparent temperature is the comfort signal that actually changes plans, so
  // it leads whenever it is uncomfortable.
  if (feels >= 30 || feels <= 8) return `Feels like ${feels}° at its worst, around ${at}.`;
  // Humidity is optional on the sample, and an absent reading is not a dry one.
  if (typeof humidity === "number" && humidity >= 80) {
    return `Humidity peaks at ${Math.round(humidity)}% around ${at} — muggy.`;
  }
  if (peak.uvIndex >= 8) return `UV reaches ${Math.round(peak.uvIndex)} around ${at}.`;
  if (peak.windKph >= 30) return `Wind reaches ${Math.round(peak.windKph)} km/h around ${at}.`;
  return `Feels like ${feels}° around ${at}.`;
}

export interface UserFocus {
  id: FocusId;
  label: string;
  /**
   * Compact form, for the header chips and the attribution line.
   *
   * Required rather than optional, so no focus can reach those surfaces without
   * having decided what it is called there. "Commute / College" is the honest
   * name of the picker option; "Commute" is what fits in a chip that has to share
   * a row with seven others.
   */
  short: string;
  description: string;
  /** Measurements this focus wants surfaced. A union across focuses is shown. */
  needs: MetricId[];
  /** Builds the windows this focus examines, given the clock and the day. */
  windows: (f: NormalizedForecast, nowMin: number) => DraftWindow[];
  /**
   * Values at which this focus considers a measurement notable.
   *
   * Deliberately sparse. A focus that flagged everything would flag nothing,
   * and these thresholds are only read for metrics the focus actually names.
   */
  thresholds: Partial<Record<MetricId, number>>;
  voice: FocusVoice;
  /**
   * Rank used when two focuses disagree about the same metric. Higher wins.
   *
   * This is what stops `combineFocuses` from blindly taking the most
   * conservative value: a user who said "Travel + Health" wants travel's idea
   * of what matters, with health's filling the gaps, not the intersection of
   * both people's strictest settings.
   */
  rank: number;
}

/* ------------------------------------------------------------- WINDOW HELPERS */

/** Sunrise to sunset, or a sane daylight span when the day bounds are unknown. */
function daylightWindow(
  f: NormalizedForecast,
  nowMin: number,
  id: string,
  label: string,
  exposure: number,
  reason: string,
): DraftWindow {
  const hasBounds = f.sunriseMin < f.sunsetMin;
  const rise = hasBounds ? f.sunriseMin : 6 * 60;
  const set = hasBounds ? f.sunsetMin : 18 * 60;
  const duration = Math.max(60, set - rise);
  // If the day is nearly over, the remaining daylight is what is left to plan.
  const startMin = nowMin > rise ? nowMin : rise;
  return {
    id,
    label,
    startMin,
    durationMin: hasBounds ? Math.max(30, set - startMin) : duration,
    exposure,
    reason,
  };
}

/** A fixed span measured from now. */
function rollingWindow(
  nowMin: number,
  id: string,
  label: string,
  durationMin: number,
  exposure: number,
  reason: string,
): DraftWindow {
  return { id, label, startMin: nowMin, durationMin, exposure, reason };
}

/* ----------------------------------------------------------------- FOCUSES */

const DAILY: UserFocus = {
  id: "daily",
  label: "Daily Life",
  short: "Daily Life",
  description: "General conditions for getting through the day.",
  needs: ["temperature", "precipProbability", "precipitation", "wind", "uv", "humidity"],
  rank: 1,
  thresholds: { precipProbability: 0.4, wind: 25, uv: 6, humidity: 80 },
  windows: (f, nowMin) => [daylightWindow(f, nowMin, "day", "Daylight hours", 0.6, "the hours you are out and about")],
  voice: {
    headline: (c) => `${c.condition} around ${fmt(c.atMin)} today.`,
    action: (c) =>
      c.severity > 0.5 ? "Take an umbrella if you are heading out." : undefined,
  },
};

const COMMUTE: UserFocus = {
  id: "commute",
  label: "Commute / College",
  short: "Commute",
  description: "Your regular journeys and the weather you meet on them.",
  needs: ["precipProbability", "precipitation", "temperature", "visibility", "wind", "thunder"],
  rank: 8,
  thresholds: { precipProbability: 0.35, visibility: 2, wind: 30, thunder: 0.4 },
  // Commute windows are the user's own routine events; the engine reuses those
  // directly rather than this synthesising anything, so there are no windows
  // here. That is what stops the two systems from disagreeing about 5:30 PM.
  windows: () => [],
  voice: {
    headline: (c) => `Your ${fmt(c.atMin)} journey may be affected.`,
    action: () => "Consider leaving earlier.",
  },
};

const HEALTH: UserFocus = {
  id: "health",
  label: "Health",
  short: "Health",
  description: "Environmental conditions that affect how the day feels.",
  needs: ["uv", "humidity", "temperature", "apparentTemperature", "precipitation", "wind", "aqi"],
  rank: 6,
  thresholds: { uv: 5, humidity: 75, temperature: 32, apparentTemperature: 35 },
  windows: (_f, nowMin) => [rollingWindow(nowMin, "next-hours", "The next few hours", 6 * 60, 0.5, "the hours ahead")],
  voice: {
    /* Comfort, not accumulation and not a named window. Falling back to the
       shared condition is the safety net, not the common case. */
    headline: (c) => comfort(c.peak) ?? `${c.condition} over the next ${windowHours(c.windowMin)}.`,
    action: (c) =>
      c.severity > 0.5 ? "Outdoor conditions may be uncomfortable for a while." : undefined,
  },
};

const TRAVEL: UserFocus = {
  id: "travel",
  label: "Travel",
  short: "Travel",
  description: "Conditions across the hours you might be moving around in.",
  needs: ["precipProbability", "precipitation", "temperature", "wind", "visibility", "thunder"],
  rank: 7,
  thresholds: { precipProbability: 0.3, visibility: 2, wind: 35, thunder: 0.3 },
  windows: (_f, nowMin) => {
    // Three named parts of the day, so "which window is clear?" has an answer
    // instead of one undifferentiated next-12-hours blob.
    const parts: Array<[string, number]> = [
      ["Morning", 6 * 60],
      ["Afternoon", 12 * 60],
      ["Evening", 18 * 60],
    ];
    return parts
      .filter(([, at]) => at + 180 > nowMin)
      .map(([label, at]) => ({
        id: `travel-${label.toLowerCase()}`,
        label: `${label} travel window`,
        startMin: Math.max(nowMin, at),
        durationMin: 180,
        exposure: 0.7,
        reason: `your ${label.toLowerCase()} travel window`,
      }));
  },
  voice: {
    headline: (c) => `Conditions during your ${windowWord(c.atMin)} travel window.`,
    action: travelAction,
  },
};

const WORK: UserFocus = {
  id: "work",
  label: "Work",
  short: "Work",
  description: "Conditions for a working day, including time spent outside.",
  needs: ["temperature", "apparentTemperature", "precipProbability", "precipitation", "wind", "gusts", "uv", "thunder"],
  rank: 5,
  thresholds: { apparentTemperature: 33, wind: 30, precipProbability: 0.45, uv: 7 },
  windows: (f, nowMin) => [daylightWindow(f, nowMin, "workday", "Working hours", 0.85, "your working window")],
  voice: {
    headline: (c) => `${c.condition} during your working window.`,
    action: (c) =>
      c.severity > 0.55 ? "Conditions may affect work scheduled outside." : undefined,
  },
};

const AGRI: UserFocus = {
  id: "agri",
  label: "Agriculture",
  short: "Agriculture",
  description: "Rainfall, temperature and soil conditions for field work.",
  needs: ["precipAccumulation", "precipitation", "precipProbability", "temperature", "humidity", "wind", "soilMoisture"],
  rank: 4,
  thresholds: { precipAccumulation: 1, temperature: 35, wind: 30, soilMoisture: 0.15 },
  windows: (_f, nowMin) => [rollingWindow(nowMin, "field", "The next 12 hours", 12 * 60, 1, "the next field window")],
  voice: {
    /* Accumulation, not intensity. The question a farmer is asking is how much
       water arrives, and the peak hourly rate answers a different one — quoting
       it here would also contradict the "Rainfall total" row directly beneath,
       which reports the real sum. */
    headline: (c) =>
      `${
        accumulation(c.totalRainMm, c.windowMin) ??
        `${c.condition} in the next ${windowHours(c.windowMin)}`
      }.`,
    // Reports the measurement. It does not claim the field is suitable for any
    // particular operation — that judgement belongs to the farmer, and the
    // model soil-moisture field is not precise enough to make it for them.
    action: () => "Useful as a planning input for the day ahead.",
  },
};

const OUTDOOR: UserFocus = {
  id: "outdoor",
  label: "Outdoor activities",
  short: "Outdoor",
  description: "Whether the daylight hours are worth spending outside.",
  needs: ["precipProbability", "precipitation", "uv", "temperature", "wind", "visibility", "thunder"],
  rank: 3,
  thresholds: { precipProbability: 0.3, uv: 6, wind: 30, thunder: 0.3 },
  windows: (f, nowMin) => [daylightWindow(f, nowMin, "daylight", "Remaining daylight", 1, "the remaining daylight hours")],
  voice: {
    headline: (c) => `${c.condition} for the rest of the daylight.`,
    action: (c) => (c.severity > 0.5 ? "Outdoor plans may need to move indoors." : undefined),
  },
};

const EVENTS: UserFocus = {
  id: "events",
  label: "Events",
  short: "Events",
  description: "Conditions across an event window you are responsible for.",
  needs: ["precipProbability", "precipitation", "temperature", "wind", "gusts", "thunder", "visibility"],
  rank: 2,
  thresholds: { precipProbability: 0.35, gusts: 40, thunder: 0.3, visibility: 2 },
  windows: (_f, nowMin) => [
    rollingWindow(nowMin, "event", "Your event window", 4 * 60, 0.95, "your event window"),
  ],
  voice: {
    headline: (c) => `${c.condition} during your event window.`,
    action: (c) =>
      c.severity > 0.45 ? "Consider an indoor contingency for the event." : undefined,
  },
};

/* Display order, which is what every focus picker renders.

   Daily Life leads, because it is the one focus that is never wrong to have
   selected and the one a first-time reader recognises. Note that this is
   orthogonal to `rank`: Daily is ranked *lowest* for priority, so that explicitly
   choosing Commute lets the commute reading win, while an unranked Daily
   selection never outranks what the user actually asked for. The two orderings
   answer different questions and must not be collapsed into one. */
/** Hazards are named only when the window actually contains one. */
function travelAction(c: VoiceContext): string | undefined {
  const has = (m: MetricId) => c.notable.some((n) => n.metric === m);
  const hazards: string[] = [];
  if (has("precipitation") || has("precipProbability")) hazards.push("rain");
  if (has("thunder")) hazards.push("thunderstorms");
  if (has("visibility")) hazards.push("low visibility");
  if (has("wind") || has("gusts")) hazards.push("wind");
  if (hazards.length === 0) return undefined;
  const list =
    hazards.length === 1
      ? hazards[0]!
      : `${hazards.slice(0, -1).join(", ")} and ${hazards[hazards.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} may affect travel in this window.`;
}

export const FOCUSES: UserFocus[] = [
  DAILY,
  COMMUTE,
  HEALTH,
  TRAVEL,
  WORK,
  AGRI,
  OUTDOOR,
  EVENTS,
];

export const FOCUS_BY_ID: Record<FocusId, UserFocus> = Object.fromEntries(
  FOCUSES.map((f) => [f.id, f]),
) as Record<FocusId, UserFocus>;

export const DEFAULT_FOCUS: FocusId = "daily";

/**
 * A valid context with nothing selected and nothing to look at.
 *
 * Used before a forecast exists. It is deliberately a *valid* context rather
 * than a null: every consumer can rely on there being a focus, so no screen
 * needs a "loading" branch for the concept itself.
 */
export function emptyContext(): FocusContext {
  return {
    focuses: [FOCUS_BY_ID[DEFAULT_FOCUS]],
    ids: [DEFAULT_FOCUS],
    needs: [],
    windows: [],
    thresholds: {},
    isDefault: true,
  };
}

/* ------------------------------------------------------------- COMBINATION == */

export interface FocusContext {
  /** The focuses actually in play. Never empty — a default is substituted. */
  focuses: UserFocus[];
  ids: FocusId[];
  /** Union of every focus's needs. */
  needs: MetricId[];
  /** Every window from every focus, de-duplicated by id. */
  windows: FocusWindow[];
  /**
   * One threshold per metric, taken from the highest-ranked focus that declares
   * it. This is deliberately *not* the most conservative value: with Travel and
   * Health selected, the user is asking a travel question and a health question
   * at once, and inheriting the strictest setting of both would make the app
   * cry wolf about weather that is fine for either.
   */
  thresholds: Partial<Record<MetricId, number>>;
  /** True when the user made no selection and we fell back to Daily life. */
  isDefault: boolean;
}

/**
 * Combine the selected focuses into one context.
 *
 * Capabilities, windows and metrics are unioned because two concerns genuinely
 * coexist — someone who selected both Health and Outdoor wants to know about UV
 * *and* about rain, and dropping either would be wrong. Thresholds are resolved
 * by rank instead, because there a union has no meaning and a stricter-than-
 * necessary reading would be actively misleading.
 */
/** Turn the windows configured for a focus into the windows the engine scores.
 *
 *  A window that has already finished is dropped rather than re-dated: telling
 *  someone about the field work they did at six this morning, restated as
 *  starting now, is not a near-miss. A window already under way is clipped to
 *  the time that is left, because that is genuinely still ahead. */
function scheduleWindows(events: readonly RoutineEvent[], nowMin: number): DraftWindow[] {
  return events.flatMap((e) => {
    const endMin = e.startMin + e.durationMin;
    if (endMin <= nowMin) return [];
    const startMin = Math.max(nowMin, e.startMin);
    return [
      {
        id: e.id,
        label: e.label,
        startMin,
        durationMin: Math.max(30, endMin - startMin),
        exposure: effectiveExposure(e),
        reason: `your ${e.label.toLowerCase()}`,
      },
    ];
  });
}

export function combineFocuses(
  ids: readonly FocusId[],
  f: NormalizedForecast,
  nowMin: number,
  /** The user's own windows, per focus. A focus that has some reads those; a
   *  focus that has none falls back to the parts of the day it cares about. */
  schedules: UserProfile["schedules"] = {},
): FocusContext {
  const valid = ids.filter((id): id is FocusId => id in FOCUS_BY_ID);
  const chosen = (valid.length > 0 ? valid : [DEFAULT_FOCUS]).map((id) => FOCUS_BY_ID[id]);

  const needs = new Set<MetricId>();
  const windows = new Map<string, FocusWindow>();
  const thresholds: Partial<Record<MetricId, number>> = {};

  // Highest rank first, so the first focus to declare a metric keeps it.
  const byRank = [...chosen].sort((a, b) => b.rank - a.rank);

  for (const f of byRank) {
    for (const m of f.needs) needs.add(m);
    Object.assign(thresholds, f.thresholds);
  }

  /* Windows are built in a second pass, because a window is a claim about the
     user's own day and so needs both the forecast and their schedule.

     A focus the user has configured a schedule for reads *those* windows, not
     the built-in parts of the day: "your workday" means the hours they said
     they work, and a 9-to-5 default that disagrees with them is worse than no
     default. A focus with no configured schedule keeps its generic windows, so
     Work and Travel still say something sensible before anyone has configured
     them — inventing a schedule for a focus the user has not described would be
     the same mistake in a new place, so nothing is stored until they ask.

     Commute contributes none either way: it is served by the decision engine
     from the schedule itself, so the commute keeps its departure-time
     uncertainty and mode exposure rather than a simplified second copy. */
  for (const focus of chosen) {
    const configured = scheduleWindows(schedules[focus.id]?.events ?? [], nowMin);
    const drafts = configured.length ? configured : focus.windows(f, nowMin);
    for (const w of drafts) {
      if (!windows.has(w.id)) windows.set(w.id, { ...w, focusId: focus.id });
    }
  }

  return {
    focuses: chosen,
    ids: chosen.map((x) => x.id),
    needs: [...needs],
    windows: [...windows.values()],
    thresholds,
    isDefault: valid.length === 0,
  };
}

/* ------------------------------------------------------------------ HELPERS */

function fmt(min: number): string {
  const h24 = Math.floor((((min % 1440) + 1440) % 1440) / 60);
  const m = Math.round(min % 60);
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function windowWord(min: number): string {
  const h = Math.floor((((min % 1440) + 1440) % 1440) / 60);
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
