import type { HourSample, NormalizedForecast, WeatherState } from "../domain/weather";
import { sampleAt } from "../domain/decision";
import { formatClock } from "./utils";

/**
 * One line for the bottom of the homepage.
 *
 * This is deliberately not a card and deliberately not another decision. The
 * page already spends its authority on the things the user has to act on; this
 * is the quieter half of the same forecast — what the sky is about to do next.
 * It exists so the page reads as composed to the bottom of the viewport instead
 * of stopping mid-way and leaving the rest to the background.
 *
 * Every line is derived from the forecast rather than written per state, so it
 * cannot claim something the data does not say. When there is no honest thing to
 * say, `continuation` returns null and the region collapses to atmosphere.
 */

export interface Continuation {
  /** Quiet uppercase label, matching the other section labels on the page. */
  label: string;
  /** The single sentence. Never more than one. */
  line: string;
}

/** How far ahead the line is allowed to look. */
const HORIZON_H = 18;

function ahead(forecast: NormalizedForecast, nowMin: number, n: number): HourSample[] {
  const startH = Math.floor(nowMin / 60);
  const out: HourSample[] = [];
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = sampleAt(forecast, (startH + i) * 60);
    // The series has to actually cover this hour. Past its end the sample stops
    // advancing, and continuing would restate the final hour as if it were
    // hours still to come.
    if (s.t <= prev) break;
    prev = s.t;
    out.push(s);
  }
  return out;
}

const at = (h: HourSample) => h.hour * 60;

/** "2–4 PM" for a span, or "around 4 PM" for a single hour. */
function period(hours: HourSample[]): string {
  const first = hours[0]!;
  const last = hours[hours.length - 1]!;
  // Spans that cross noon or midnight read as a clock range, not "11 AM–1 AM".
  if (hours.length === 1) return `around ${formatClock(at(first))}`;
  return `${formatClock(at(first))}–${formatClock(at(last))}`;
}

/** The contiguous run of hours at the top of the range, within `within` of `peak`. */
function peakRun(hours: HourSample[], value: (h: HourSample) => number, within: number): HourSample[] {
  const peak = Math.max(...hours.map(value));
  let best: HourSample[] = [];
  let run: HourSample[] = [];
  for (const h of hours) {
    if (value(h) >= peak - within) {
      run.push(h);
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  return best;
}

/** First index at/after `from` where `ok` holds, or -1. */
function firstIndex(hours: HourSample[], from: number, ok: (h: HourSample) => boolean): number {
  for (let i = from; i < hours.length; i++) if (ok(hours[i]!)) return i;
  return -1;
}

export function continuation(
  forecast: NormalizedForecast,
  nowMin: number,
  state: WeatherState,
): Continuation | null {
  const now = sampleAt(forecast, nowMin);
  const h = ahead(forecast, nowMin, HORIZON_H);

  switch (state) {
    /* The warmest stretch is the one fact a bright day is actually about. */
    case "sunny": {
      const run = peakRun(h, (x) => x.tempC, 1.5);
      if (run.length === 0) return null;
      const warming = run[0]!.hour * 60 >= nowMin;
      return {
        label: "Looking ahead",
        line: warming ? `Warmest ${period(run)}` : `Holds warm near ${period(run)}`,
      };
    }

    /* Cloud is a trend, so the line names the direction and the hour it turns. */
    case "cloudy": {
      const cur = now.cloudCover;
      const build = firstIndex(h, 1, (x) => x.cloudCover >= Math.max(0.62, cur + 0.22));
      const thin = firstIndex(h, 1, (x) => x.cloudCover <= Math.min(0.3, cur - 0.22));
      if (build >= 0) {
        return { label: "Looking ahead", line: `Cloud cover building after ${formatClock(at(h[build]!))}` };
      }
      if (thin >= 0) {
        return { label: "Looking ahead", line: `Cloud thinning after ${formatClock(at(h[thin]!))}` };
      }
      return { label: "Looking ahead", line: "Cloud holding steady through the evening" };
    }

    /* Rain: the useful fact is when it lets up, not that it is falling. */
    case "rain": {
      const dry = firstIndex(h, 1, (x) => x.precipProb < 0.2 && x.precipMm < 0.15);
      if (dry >= 0) {
        return { label: "Looking ahead", line: `Rain eases around ${formatClock(at(h[dry]!))}` };
      }
      return { label: "Looking ahead", line: "Rain holding on through the evening" };
    }

    case "thunderstorm": {
      const calm = firstIndex(h, 1, (x) => x.thunderProb < 0.12);
      if (calm >= 0) {
        return { label: "Looking ahead", line: `Thunder easing after ${formatClock(at(h[calm]!))}` };
      }
      return { label: "Looking ahead", line: "Storms holding on through the evening" };
    }

    /* Fog is almost always a morning problem, so the line is about clearing. */
    case "fog": {
      const clear = firstIndex(h, 1, (x) => x.visibilityKm >= 8);
      if (clear >= 0) {
        return { label: "Looking ahead", line: `Visibility improving around ${formatClock(at(h[clear]!))}` };
      }
      return { label: "Looking ahead", line: "Visibility may stay reduced all night" };
    }

    /* Night asks a single question about the hours that are left. */
    case "night": {
      const rest = h.filter((x) => x.t > now.t);
      if (rest.length === 0) return null;
      const cloud = rest.reduce((s, x) => s + x.cloudCover, 0) / rest.length;
      if (cloud < 0.28) {
        return { label: "Overnight", line: "Clear skies hold until sunrise" };
      }
      if (cloud < 0.62) {
        return { label: "Overnight", line: "Broken cloud through the night" };
      }
      return { label: "Overnight", line: "Cloud thickening towards morning" };
    }

    default:
      return null;
  }
}
