import type { Decision } from "./decision";
import type { FocusContext, FocusId } from "./focus";
import type { MetricId } from "./capabilities";
import { isSupported, isWeatherBacked } from "./capabilities";

/* ================================================================= ORDERING ==

   Combining focuses says what the user cares about. It does not say what to
   show, because "what the user cares about" and "the single most useful line on
   a small screen" are different questions. Every focus selection produces more
   candidate readings than a phone screen has room for, so something has to give.

   The rules here, in order:

     1. Severe weather is not negotiable and is not a matter of focus. A
        thunderstorm gets the top slot for everyone, which is exactly the
        property that makes the rest of the personalization safe to do at all.
     2. A real, upcoming routine commitment outranks an equally-severe focus
        reading. We do not hide a user's actual train in favour of a
        generalized window just because they selected a different focus.
     3. Otherwise the highest-ranked focus wins, and within that, the most
        severe reading wins.
     4. Ties break toward whatever is happening sooner, because a finding about
        the next twenty minutes is actionable in a way that one about tomorrow
        is not.
     5. One all-clear is kept, at most, and only when nothing else earned a
        slot — silence is not reassurance. */

/** Caps the secondary list so the page stays a page and not a log. */
const MAX_SECONDARY = 3;

/** Same reasoning for the metric band — a table is not a summary. */
const MAX_METRICS = 6;

/**
 * How many measurements sit inline with the headline.
 *
 * Inline means "the numbers this reading is standing on" — a farmer seeing
 * 10.9 mm under a headline about 10.9 mm can check the claim without a tap.
 * Everything past that cap is a measurement the focus asked for but the winning
 * sentence did not use, which is genuinely secondary and belongs folded away.
 */
const MAX_INLINE = 3;

const SEVERE_RANK = 1_000_000;
const FOCUS_BASE = 500_000;
const ROUTINE_BASE = 400_000;
const ALLCLEAR_BASE = 100_000;

/** A focus the user ranked highly outranks one they merely also selected. */
function focusBonus(ctx: FocusContext, id: FocusId | undefined): number {
  if (!id) return 0;
  const f = ctx.focuses.find((x) => x.id === id);
  return f ? f.rank * 1_000 : 0;
}

const SEVERITY_SCORE: Record<string, number> = { avoid: 4, caution: 3, note: 2, calm: 1 };

function score(d: Decision, ctx: FocusContext, nowMin: number): number {
  if (d.kind === "severe") return SEVERE_RANK;
  const sev = (SEVERITY_SCORE[d.severity] ?? 1) * 10_000;

  if (d.kind === "all-clear") return ALLCLEAR_BASE + sev;

  // Upcoming beats elapsed. A window that has already passed is history, and
  // history on the homepage is a bug, not a summary.
  const leadMin = d.atMin - nowMin;
  const soonest = leadMin <= 0 ? 5_000 : Math.max(0, 5_000 - leadMin);

  if (d.focusId) return FOCUS_BASE + focusBonus(ctx, d.focusId) + sev + soonest;
  return ROUTINE_BASE + sev + soonest;
}

export interface PrioritizeInput {
  /** Every candidate: severe, routine and focus readings. */
  decisions: readonly Decision[];
  ctx: FocusContext;
  nowMin: number;
}

export interface Insights {
  /** Weather-level finding, if any. Rendered above everything else. */
  severe: Decision | null;
  /** The single focus-aware headline. */
  headline: Decision | null;
  /**
   * The remaining readings about the user's focuses, in order.
   *
   * Kept apart from the routine lane because they answer a different question
   * and are trusted differently: "because you chose Agriculture" is a lens the
   * user set, whereas a routine event is a commitment they already made. Mixing
   * them under one "Also today" heading is what let a commute finding show up
   * under a heading that implied the user had asked about their commute.
   */
  secondaryFocus: Decision[];
  /** The remaining readings from the user's routine, in order. */
  secondaryRoutine: Decision[];
  /** Which focus won the headline, so the UI can attribute it. */
  primaryFocus: FocusId | null;
  /** Measurements the headline itself quoted. Shown inline with it. */
  inlineMetrics: MetricId[];
  /** The selected measurements it did not use. Folded below the fold. */
  moreMetrics: MetricId[];
  /**
   * Every selected measurement, inline first. Air-quality metrics are
   * deliberately excluded: they arrive from the parallel AQI capability and are
   * only ever added when a real value exists.
   */
  metrics: MetricId[];
}

export function prioritize(input: PrioritizeInput): Insights {
  const { decisions, ctx, nowMin } = input;

  const severe = decisions.find((d) => d.kind === "severe") ?? null;
  const rest = decisions
    .filter((d) => d.id !== severe?.id)
    .filter((d) => d.atMin >= nowMin - 30)
    .sort((a, b) => score(b, ctx, nowMin) - score(a, ctx, nowMin));

  const actionable = rest.filter((d) => d.kind !== "all-clear");
  const allClears = rest.filter((d) => d.kind === "all-clear");

  const headline = actionable[0] ?? allClears[0] ?? null;

  const secondary: Decision[] = actionable.slice(1, 1 + MAX_SECONDARY);

  /* One all-clear is worth keeping — "nothing much coming" is an answer, and a
     page of conflicts with no baseline leaves the user unable to tell a quiet
     day from a missed fetch.

     When nothing was actionable, the all-clears *are* the content, so the
     remaining ones fill the list instead of the headline being echoed back
     underneath itself. Deduplicating by id is what keeps a settled day from
     rendering the same sentence twice. */
  if (headline?.kind === "all-clear") {
    for (const c of allClears) {
      if (c.id === headline.id) continue;
      if (secondary.length >= MAX_SECONDARY) break;
      secondary.push(c);
    }
  }

  const visible = [headline, ...secondary].filter((d): d is Decision => d !== null);
  const { inline, more } = splitMetrics(visible, headline, ctx);

  /* The lanes are a split, not a filter. Every remaining reading lands in exactly
     one of them, so a decision cannot vanish by being in neither — the failure
     mode a `focusId ? focus : routine` ternary cannot have but a
     `.filter()` on each side can. */
  const secondaryFocus = secondary.filter((d) => d.focusId !== undefined);
  const secondaryRoutine = secondary.filter((d) => d.focusId === undefined);

  return {
    severe,
    headline,
    secondaryFocus,
    secondaryRoutine,
    primaryFocus: headline?.focusId ?? null,
    inlineMetrics: inline,
    moreMetrics: more,
    metrics: [...inline, ...more],
  };
}

/**
 * Split the selected measurements into the ones the headline stands on and the
 * ones it does not.
 *
 * Selection itself is unchanged from `visibleMetrics` — the same focus-ranked
 * set, capped the same way, with anything a visible reading quoted promoted to
 * the front. Only the presentation boundary is new, and it is drawn at the
 * headline rather than at the band, so the inline figures are exactly the ones a
 * reader can use to check the sentence above them.
 */
function splitMetrics(
  visible: readonly Decision[],
  headline: Decision | null,
  ctx: FocusContext,
): { inline: MetricId[]; more: MetricId[] } {
  const ordered = visibleMetrics(visible, ctx);
  const quoted = new Set<MetricId>(headline?.metrics ?? []);
  const inline = ordered.filter((m) => quoted.has(m)).slice(0, MAX_INLINE);
  const shown = new Set(inline);
  return { inline, more: ordered.filter((m) => !shown.has(m)) };
}

/**
 * The metrics worth showing.
 *
 * Taken from what the selected focuses use, with anything a visible reading
 * quoted promoted to the front. Deriving it from the focus context rather than
 * from the winners alone is deliberate: on a settled day the winning decision is
 * often a routine all-clear that quotes no numbers at all, and a metrics band
 * that empties itself the moment the weather calms down is worse than useless.
 * It also makes the band stable — a user who chose Health sees humidity and UV
 * on a sunny afternoon and on a wet one, rather than watching the rows appear
 * and vanish with the forecast.
 *
 * Unavailable and non-weather metrics are filtered out here so no downstream
 * code has to remember to check; the row component still renders a genuine
 * "Unavailable" for a metric the provider declined to send.
 */
function visibleMetrics(decisions: readonly Decision[], ctx: FocusContext): MetricId[] {
  const quoted = new Set<MetricId>();
  for (const d of decisions) {
    for (const m of d.metrics ?? []) {
      if (isSupported(m) && isWeatherBacked(m)) quoted.add(m);
    }
  }

  // Ordered by the focus that cares most, so Health's UV outranks Commute's.
  const wanted: MetricId[] = [];
  const seen = new Set<MetricId>();
  for (const focus of [...ctx.focuses].sort((a, b) => b.rank - a.rank)) {
    for (const m of focus.needs) {
      if (seen.has(m) || !isSupported(m) || !isWeatherBacked(m)) continue;
      seen.add(m);
      wanted.push(m);
    }
  }

  /* Select first, then reorder. Trimming after promotion let a quoted metric
     evict a different one, so the band changed which rows it showed from hour
     to hour — membership is now fixed by focus rank, and promotion only decides
     the order of a set that was already chosen. */
  const chosen = wanted.slice(0, MAX_METRICS);
  return [...chosen.filter((m) => quoted.has(m)), ...chosen.filter((m) => !quoted.has(m))];
}
