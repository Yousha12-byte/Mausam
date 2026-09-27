import type { Decision, WhyItem } from "./decision";
import { peakWithEnclosure, localMinToEpoch, confidenceFor, severityBand } from "./decision";
import { scopeProfile, type UserProfile } from "./routine";
import type { FocusContext, FocusWindow, UserFocus, VoiceContext } from "./focus";
import { CAPABILITIES, formatHumidity, formatSoilMoisture, type MetricId } from "./capabilities";
import type { HourSample, NormalizedForecast } from "./weather";
import { formatClock } from "../lib/utils";

/* Turning a window into a sentence.

   A focus window produces a decision only when there is something to say, and
   "something" means one of three things: a condition that crosses a threshold
   the focus actually cares about, a measurement the focus explicitly asked for,
   or an all-clear. Nothing else. That restraint is what stops the homepage
   filling up with restatements of the hero card.

   Every number that appears in a headline or an action also appears in `why`.
   If a sentence cannot be justified by its own evidence list, it does not ship. */

export interface FocusDecisionInput {
  forecast: NormalizedForecast;
  profile: UserProfile;
  nowMin: number;
  scenario: boolean;
  ctx: FocusContext;
}

/** Below this a window is not worth a card even if it is technically notable. */
const NOTABLE = 0.22;
/** At or above this a window claims the headline. */
const HEADLINE = 0.34;

/** An evidence line carrying a clock time is saying something the condition
 *  sentence does not. */
const NAMES_A_TIME = /\b\d{1,2}:\d{2}\b/;

/** De-duplicate by rendered text. Two metrics can legitimately reduce to the
 *  same sentence, and the reader should see it once. */
function uniqueByText(items: Notable[]): Notable[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}

function uniqueWhy(items: WhyItem[]): WhyItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}

export function runFocusDecisions(input: FocusDecisionInput): Decision[] {
  const { forecast: f, nowMin, scenario, ctx } = input;
  /* Scoped like the engine is, so a window's exposure comes from its own focus's
     schedule and never from an unrelated one. */
  const profile = scopeProfile(input.profile, ctx.ids);
  const out: Decision[] = [];

  for (const w of ctx.windows) {
    const focus = ctx.focuses.find((x) => x.id === w.focusId);
    if (!focus) continue;

    const peak = peakWithEnclosure(f, profile, w.startMin, w.durationMin, w.exposure);
    /* Every measurement that crossed *this focus's* threshold, from the same
       samples that produced the reading. Voices are given the whole list, so a
       sentence can only assert a hazard that is actually present in the window. */
    const notable = notableMeasurements(f, w, ctx);
    const report = describePeak(f, w, peak.sample, focus, ctx);
    const condition = report.text;
    /* Evidence the condition sentence has already stated is dropped, so the WHY
       block cannot show the same number twice — "24°C and settled" followed by
       "High of 24°C" was the same fact in two costumes.

       An evidence line that names a clock time is exempt, because *when* the
       worst of it happens is something the condition never said. "5.6 mm/h" in
       the sentence and "Peak rain 5.6 mm/h around 6:00 PM" below it are not a
       duplicate: the second one tells you when to leave the house. */
    const extras = uniqueByText(
      notable.filter((n) => !report.stated.has(n.metric) || NAMES_A_TIME.test(n.text)),
    );
    const band = severityBand(peak.severity);
    const rain = windowRain(f, w);

    // Nothing crossed a threshold and no measurement is worth showing: skip the
    // window entirely rather than emit a card that says "fine".
    if (peak.severity < NOTABLE && extras.length === 0) continue;

    const leadHours = Math.max(0, (w.startMin - nowMin) / 60);
    const headlineWorthy = peak.severity >= HEADLINE;
    const allClear = peak.severity < NOTABLE;

    const why: WhyItem[] = uniqueWhy([
      { text: condition, kind: "data" },
      { text: `Scored across ${w.reason}`, kind: "profile" },
      ...extras.map((e) => ({ text: e.text, kind: "data" as const })),
    ]);

    const voice: VoiceContext = {
      atMin: peak.atMin,
      severity: peak.severity,
      condition,
      leadHours,
      peak: peak.sample ?? null,
      totalRainMm: rain.totalMm,
      windowMin: w.durationMin,
      notable,
    };

    const action = focus.voice.action(voice);
    const headline = allClear
      ? `Conditions look settled for ${w.reason.replace(/^your /, "")}.`
      : focus.voice.headline(voice);

    out.push({
      id: `focus-${focus.id}-${w.id}`,
      kind: allClear ? "all-clear" : headlineWorthy ? "conflict" : "preview",
      severity: allClear ? ("calm" as const) : band,
      title: headline,
      detail: extras.length > 0 ? extras.map((e) => e.text).join(" · ") : w.label,
      action,
      why,
      confidence: confidenceFor(leadHours, 0, profile, scenario),
      atMin: peak.atMin,
      focusId: focus.id,
      metrics: extras.length > 0 ? extras.map((e) => e.metric) : focus.needs,
    });
  }

  return out;
}

/* ------------------------------------------------------------- MEASUREMENTS */

interface Notable {
  metric: MetricId;
  text: string;
}

/**
 * The measurements a focus asked for, sampled across its window.
 *
 * Only metrics with a real provider behind them are considered, and a metric
 * that is absent is skipped rather than defaulted — so a forecast from a source
 * that carries no humidity simply offers Health fewer numbers instead of
 * inventing a 60%.
 */
function notableMeasurements(f: NormalizedForecast, w: FocusWindow, ctx: FocusContext): Notable[] {
  const out: Notable[] = [];
  const from = localMinToEpoch(f, w.startMin);
  const to = localMinToEpoch(f, w.startMin + w.durationMin);
  const inWindow = f.hourly.filter((h) => h.t >= from && h.t <= to);
  if (inWindow.length === 0) return out;

  const wanted = new Set(ctx.needs);
  const thresholdOf = (m: MetricId) => ctx.thresholds[m];

  const max = (pick: (s: (typeof inWindow)[number]) => number | undefined) => {
    let best: number | undefined;
    for (const s of inWindow) {
      const v = pick(s);
      if (typeof v === "number" && Number.isFinite(v) && (best === undefined || v > best)) best = v;
    }
    return best;
  };

  if (wanted.has("precipAccumulation")) {
    const total = inWindow.reduce((sum, h) => sum + (h.precipMm || 0), 0);
    const limit = thresholdOf("precipAccumulation");
    if (total > 0 && (limit === undefined || total >= limit)) {
      out.push({
        metric: "precipAccumulation",
        text: `${total.toFixed(1)} mm of rain forecast across ${w.label.toLowerCase()}`,
      });
    }
  }

  if (wanted.has("precipProbability")) {
    const p = max((s) => s.precipProb);
    if (p !== undefined && p >= 0.2) {
      out.push({ metric: "precipProbability", text: `Rain chance peaks at ${Math.round(p * 100)}%` });
    }
  }

  if (wanted.has("precipitation")) {
    /* The hour is part of the claim: "5.6 mm/h" alone is a number with no
       timeframe, which is what let a peak rate be read as a window total. */
    const worst = inWindow.reduce<HourSample | undefined>((best, s) => {
      if (!(s.precipMm > 0)) return best;
      return !best || s.precipMm > best.precipMm ? s : best;
    }, undefined);
    if (worst) {
      out.push({
        metric: "precipitation",
        text: `Peak rain ${worst.precipMm.toFixed(1)} mm/h around ${formatClock(worst.hour * 60)}`,
      });
    }
  }

  if (wanted.has("temperature")) {
    const t = max((s) => s.tempC);
    if (t !== undefined) out.push({ metric: "temperature", text: `High of ${Math.round(t)}°C` });
  }

  if (wanted.has("apparentTemperature")) {
    const t = max((s) => s.feelsC);
    if (t !== undefined) {
      out.push({ metric: "apparentTemperature", text: `Feels like up to ${Math.round(t)}°C` });
    }
  }

  if (wanted.has("humidity")) {
    const h = inWindow.map((s) => formatHumidity(s)).find(Boolean);
    if (h) out.push({ metric: "humidity", text: `Humidity ${h}` });
  }

  if (wanted.has("uv")) {
    const uv = max((s) => s.uvIndex);
    if (uv !== undefined && uv >= 3) {
      out.push({ metric: "uv", text: `UV index reaches ${Math.round(uv)}` });
    }
  }

  if (wanted.has("wind")) {
    const w2 = max((s) => s.windKph);
    if (w2 !== undefined && w2 >= 15) {
      out.push({ metric: "wind", text: `Wind up to ${Math.round(w2)} km/h` });
    }
  }

  if (wanted.has("gusts")) {
    const g = max((s) => s.gustKph);
    if (g !== undefined && g >= 30) {
      out.push({ metric: "gusts", text: `Gusts up to ${Math.round(g)} km/h` });
    }
  }

  if (wanted.has("visibility")) {
    const v = inWindow
      .map((s) => s.visibilityKm)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .sort((a, b) => a - b)[0];
    if (v !== undefined && v < 10) {
      out.push({ metric: "visibility", text: `Visibility drops to ${v.toFixed(1)} km` });
    }
  }

  if (wanted.has("thunder")) {
    const t = max((s) => s.thunderProb);
    if (t !== undefined && t >= 0.15) {
      out.push({ metric: "thunder", text: `Lightning risk ${Math.round(t * 100)}%` });
    }
  }

  if (wanted.has("soilMoisture")) {
    const sm = inWindow.map((s) => formatSoilMoisture(s)).find(Boolean);
    if (sm) {
      out.push({
        metric: "soilMoisture",
        text: `Soil moisture ${sm} (${CAPABILITIES.soilMoisture.caveat?.toLowerCase()})`,
      });
    }
  }

  return out;
}

/* --------------------------------------------------------------------- RAIN */

/**
 * Rainfall accumulated across a window, in mm.
 *
 * Summed over the same slice of the series the reading was scored on, so the
 * number a voice quotes and the number the metric row shows cannot drift apart.
 */
function windowRain(f: NormalizedForecast, w: FocusWindow): { totalMm: number } {
  const from = localMinToEpoch(f, w.startMin);
  const to = localMinToEpoch(f, w.startMin + w.durationMin);
  let total = 0;
  for (const h of f.hourly) {
    if (h.t < from || h.t > to) continue;
    total += h.precipMm || 0;
  }
  return { totalMm: total };
}

/* ------------------------------------------------------------------ WORDING */

/** What the sentence says, and which metrics it has therefore *already* stated.
 *
 *  The second half is what stops the WHY block repeating itself. The condition
 *  used to end in the temperature, and the evidence list then added "High of
 *  28°C" for the same number — the same fact in two costumes, which is what the
 *  duplicate "High of 28°C" in the Travel reading was. Rather than comparing
 *  strings after the fact, the sentence declares what it covered and the caller
 *  drops the evidence for exactly those metrics. */
function describePeak(
  f: NormalizedForecast,
  w: FocusWindow,
  s: (typeof f.hourly)[number],
  focus: UserFocus,
  ctx: FocusContext,
): { text: string; stated: Set<MetricId> } {
  const parts: string[] = [];
  const stated = new Set<MetricId>();
  if (s.precipMm > 0) {
    parts.push(`${s.precipMm.toFixed(1)} mm/h`);
    stated.add("precipitation");
  } else if (s.precipProb >= 0.3) {
    parts.push(`${Math.round(s.precipProb * 100)}% chance of rain`);
    stated.add("precipProbability");
  }

  if (s.thunderProb >= 0.25) {
    parts.push("thunder possible");
    stated.add("thunder");
  }
  if (s.gustKph >= 40) {
    parts.push(`gusts to ${Math.round(s.gustKph)} km/h`);
    stated.add("gusts");
  } else if (s.windKph >= 30) {
    parts.push(`wind to ${Math.round(s.windKph)} km/h`);
    stated.add("wind");
  }
  if (s.feelsC >= 32) {
    parts.push(`feels like ${Math.round(s.feelsC)}°C`);
    stated.add("apparentTemperature");
  } else if (s.tempC <= 4) {
    parts.push(`down to ${Math.round(s.tempC)}°C`);
    stated.add("temperature");
  }

  if (parts.length === 0) {
    // A focus that named visibility gets a sentence about it; otherwise the
    // window is described in temperature terms, which are always available.
    const lowVis = focus.needs.includes("visibility") && typeof s.visibilityKm === "number" && s.visibilityKm < 5;
    if (lowVis) {
      parts.push(`visibility down to ${(s.visibilityKm as number).toFixed(1)} km`);
      stated.add("visibility");
    } else {
      parts.push(`${Math.round(s.tempC)}°C and settled`);
      stated.add("temperature");
    }
  }

  void w;
  void ctx;
  return { text: parts.join(", "), stated };
}
