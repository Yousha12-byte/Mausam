import type { HourSample, NormalizedForecast } from "./weather";
import type { DecisionProfile } from "./routine";
import type { ExposureVector, TravelMode } from "./weather";
import type { FocusId } from "./focus";
import type { MetricId } from "./capabilities";
import { effectiveExposure, MODE_EXPOSURE } from "./routine";
import { baseVector, CODE_LABEL } from "./taxonomy";
import { clamp } from "../lib/utils";

/* ============================================================ TYPES ===== */

export type Severity = "calm" | "note" | "caution" | "avoid";

export interface ConfidenceFactor {
  label: string;
  value: number;
  detail: string;
}

export interface WhyItem {
  text: string;
  kind: "data" | "profile" | "action";
}

export interface Decision {
  id: string;
  kind: "conflict" | "all-clear" | "severe" | "preview";
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
  actionSub?: string;
  why: WhyItem[];
  confidence: { overall: number; factors: ConfidenceFactor[] };
  /** Local minutes after midnight, for ordering and highlighting. */
  atMin: number;
  /** The routine event this decision is about, for the what-if control. */
  eventId?: string;
  /**
   * The focus that produced this reading, when it came from a focus window
   * rather than a routine event. Absent on routine and severe decisions, which
   * are about the weather itself and so belong to every focus equally.
   */
  focusId?: FocusId;
  /** Metrics this reading is reporting, for the homepage detail rows. */
  metrics?: MetricId[];
}

/* ====================================================== TIME SAMPLING ==== */

/**
 * The instant, in epoch ms, that `localMin` refers to on the forecast's own
 * first day. The series is anchored to the local midnight its first entry
 * represents, so this stays correct for any window length and any timezone.
 */
export function localMinToEpoch(f: NormalizedForecast, localMin: number): number {
  const first = f.hourly[0]!;
  const firstLocal = new Date(first.t + f.tzOffsetMin * 60_000);
  const firstMin = firstLocal.getUTCHours() * 60 + firstLocal.getUTCMinutes();
  const day = Math.floor(localMin / 1440);
  const m = ((localMin % 1440) + 1440) % 1440;
  return first.t + (day * 1440 + m - firstMin) * 60_000;
}

/**
 * The conditions to show for "right now".
 *
 * When the provider published a real observation and that observation actually
 * describes the requested minute, it wins outright: it is measured, whereas the
 * hourly grid holds modelled values. The 45-minute window is deliberate — a
 * pinned demo clock or a What-If departure can ask for a time hours away from
 * the observation, and reading a 2pm observation for a 6pm query would be worse
 * than interpolating the forecast. Generated data sets `current` to null and
 * always falls through to the grid.
 */
export function currentObservationAt(f: NormalizedForecast, localMin: number): HourSample {
  const c = f.current;
  if (c) {
    const drift = Math.abs(c.t - localMinToEpoch(f, localMin));
    if (drift <= 45 * 60_000) return c;
  }
  return sampleAt(f, localMin);
}

/**
 * Interpolate the hourly series to an arbitrary local minute. This is what
 * makes "leave 25 minutes earlier" precise rather than rounded to the hour.
 *
 * Hours are located by their own timestamps, never by array position. Indexing
 * only works while the series happens to start at the current local midnight,
 * so it silently reported the wrong day for an app left open past midnight, and
 * would break for any change to the requested window.
 */
export function sampleAt(f: NormalizedForecast, localMin: number): HourSample {
  const h = f.hourly;
  const n = h.length;
  if (n === 0) throw new Error("empty forecast");
  const m = ((localMin % 1440) + 1440) % 1440;

  const target = localMinToEpoch(f, localMin);
  let i = 0;
  while (i + 1 < n && h[i + 1]!.t <= target) i++;
  const a = h[i]!;
  const b = h[Math.min(i + 1, n - 1)]!;
  const span = b.t - a.t;
  const t = span > 0 ? Math.min(1, Math.max(0, (target - a.t) / span)) : 0;
  const mix = (x: number, y: number) => x + (y - x) * t;

  /* Daylight is decided from the forecast's own sunrise/sunset rather than from
     the nearest hourly is_day flag. Open-Meteo reports is_day per hour, so a
     naive nearest-hour read flips to night from 17:30 even though Kochi sunset
     is 18:18 — a starry sky in a bright evening. Falls back to the sampled flag
     if the day bounds are missing. */
  const hasBounds = f.sunriseMin < f.sunsetMin;
  const isDay = hasBounds
    ? m >= f.sunriseMin && m < f.sunsetMin
    : t < 0.5
      ? a.isDay
      : b.isDay;

  return {
    t: mix(a.t, b.t),
    hour: m / 60,
    tempC: mix(a.tempC, b.tempC),
    feelsC: mix(a.feelsC, b.feelsC),
    precipMm: mix(a.precipMm, b.precipMm),
    precipProb: mix(a.precipProb, b.precipProb),
    windKph: mix(a.windKph, b.windKph),
    gustKph: mix(a.gustKph, b.gustKph),
    cloudCover: mix(a.cloudCover, b.cloudCover),
    visibilityKm: mix(a.visibilityKm, b.visibilityKm),
    uvIndex: mix(a.uvIndex, b.uvIndex),
    thunderProb: mix(a.thunderProb, b.thunderProb),
    code: t < 0.5 ? a.code : b.code,
    isDay,
    /* Optional capability readings are carried across the interpolation too.
       Dropping them here meant anything reading the "now" sample lost humidity
       and soil moisture entirely, so the metric band reported them unavailable
       even when the provider had supplied them. */
    humidityPct: mixOpt(a.humidityPct, b.humidityPct, t),
    soilMoisture: mixOpt(a.soilMoisture, b.soilMoisture, t),
  };
}

/**
 * Interpolate an optional field, degrading honestly at the edges.
 *
 * When both endpoints carry the value it is interpolated. When only one does —
 * the far end of a series that has not started, or a source that populates only
 * some hours — that one is used, because reporting "unavailable" in the middle
 * of a stretch that clearly has data would be a worse lie than the nearest real
 * reading. When neither has it the result is undefined, which the UI renders as
 * an explicit absence rather than a zero.
 */
function mixOpt(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + (b - a) * t;
}

/* ========================================================== SEVERITY ===== */

/** Above this a routine event is considered disrupted. */
export const CONFLICT_THRESHOLD = 0.45;

const MODE_KEYS: Array<keyof ExposureVector> = ["precip", "wind", "heat"];
const ALL_KEYS: Array<keyof ExposureVector> = [
  "precip",
  "wind",
  "heat",
  "lowVis",
  "thunder",
];

/**
 * Severity of a sample for a specific person on a specific journey.
 *
 * Precipitation, wind and heat are scaled by how enclosed the transport is —
 * you get wet walking, not in a car. Reduced visibility and lightning are not
 * scaled: they are safety concerns regardless of how you are travelling.
 */
export function severityOf(
  s: HourSample,
  profile: DecisionProfile,
  mode: TravelMode,
): number {
  return severityWithEnclosure(s, profile, MODE_EXPOSURE[mode]);
}

/**
 * The same calculation, parameterised by how enclosed a person is rather than by
 * the mode that implies it.
 *
 * Focus windows are not travel modes — a farmer's twelve hours in a field and a
 * student walking to college are both fully exposed, but neither is one of the
 * four commute presets. Routing them through this function rather than a parallel
 * copy of the arithmetic is the point: a focus must never rate a hazard
 * differently from the routine path, or the same storm would get two verdicts
 * depending on which page the user was looking at.
 */
export function severityWithEnclosure(
  s: HourSample,
  profile: DecisionProfile,
  enclosure: number,
): number {
  const v = baseVector(s);

  // "How bad is this, for this person" per hazard.
  let maxEff = 0;
  let sum = 0;
  for (const k of ALL_KEYS) {
    const w = profile.sensitivity[k] * (MODE_KEYS.includes(k) ? enclosure : 1);
    const eff = v[k] * w;
    if (eff > maxEff) maxEff = eff;
    sum += eff;
  }

  // A person reacts to the worst condition present, not to the average of five
  // hazards that are mostly zero. So weight the maximum heavily and let the
  // mean contribute only a little, to break ties between similar peaks.
  return clamp(maxEff * 0.85 + (sum / ALL_KEYS.length) * 0.15);
}

/** Peak severity across an exposure window, sampled every 5 minutes. */
export function peakIn(
  f: NormalizedForecast,
  profile: DecisionProfile,
  startMin: number,
  travelMin: number,
  mode: TravelMode,
): { severity: number; atMin: number; sample: HourSample } {
  return peakWithEnclosure(f, profile, startMin, travelMin, MODE_EXPOSURE[mode]);
}

/** `peakIn` for any span of exposure, not just a journey. */
export function peakWithEnclosure(
  f: NormalizedForecast,
  profile: DecisionProfile,
  startMin: number,
  durationMin: number,
  enclosure: number,
): { severity: number; atMin: number; sample: HourSample } {
  let best = { severity: -1, atMin: startMin, sample: sampleAt(f, startMin) };
  const steps = Math.max(1, Math.round(durationMin / 5));
  for (let i = 0; i <= steps; i++) {
    const at = startMin + (durationMin * i) / steps;
    const s = sampleAt(f, at);
    const sev = severityWithEnclosure(s, profile, enclosure);
    if (sev > best.severity) best = { severity: sev, atMin: at, sample: s };
  }
  return best;
}

/* ========================================================= MITIGATION ==== */

export interface Mitigation {
  /** Minutes to shift departure. Negative = leave earlier. */
  shiftMin: number;
  departureMin: number;
  resultingPeak: number;
  /** Local minute the hazard is expected to have passed. */
  clearsAtMin: number;
}

/**
 * Find the nearest departure time that keeps severity below the threshold.
 *
 * Leaving earlier is always tried first: it is the least disruptive option and
 * it gets the journey done sooner, which is the safer default. Only if no
 * earlier window exists do we consider leaving later — which is the right
 * answer for hazards that clear with time, such as morning fog.
 */
export function findMitigation(
  f: NormalizedForecast,
  profile: DecisionProfile,
  startMin: number,
  travelMin: number,
  mode: TravelMode,
  target = CONFLICT_THRESHOLD * 0.75,
): Mitigation | null {
  const step = 5;
  const maxShift = 180;

  for (const dir of [-1, 1] as const) {
    for (let d = step; d <= maxShift; d += step) {
      const shift = d * dir;
      const dep = startMin + shift;
      const peak = peakIn(f, profile, dep, travelMin, mode);
      if (peak.severity <= target) {
        // Walk forward to find when the hazard actually ends.
        let clearsAt = dep + travelMin;
        for (let m = dep + travelMin; m < dep + travelMin + 360; m += step) {
          clearsAt = m;
          if (severityOf(sampleAt(f, m), profile, mode) > CONFLICT_THRESHOLD) break;
        }
        return {
          shiftMin: shift,
          departureMin: dep,
          resultingPeak: peak.severity,
          clearsAtMin: clearsAt,
        };
      }
    }
  }
  return null;
}

/* ========================================================== CONFIDENCE === */

export function confidenceFor(
  leadHours: number,
  overlapMin: number,
  profile: DecisionProfile,
  scenario: boolean,
): { overall: number; factors: ConfidenceFactor[] } {
  // 0-2h is highly reliable; confidence decays with lead time.
  const data = clamp(1 - Math.max(0, leadHours - 1) / 22);
  // Highest when the hazard sits right on the routine window.
  const time = clamp(1 - Math.abs(overlapMin) / 120);
  // We trust ourselves more when departure times are consistent.
  const completeness = clamp(0.55 + (profile.routine.length > 1 ? 0.2 : 0) + (scenario ? 0 : 0.15) - profile.varianceMin / 120);

  const factors: ConfidenceFactor[] = [
    {
      label: "Data freshness",
      value: data,
      detail: scenario
        ? "Simulated forecast — not live data"
        : leadHours < 1
          ? "Observed within the last hour"
          : `Forecast ${Math.round(leadHours)}h ahead`,
    },
    {
      label: "Timing match",
      value: time,
      detail:
        Math.abs(overlapMin) < 20
          ? "Hazard overlaps your journey directly"
          : `Hazard is ${Math.round(Math.abs(overlapMin))} min from your journey`,
    },
    {
      label: "Profile certainty",
      value: completeness,
      detail: `Your departure time varies by about ${profile.varianceMin} min`,
    },
  ];

  return { overall: data * time * completeness, factors };
}

/* ============================================================== WHY ======= */

/** The conditions that actually drove the severity score, most important first. */
/* "an auto", but "a car". The engine names the travel mode in user-facing
   sentences, so the article has to agree with it. */
function article(word: string): string {
  return "aeiou".includes(word[0]!.toLowerCase()) ? "an" : "a";
}

function conditionBullets(s: HourSample): string[] {
  const out: string[] = [];
  if (s.thunderProb > 0.3)
    out.push(`Lightning risk ${Math.round(s.thunderProb * 100)}% around this time`);
  if (s.precipProb > 0.25 || s.precipMm > 0.2) {
    const mm = s.precipMm >= 1 ? `${s.precipMm.toFixed(1)} mm/h` : "light rain";
    out.push(`${Math.round(s.precipProb * 100)}% chance of ${mm}`);
  }
  if (s.gustKph >= 30) out.push(`Wind gusting to ${Math.round(s.gustKph)} km/h`);
  if (s.visibilityKm < 4) out.push(`Visibility down to ${s.visibilityKm.toFixed(1)} km`);
  if (s.feelsC >= 35) out.push(`Feels like ${Math.round(s.feelsC)}° — heat stress`);
  if (s.feelsC <= 15) out.push(`Feels like ${Math.round(s.feelsC)}° — cold exposure`);
  if (out.length === 0) out.push(`${CODE_LABEL[s.code]}, no significant hazard`);
  return out;
}

export function severityBand(sev: number): Severity {
  if (sev >= 0.72) return "avoid";
  if (sev >= CONFLICT_THRESHOLD) return "caution";
  if (sev >= 0.22) return "note";
  return "calm";
}

/* =========================================================== ENGINE ====== */

export interface EngineInput {
  forecast: NormalizedForecast;
  profile: DecisionProfile;
  nowMin: number;
  /** True when the forecast is simulated rather than live. */
  scenario: boolean;
  /** Overrides the departure time of one routine event, for what-if. */
  overrideEventId?: string;
  overrideStartMin?: number;
}

export function runDecisionEngine(input: EngineInput): Decision[] {
  const { forecast: f, profile, nowMin, scenario } = input;
  const out: Decision[] = [];

  const events = profile.routine
    .map((e) =>
      input.overrideEventId === e.id && input.overrideStartMin !== undefined
        ? { ...e, startMin: input.overrideStartMin }
        : e,
    )
    /* Sorted chronologically. The profile stores routines in whatever order the
       user set them, and editing a time can reorder them, so every ordering
       decision below — including which event "tomorrow" refers to — has to be
       based on time, not array position. */
    .sort((a, b) => a.startMin - b.startMin);

  // Severe weather is detected first, because it overrides routine advice: we
  // should not tell someone to re-time their commute through a thunderstorm.
  // Only hours still ahead of us count — yesterday's leftovers in a 48-hour
  // feed must never raise a banner about today.
  const severe = findMostSevereHour(f, nowMin);
  const isSevere = severe.thunderProb > 0.5 || severe.gustKph > 58;

  // Only look at routine events that have not already finished today. Once
  // every routine for today has passed we still owe the user an answer, so we
  // fall back to the next routine rather than showing an empty homepage.
  const stillAhead = events.filter((e) => e.startMin + 60 > nowMin - 30);
  const upcoming = stillAhead.length > 0 ? stillAhead : events.slice(0, 1);
  const isTomorrow = stillAhead.length === 0;

  for (const e of upcoming) {
    const exposure = Math.max(10, effectiveExposure(e));
    const peak = peakIn(f, profile, e.startMin, exposure, e.mode);
    const band = severityBand(peak.severity);
    const leadHours = Math.max(0, (e.startMin - nowMin) / 60) + (isTomorrow ? 24 : 0);
    const confidence = confidenceFor(leadHours, 0, profile, scenario);

    /* Past the last routine of the day. The forecast does not reach tomorrow
       yet, so scoring it against today's hours would be a lie — the engine
       would report "tomorrow looks clear" from data it already knows is stale.
       Show the commitment honestly and let the refresh earn the verdict. */
    if (isTomorrow) {
      out.push({
        id: `tomorrow-${e.id}`,
        kind: "preview",
        eventId: e.id,
        severity: "note",
        title: `Tomorrow's ${e.label.toLowerCase()} starts at ${fmt(e.startMin)}`,
        detail:
          "Tonight is done, so Mausam has switched to tomorrow. It won't borrow today's numbers to call tomorrow — it refreshes overnight and the verdict is ready before you leave.",
        why: [
          { text: `You usually set out at ${fmt(e.startMin)}`, kind: "profile" },
          {
            text: `You spend about ${Math.round(exposure)} minutes outside on ${article(e.mode)} ${e.mode} journey`,
            kind: "profile",
          },
          { text: `Tonight itself: ${CODE_LABEL[sampleAt(f, nowMin).code].toLowerCase()}`, kind: "data" },
        ],
        confidence: { overall: Math.min(0.4, confidence.overall), factors: [] },
        atMin: e.startMin,
      });
      continue;
    }

    if (peak.severity < CONFLICT_THRESHOLD) {
      if (out.length === 0) {
        out.push({
          id: `clear-${e.id}`,
          kind: "all-clear",
          eventId: e.id,
          severity: "calm",
          title: `${e.label} looks clear`,
          detail: `Conditions stay comfortable for your ${Math.round(exposure)}-minute journey.`,
          why: [
            { text: conditionBullets(peak.sample)[0] ?? "No hazard expected", kind: "data" },
            { text: `You usually leave at ${fmt(e.startMin)}`, kind: "profile" },
          ],
          confidence,
          atMin: e.startMin,
        });
      }
      continue;
    }

    // Conflict.
    const mit = isSevere ? null : findMitigation(f, profile, e.startMin, exposure, e.mode);
    const bullets = conditionBullets(peak.sample);
    const why: WhyItem[] = [
      { text: `You usually leave at ${fmt(e.startMin)} (${e.label})`, kind: "profile" },
      { text: `You would be outside for about ${Math.round(exposure)} minutes`, kind: "profile" },
      { text: bullets[0] ?? "Conditions deteriorate during your journey", kind: "data" },
    ];
    if (bullets[1]) why.push({ text: bullets[1], kind: "data" });

    let action: string | undefined;
    let actionSub: string | undefined;
    if (isSevere) {
      action = "Severe weather is expected — follow the safety advisory above";
      actionSub = "Re-timing your journey is not advised while severe weather is in the area.";
      why.push({
        text: "Severe weather is forecast today, so no departure time is recommended as safe",
        kind: "action",
      });
    } else if (mit) {
      const earlier = mit.shiftMin < 0;
      const mag = Math.abs(mit.shiftMin);
      action = earlier
        ? `Consider leaving ${mag} min earlier, at ${fmt(mit.departureMin)}`
        : `Consider leaving ${mag} min later, at ${fmt(mit.departureMin)}`;
      actionSub = earlier
        ? `You would clear the worst of it before the rain builds.`
        : `You would travel once the worst of it has passed.`;
      why.push({
        text: `Conditions fall below your threshold if you leave at ${fmt(mit.departureMin)}`,
        kind: "action",
      });
    } else {
      action = "No clear window within 3 hours — plan for disrupted travel";
      why.push({
        text: "No departure time in the next 3 hours avoids the hazard",
        kind: "action",
      });
    }

    out.push({
      id: `conflict-${e.id}`,
      kind: "conflict",
      eventId: e.id,
      severity: band,
      // Lead with the time the user recognises — their routine — not the
      // numerically-latest peak minute, which is a detail, not a headline.
      title: `${e.label} around ${fmt(e.startMin)} may be affected`,
      detail: isTomorrow
        ? `Forecast for tomorrow: ${CODE_LABEL[peak.sample.code]} during your journey, peaking near ${fmt(peak.atMin)}.`
        : `${CODE_LABEL[peak.sample.code]} is forecast during your journey, peaking near ${fmt(peak.atMin)}.`,
      action,
      actionSub,
      why,
      confidence,
      atMin: e.startMin,
    });
  }

  if (isSevere) {
    out.unshift({
      id: "severe",
      kind: "severe",
      severity: "avoid",
      title: "Severe weather expected today",
      detail:
        severe.thunderProb > 0.5
          ? `Thunderstorm activity likely near ${fmt(severe.hour * 60)}.`
          : `Wind gusting to ${Math.round(severe.gustKph)} km/h near ${fmt(severe.hour * 60)}.`,
      action: "Avoid exposed areas and postpone travel if possible",      why: [
        {
          text:
            severe.thunderProb > 0.5
              ? `Lightning probability reaches ${Math.round(severe.thunderProb * 100)}%`
              : `Gusts reach ${Math.round(severe.gustKph)} km/h`,
          kind: "data",
        },
        { text: "Severe weather overrides all other recommendations", kind: "profile" },
      ],
      confidence: { overall: 0.72, factors: [] },
      atMin: severe.hour * 60,
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

const SEVERITY_ORDER: Record<Severity, number> = {
  avoid: 3,
  caution: 2,
  note: 1,
  calm: 0,
};

/** The worst hour still ahead of us, within the next 18 hours. */
function findMostSevereHour(f: NormalizedForecast, nowMin: number): HourSample {
  const nowH = nowMin / 60;
  const upcoming = f.hourly.filter((h) => h.hour >= nowH && h.hour <= nowH + 18);
  const pool = upcoming.length > 0 ? upcoming : f.hourly;
  return pool.reduce((a, b) => {
    const sa = a.thunderProb * 2 + a.gustKph / 100;
    const sb = b.thunderProb * 2 + b.gustKph / 100;
    return sb > sa ? b : a;
  }, pool[0]!);
}

function fmt(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = m / 60;
  const hh = Math.floor(h);
  const mm = m % 60;
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}
