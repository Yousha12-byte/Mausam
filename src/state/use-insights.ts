import { useMemo } from "react";
import { useWeather } from "./weather-store";
import { useProfile } from "./profile-store";
import { useFocus } from "./focus-store";
import { buildInsights, type BuildInsightsResult } from "../domain/insights";
import { emptyContext } from "../domain/focus";

/* The homepage's read of the weather, filtered through what the user cares about.

   This lives outside the weather store on purpose. The store's job is to hold
   weather and guarantee how it is obtained; focus is a reading of that weather,
   not a property of it, and putting a `useInsights` next to `useDecisions`
   inside the store would imply otherwise. The weather store is not modified. */

const EMPTY: BuildInsightsResult = {
  severe: null,
  headline: null,
  secondaryFocus: [],
  secondaryRoutine: [],
  primaryFocus: null,
  inlineMetrics: [],
  moreMetrics: [],
  metrics: [],
  ctx: emptyContext(),
  candidates: [],
};

export function useInsights(): BuildInsightsResult {
  const forecast = useWeather((s) => s.forecast);
  const nowMin = useWeather((s) => s.nowMin);
  const scenarioId = useWeather((s) => s.scenarioId);
  const whatIf = useWeather((s) => s.whatIf);
  const profile = useProfile((s) => s.profile);
  const focusIds = useFocus((s) => s.selected);

  /* The ids are a fresh array on every toggle, so keying on its contents keeps
     the engine from re-running on unrelated renders. */
  const key = focusIds.join(",");

  return useMemo(() => {
    if (!forecast) return EMPTY;
    return buildInsights({
      forecast,
      profile,
      nowMin,
      scenario: scenarioId !== null,
      focusIds: key.split(",").filter(Boolean) as typeof focusIds,
      overrideEventId: whatIf?.eventId,
      overrideStartMin: whatIf?.startMin,
    });
    // `key` stands in for focusIds; the array identity changes every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecast, profile, nowMin, scenarioId, whatIf, key]);
}
