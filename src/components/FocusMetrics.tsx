import { ChevronRight } from "lucide-react";
import type { MetricId } from "../domain/capabilities";
import {
  CAPABILITIES,
  UNAVAILABLE,
  formatHumidity,
  formatSoilMoisture,
  formatUv,
} from "../domain/capabilities";
import { sampleAt, localMinToEpoch } from "../domain/decision";
import type { NormalizedForecast } from "../domain/weather";
import type { AirQuality } from "../data/airquality";
import { describeAqi } from "../domain/capabilities";

/* The "relevant information" band.

   This is the part of the personalization that is easiest to get wrong and
   hardest to notice when you do. The temptation is to fill it out so the page
   looks complete, which means reaching for a metric the provider did not send.
   Every row here therefore has exactly three states: a real value, an explicit
   "Unavailable", or not being rendered. There is no fourth state, and in
   particular a missing reading never becomes a zero — "Humidity 0%" is a claim
   about the air, and the app has no basis for making it. */

const ROW_ORDER: MetricId[] = [
  "precipAccumulation",
  "precipProbability",
  "precipitation",
  "temperature",
  "apparentTemperature",
  "humidity",
  "uv",
  "wind",
  "gusts",
  "visibility",
  "thunder",
  "soilMoisture",
  "aqi",
];

export interface FocusMetricsProps {
  forecast: NormalizedForecast | null;
  nowMin: number;
  /** Metrics the headline reading quoted. Shown inline with it. */
  inline: readonly MetricId[];
  /** Selected metrics the headline did not use. Folded away by default. */
  more?: readonly MetricId[];
  /** Window to summarize over, in minutes. Defaults to the next 6 hours. */
  windowMin?: number;
  /** Optional parallel capability. Absent or failed means no AQI row at all. */
  air?: AirQuality;
}

/**
 * The numbers, in two registers.
 *
 * The band used to be one flat table of up to six rows that ran from y=640 to
 * y=853 on a 390×844 screen — past the fold, on a page whose only job is to be
 * read at a glance. So the figures the winning sentence actually stands on are
 * now inline, where a reader can check the claim without scrolling, and
 * everything else is folded under a summary the reader chooses to open.
 *
 * The honesty rules are unchanged by that: three states per metric, a real value
 * or an explicit "Unavailable" or nothing rendered, and never a zero standing in
 * for a reading that was not sent.
 */
export function FocusMetrics({
  forecast,
  nowMin,
  inline,
  more = [],
  windowMin = 6 * 60,
  air,
}: FocusMetricsProps) {
  if (!forecast) return null;
  if (inline.length === 0 && more.length === 0 && !air) return null;

  const inlineIds = ROW_ORDER.filter((m) => inline.includes(m));
  /* AQI belongs in the folded section. It comes from a different source with its
     own failure mode, so it should not sit inline beside forecast numbers
     implying they came from the same place and the same moment. */
  const moreIds = ROW_ORDER.filter((m) => more.includes(m) || (m === "aqi" && air?.status === "ready"));

  if (inlineIds.length === 0 && moreIds.length === 0) return null;

  return (
    <div data-testid="focus-metrics">
      {inlineIds.length > 0 && (
        <ul
          className="flex flex-wrap gap-1.5"
          data-testid="focus-metrics-inline"
          aria-label="Measurements behind this reading"
        >
          {inlineIds.map((m) => (
            <li key={m}>
              <InlineMetric
                id={m}
                forecast={forecast}
                nowMin={nowMin}
                windowMin={windowMin}
                air={air}
              />
            </li>
          ))}
        </ul>
      )}

      {moreIds.length > 0 && (
        <details className="group" data-testid="focus-metrics-more">
          <summary className="flex min-h-[36px] cursor-pointer list-none items-center gap-1 text-[12.5px] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-soft)]">
            <ChevronRight
              size={13}
              className="transition-transform group-open:rotate-90"
            />
            All measurements
            <span className="text-[var(--ink-faint)]/70">({moreIds.length})</span>
          </summary>
          <div className="mt-1 rounded-[18px] bg-white/[0.05] p-3.5">
            {moreIds.map((m) => (
              <MetricRow
                key={m}
                id={m}
                forecast={forecast}
                nowMin={nowMin}
                windowMin={windowMin}
                air={air}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * A figure shown as a figure, not as a table row.
 *
 * Label above, value below. The value is the thing the reader is looking for, and
 * in a horizontal row a 390px-wide screen forces one of the two to be truncated.
 */
function InlineMetric({
  id,
  forecast,
  nowMin,
  windowMin,
  air,
}: {
  id: MetricId;
  forecast: NormalizedForecast;
  nowMin: number;
  windowMin: number;
  air?: AirQuality;
}) {
  const cap = CAPABILITIES[id];
  const value = readValue(id, forecast, nowMin, windowMin, air);

  return (
    <div
      className="rounded-[14px] bg-white/[0.05] px-2.5 py-1.5"
      data-metric={id}
      data-available={value.text === UNAVAILABLE ? "false" : "true"}
    >
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
        {cap.label}
        {cap.measured === false && cap.caveat ? "·model" : null}
      </p>
      <p
        className="mt-0.5 text-[15px] font-semibold leading-tight tabular-nums"
        title={cap.caveat}
      >
        {value.text}
        {value.suffix ? (
          <span className="ml-1 text-[10.5px] font-normal text-[var(--ink-faint)]">
            {value.suffix}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function MetricRow({
  id,
  forecast,
  nowMin,
  windowMin,
  air,
}: {
  id: MetricId;
  forecast: NormalizedForecast;
  nowMin: number;
  windowMin: number;
  air?: AirQuality;
}) {
  const cap = CAPABILITIES[id];
  const value = readValue(id, forecast, nowMin, windowMin, air);

  return (
    <div
      className="flex items-baseline justify-between gap-3 py-1.5"
      data-metric={id}
      data-available={value.text === UNAVAILABLE ? "false" : "true"}
    >
      <span className="text-[12.5px] text-[var(--ink-soft)]">
        {cap.label}
        {cap.measured === false && cap.caveat ? (
          <span className="ml-1 text-[10.5px] text-[var(--ink-faint)]">· model</span>
        ) : null}
      </span>
      <span
        className="shrink-0 text-[12.5px] font-medium tabular-nums"
        title={cap.caveat}
      >
        {value.text}
        {value.suffix ? <span className="ml-1 text-[var(--ink-faint)]">{value.suffix}</span> : null}
      </span>
    </div>
  );
}

interface Cell {
  text: string;
  suffix?: string;
}

const MISSING: Cell = { text: UNAVAILABLE };

function readValue(
  id: MetricId,
  f: NormalizedForecast,
  nowMin: number,
  windowMin: number,
  air?: AirQuality,
): Cell {
  const from = localMinToEpoch(f, nowMin);
  const to = localMinToEpoch(f, nowMin + windowMin);
  const win = f.hourly.filter((h) => h.t >= from && h.t <= to);
  const now = sampleAt(f, nowMin);

  const maxOf = (pick: (s: (typeof win)[number]) => number | undefined): number | undefined => {
    let best: number | undefined;
    for (const s of win) {
      const v = pick(s);
      if (typeof v === "number" && Number.isFinite(v) && (best === undefined || v > best)) best = v;
    }
    return best;
  };

  switch (id) {
    case "temperature": {
      const t = maxOf((s) => s.tempC);
      return t === undefined ? MISSING : { text: `${Math.round(t)}°` };
    }
    case "apparentTemperature": {
      const t = maxOf((s) => s.feelsC);
      return t === undefined ? MISSING : { text: `${Math.round(t)}°` };
    }
    case "precipitation": {
      const mm = maxOf((s) => s.precipMm);
      return mm === undefined || mm <= 0 ? { text: "None" } : { text: `${mm.toFixed(1)} mm/h` };
    }
    case "precipAccumulation": {
      if (win.length === 0) return MISSING;
      const total = win.reduce((sum, h) => sum + (h.precipMm || 0), 0);
      return { text: `${total.toFixed(1)} mm` };
    }
    case "precipProbability": {
      const p = maxOf((s) => s.precipProb);
      return p === undefined ? MISSING : { text: `${Math.round(p * 100)}%` };
    }
    case "humidity": {
      const h = formatHumidity(now);
      return h ? { text: h } : MISSING;
    }
    case "uv": {
      const uv = formatUv(now);
      return uv ? { text: uv } : MISSING;
    }
    case "wind": {
      const w = maxOf((s) => s.windKph);
      return w === undefined ? MISSING : { text: `${Math.round(w)} km/h` };
    }
    case "gusts": {
      const g = maxOf((s) => s.gustKph);
      return g === undefined ? MISSING : { text: `${Math.round(g)} km/h` };
    }
    case "visibility": {
      const v = win
        .map((s) => s.visibilityKm)
        .filter((x) => Number.isFinite(x))
        .sort((a, b) => a - b)[0];
      return v === undefined ? MISSING : { text: `${v.toFixed(1)} km` };
    }
    case "thunder": {
      const t = maxOf((s) => s.thunderProb);
      return t === undefined ? MISSING : { text: `${Math.round(t * 100)}%` };
    }
    case "soilMoisture": {
      const sm = formatSoilMoisture(now);
      return sm ? { text: sm } : MISSING;
    }
    case "aqi": {
      // AQI is the one row that may come from outside the forecast entirely.
      if (!air || air.status !== "ready") return MISSING;
      const a = air.usAqiAt(nowMin);
      if (a === null) return MISSING;
      return { text: String(Math.round(a)), suffix: describeAqi(a).label };
    }
  }
}
