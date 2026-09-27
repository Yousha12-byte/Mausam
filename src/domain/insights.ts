import { runDecisionEngine, type Decision } from "./decision";
import { combineFocuses, type FocusContext, type FocusId } from "./focus";
import { runFocusDecisions } from "./focus-decisions";
import { prioritize, type Insights } from "./prioritize";
import { activeEvents, scopeProfile, type UserProfile } from "./routine";
import type { NormalizedForecast } from "./weather";

/* The single place focus enters the app.

   focuses → combined context → candidate decisions → prioritize() → headline

   Note what is *not* here: no branch that behaves differently when focus is
   empty. An empty selection still produces a valid `FocusContext` (defaulted to
   Daily life) and a full set of candidates, so there is no "personalization
   path" that can rot relative to the "normal" path — the path a user gets by
   skipping onboarding is the same code, run with a default, which is why
   skipping is a real feature rather than a degraded mode.

   `runDecisionEngine` itself is untouched and is called exactly as before.
   Focus reads the weather through the same forecast the routine path reads, so
   the two can never disagree about what the weather is. */

export interface BuildInsightsInput {
  forecast: NormalizedForecast;
  profile: UserProfile;
  nowMin: number;
  /** True when the forecast is simulated rather than live. */
  scenario: boolean;
  focusIds: readonly FocusId[];
  overrideEventId?: string;
  overrideStartMin?: number;
}

export interface BuildInsightsResult extends Insights {
  ctx: FocusContext;
  /** All candidates, severe and otherwise, before prioritization. */
  candidates: Decision[];
}

export function buildInsights(input: BuildInsightsInput): BuildInsightsResult {
  const ctx = combineFocuses(input.focusIds, input.forecast, input.nowMin, input.profile.schedules);

  /* The engine is scored against the selected focuses' own windows and nothing
     else. This one argument is the whole of the cross-focus fix: a window filed
     under Commute is not in the list the engine sees when Agriculture is the
     active focus, so it cannot produce a reading, however severe the weather.
     Every severity number below is computed by the same unchanged engine from
     the same forecast — only the set of windows differs. */
  const scoped = scopeProfile(input.profile, ctx.ids);
  const windows = activeEvents(input.profile, ctx.ids);
  const owner = new Map(windows.map((e) => [e.id, e.focusId]));

  const routine = runDecisionEngine({
    forecast: input.forecast,
    profile: scoped,
    nowMin: input.nowMin,
    scenario: input.scenario,
    overrideEventId: input.overrideEventId,
    overrideStartMin: input.overrideStartMin,
  });

  const focus = runFocusDecisions({
    forecast: input.forecast,
    profile: input.profile,
    nowMin: input.nowMin,
    scenario: input.scenario,
    ctx,
  });

  /* A window-derived reading belongs to the focus that owns the window, so
     "College to home" is labelled Commute and "Field work" is labelled
     Agriculture — read off the window itself rather than assumed, which is what
     let every window claim to be a commute. With no focus selected the engine's
     decisions are left exactly as produced. */
  const attributed = ctx.ids.length
    ? routine.map((d) => {
        const focusId = d.eventId ? owner.get(d.eventId) : undefined;
        return focusId ? { ...d, focusId } : d;
      })
    : routine;

  const candidates = [...attributed, ...focus];
  const ranked = prioritize({ decisions: candidates, ctx, nowMin: input.nowMin });

  return { ...ranked, ctx, candidates };
}
