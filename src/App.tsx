import { useEffect, useRef, useState } from "react";
import { MapPin, Settings2, SlidersHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { bindLocation, useWeather } from "./state/weather-store";
import { useProfile } from "./state/profile-store";
import { useAirQuality } from "./state/airquality-store";
import { useInsights } from "./state/use-insights";
import { useFocus } from "./state/focus-store";
import { useSettings } from "./state/settings-store";
import { useLocation } from "./state/location-store";
import { effectiveLocation, formatPlace } from "./domain/location";
import { FOCUS_BY_ID, type FocusId } from "./domain/focus";
import { formatClock } from "./lib/utils";
import { HeroCard, WindowStrip } from "./components/HeroCard";
import { AtmosphereContinuation } from "./components/AtmosphereContinuation";
import { Insight } from "./components/Insight";
import { DecisionList } from "./components/DecisionList";
import { IconButton } from "./components/ui";
import { ProfileSheet } from "./components/ProfileSheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { LocationPicker } from "./components/LocationPicker";
import { DataSourceNote } from "./components/DataSourceNote";
import { WeatherDebugPanel } from "./components/WeatherDebugPanel";
import { WhatIfSheet } from "./components/WhatIfSheet";
import { Onboarding } from "./components/Onboarding";
import { FocusMetrics } from "./components/FocusMetrics";
import { FocusAttribution } from "./components/FocusAttribution";
import { FocusChips } from "./components/FocusChips";
import { AtmosphereLayer } from "./atmosphere/AtmosphereLayer";
import { useAtmosphere } from "./atmosphere/useAtmosphere";
import { useAmbience } from "./atmosphere/useAmbience";
import { currentState } from "./state/weather-store";

/**
 * The focus a lane is actually about.
 *
 * Taken from the lane's own readings rather than from whichever focus won the
 * headline, so the heading cannot describe one lens while listing another's. With
 * several focuses selected the lane genuinely spans them, and naming the first is
 * the honest short form.
 */
function laneFocusLabel(decisions: readonly { focusId?: FocusId }[]): string {
  const id = decisions.find((d) => d.focusId)?.focusId;
  return id ? (FOCUS_BY_ID[id]?.short ?? id) : "you";
}

export default function App() {
  const profile = useProfile((s) => s.profile);
  const load = useWeather((s) => s.load);
  const forecast = useWeather((s) => s.forecast);
  const loading = useWeather((s) => s.loading);
  const nowMin = useWeather((s) => s.nowMin);
  const whatIf = useWeather((s) => s.whatIf);
  const clearWhatIf = useWeather((s) => s.clearWhatIf);

  const sound = useSettings((s) => s.sound);
  const toggleSoundPref = useSettings((s) => s.toggleSound);
  const motion = useSettings((s) => s.motion);
  const hydrate = useSettings((s) => s.hydrate);

  const [profileOpen, setProfileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [whatIfEvent, setWhatIfEvent] = useState<string | null>(null);

  const hydrateLocation = useLocation((s) => s.hydrate);
  const realPlace = useLocation((s) => s.place);
  const scenarioId = useWeather((s) => s.scenarioId);

  /* A pinned demo scenario is shown against Kochi so the presentation is the
     same on every machine. It never overwrites the user's real location, and
     the two are labelled differently in the header so nobody mistakes a demo
     for their own sky. */
  const isDemo = scenarioId !== null;
  const place = effectiveLocation(realPlace, scenarioId);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => hydrate(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    hydrateLocation();
    // Load once on mount; profile edits re-run the engine in memory, not the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The installed-app shortcut points here, so honour it instead of ignoring it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sheet") === "routine") {
      setProfileOpen(true);
    }
  }, []);

  // Keep the weather store's notion of place in sync, and refetch when it moves.
  useEffect(() => {
    /* Bind the *real* place, not the effective one. While a demo is pinned the
       effective place is Kochi, and binding that meant leaving the demo started
       a live request for Kochi before the effect below corrected it — two
       competing fetches for two different cities. The store needs the real
       place so that returning to live targets the user's own sky immediately. */
    bindLocation(realPlace ?? place);
    void load(place, isDemo ? scenarioId : null);
  }, [place, realPlace, isDemo, scenarioId, load]);

  /* One read of the weather, filtered through what the user cares about. This
     replaces the previous "first conflict wins" search: the same forecast now
     yields different candidates, and different winners, depending on focus —
     while severe weather still leads for everyone. */
  const insights = useInsights();
  const { severe, headline, secondaryFocus, secondaryRoutine, inlineMetrics, moreMetrics, ctx } =
    insights;

  const selectedFocus = useFocus((s) => s.selected);

  /* Changing the lens changes how long the page is, and the scroller keeps
     whatever offset it had. Left alone, switching from a long reading to a short
     one while scrolled down leaves the new headline's top *above* the scroll
     viewport — the sentence appeared with its first line missing, with the
     attribution line gone entirely, and no way to tell that anything was off the
     top. Scroll anchoring compensates for the height change, which is why it
     looked like a layout bug rather than a retained scroll offset.

     Rewinding is also the right behaviour on its own terms: a different lens is
     a different answer, and the answer is what you came to read. */
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [selectedFocus.join(",")]);
  const toggleFocus = useFocus((s) => s.toggle);
  useAtmosphere(forecast, nowMin);

  /* Air quality is a parallel capability with its own lifecycle. It is fetched
     for the *real* place and only outside demo mode — a demo must stay a fixed,
     network-free scenario, and there is no honest way to present a live AQI next
     to invented weather. Nothing awaits it and nothing depends on it, so a
     failure here leaves the forecast exactly as it was. */
  const air = useAirQuality((s) => s.air);
  const loadAir = useAirQuality((s) => s.load);
  useEffect(() => {
    loadAir(isDemo ? null : (realPlace ?? place));
  }, [isDemo, realPlace, place, loadAir]);
  const wxState = currentState(forecast, nowMin);
  const { toggle: toggleAmbience } = useAmbience(wxState);

  /* The AudioContext has to be started inside the click itself, so the
     preference and the engine are flipped together here rather than in an
     effect. */
  function toggleSound() {
    const next = !sound;
    toggleAmbience(next);
    toggleSoundPref();
  }


  const localTime = formatClock(nowMin);

  return (
    /* The stage is only a stage above 1024px; on mobile it is inert. */
    <div className="wx-stage min-h-[100dvh]">
      <div className="wx-viewport">
        {/* The weather world, clipped to the app and layered beneath content. */}
        <AtmosphereLayer state={wxState} motion={!motion} />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-3 px-5 pt-[max(16px,env(safe-area-inset-top))] pb-1">
            <div className="min-w-0">
              <button
                onClick={() => setLocationOpen(true)}
                aria-label="Change location"
                className="-ml-1.5 block max-w-full rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-white/[0.07]"
              >
                <p className="flex items-center gap-1.5 text-[14px] font-medium tracking-tight">
                  <MapPin size={13} className="shrink-0 text-[var(--wx-accent)]" />
                  <span className="truncate">{formatPlace(place)}</span>
                </p>
                <p className="mt-0.5 text-[11.5px] tabular-nums text-[var(--ink-faint)]">
                  {localTime} local
                  {isDemo ? " · demo" : realPlace ? "" : " · default"}
                </p>
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                onClick={toggleSound}
                label={sound ? "Mute ambience" : "Play ambience"}
                active={sound}
              >
                {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </IconButton>
              <IconButton
                onClick={() => setProfileOpen(true)}
                label={insights.primaryFocus ? `Context: ${FOCUS_BY_ID[insights.primaryFocus].label}` : "Your context"}
              >
                <SlidersHorizontal size={17} />
              </IconButton>
              <IconButton onClick={() => setSettingsOpen(true)} label="Settings">
                <Settings2 size={17} />
              </IconButton>
            </div>
          </header>

          <FocusChips
            selected={selectedFocus}
            active={insights.primaryFocus}
            onToggle={toggleFocus}
            onEdit={() => setSettingsOpen(true)}
          />

          {/* The scrolling region. Bottom padding is deliberately small: the
              continuation below it is what closes the page, so the content
              should not be pushed away from it. */}
          <main ref={mainRef} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 pb-3 pt-4">
            {loading && !forecast && (
              <p className="pt-24 text-center text-[13px] text-[var(--ink-faint)]">
                Reading the sky…
              </p>
            )}

            {whatIf && (
              <div className="flex items-center gap-2.5 rounded-[16px] bg-[var(--wx-accent)]/16 px-3.5 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_35%,transparent)]">
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  What-if active — recomputed for a{" "}
                  <strong className="font-semibold text-white">
                    {formatClock(whatIf.startMin)}
                  </strong>{" "}
                  departure.
                </p>
                <button
                  onClick={clearWhatIf}
                  aria-label="Clear what-if"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ink-soft)] hover:bg-white/12 hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {forecast && (
              <>
                <HeroCard forecast={forecast} nowMin={nowMin} name={profile.name} />
                <DataSourceNote />

                {severe && (
                  <Insight decision={severe} onWhatIf={setWhatIfEvent} defaultOpen />
                )}

                {/* The personalized block, before the routine. What someone
                    chose to care about is the answer they opened the app for;
                    their schedule is context for it. */}
                {headline && (
                  <div data-testid="focus-headline" data-focus={headline.focusId ?? "routine"}>
                    {headline.focusId && (
                      <FocusAttribution
                        name={profile.name}
                        focusId={headline.focusId}
                        isDefault={ctx.isDefault}
                        onEdit={() => setSettingsOpen(true)}
                        className="mb-2.5"
                      />
                    )}
                    <Insight decision={headline} onWhatIf={setWhatIfEvent} />
                  </div>
                )}

                {/* Sibling of the headline, not a child of it. The measurements
                    a focus asked for are worth showing on a settled evening when
                    no window is still actionable — nesting this inside the
                    headline made the whole band disappear in exactly that case. */}
                <FocusMetrics
                  forecast={forecast}
                  nowMin={nowMin}
                  inline={inlineMetrics}
                  more={moreMetrics}
                  air={air}
                />

                {/* Two lanes, each headed by the thing that produced it. The old
                    single "Also today" heading made a commute finding look like
                    part of the focus reading, which is how people who never
                    selected Commute ended up being told about their journey. */}
                {secondaryFocus.length > 0 && (
                  <section data-testid="lane-focus">
                    <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
                      Also for {laneFocusLabel(secondaryFocus)}
                    </h2>
                    <DecisionList decisions={secondaryFocus} onWhatIf={setWhatIfEvent} />
                  </section>
                )}

                {secondaryRoutine.length > 0 && (
                  <section data-testid="lane-routine">
                    <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
                      From your routine
                    </h2>
                    <DecisionList decisions={secondaryRoutine} onWhatIf={setWhatIfEvent} />
                  </section>
                )}

                <section>
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
                    Next 12 hours
                  </h2>
                  <WindowStrip forecast={forecast} nowMin={nowMin} />
                </section>

              </>
            )}

            {/* Development only. `import.meta.env.DEV` is statically false in a
                production build, so Vite drops this branch and tree-shakes the
                panel module out of the bundle entirely. */}
            {import.meta.env.DEV && <WeatherDebugPanel />}
          </main>

          {/* Closes the composition at the bottom of the viewport. Sits outside
              the scroller so the page always ends on a line about the sky rather
              than on whichever section happened to be last. */}
          {forecast && (
            <AtmosphereContinuation
              forecast={forecast}
              nowMin={nowMin}
              state={wxState}
            />
          )}
        </div>
      </div>

      {/* First-run prompt. Renders nothing once the user has chosen or skipped,
          and never asks for location — see Onboarding. */}
      <Onboarding />

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LocationPicker open={locationOpen} onClose={() => setLocationOpen(false)} />

      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        initialFocus={insights.primaryFocus}
      />
      <WhatIfSheet
        open={whatIfEvent !== null}
        eventId={whatIfEvent ?? ""}
        onClose={() => setWhatIfEvent(null)}
      />
    </div>
  );
}
