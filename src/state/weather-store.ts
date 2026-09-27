import { create } from "zustand";
import type { GeoLocation, NormalizedForecast, WeatherState } from "../domain/weather";
import { DEMO_LOCATION } from "../domain/location";
import type { DataOrigin } from "../lib/source";
import { loadLiveForecast, loadDemoForecast, setActiveScenario, SCENARIOS } from "../data";
import { OM_REQUEST_SHAPE } from "../data/openmeteo";
import { runDecisionEngine, currentObservationAt, type Decision } from "../domain/decision";
import { deriveState } from "../domain/taxonomy";
import { scopeProfile, type UserProfile } from "../domain/routine";
import { useFocus } from "./focus-store";

/* Live snapshots — only real Open-Meteo observations ever land here.
   Generated demo data has no write path at all, so the two can never be
   confused. Records are keyed by the full identity of the request that produced
   them, not by coordinates alone: a forecast reissued for the same point under a
   different variable set, provider or timezone is a different forecast, and
   serving it as a cache hit would show numbers the current request never asked
   for. */
const LIVE_SNAPSHOT_KEY = "mausam.snapshots.live.v2";

interface SnapshotRecord {
  forecast: NormalizedForecast;
  savedAt: number;
  /** Provider timezone at the time of the request, for verification. */
  timezone: string;
}

/**
 * Identity of a live *request*: provider, point, and the exact variable set.
 *
 * The response's own timezone is deliberately not part of the key. It is only
 * knowable once a request has succeeded, so a cache that depended on it could
 * not be consulted at all after the failure that makes the cache necessary. It
 * is stored alongside the record and checked on read instead, which catches a
 * genuinely different place sharing coordinates far more usefully than it
 * catches a stale offset.
 */
function snapshotKey(provider: string, lat: number, lon: number): string {
  return [provider, lat.toFixed(3), lon.toFixed(3), OM_REQUEST_SHAPE].join("|");
}

function readSnapshots(): Record<string, SnapshotRecord> {
  try {
    const raw = localStorage.getItem(LIVE_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SnapshotRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLiveSnapshot(f: NormalizedForecast, at: number): void {
  try {
    const all = readSnapshots();
    all[snapshotKey(f.source, f.location.lat, f.location.lon)] = {
      forecast: f,
      savedAt: at,
      timezone: f.timezone,
    };
    localStorage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — the live path is unaffected */
  }
}

/** Replay this place's last real observation, or null if there isn't a valid one. */
function readLiveSnapshot(location: GeoLocation): NormalizedForecast | null {
  const record = readSnapshots()[snapshotKey("open-meteo", location.lat, location.lon)];
  if (!record?.forecast?.hourly?.length) return null;
  // A known timezone that disagrees means these are not the same sky.
  if (location.timezone && record.timezone && location.timezone !== record.timezone) return null;
  return record.forecast;
}

/* Demo state is deterministic — no need to persist. */

/** Every load is numbered; only the newest one is allowed to publish. */
let generation = 0;

function realNowMin(tzOffsetMin: number): number {
  const d = new Date();
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utcMin + tzOffsetMin) % 1440) + 1440) % 1440;
}

interface WeatherStore {
  forecast: NormalizedForecast | null;
  loading: boolean;
  /** True when live data was requested but unavailable. */
  degraded: boolean;
  degradedReason?: string;
  /** Pinned demo scenario, or null for live weather. This *is* the mode. */
  scenarioId: string | null;
  /** Overrides the wall clock so a demo can pin sunrise, sunset or night. */
  clockOverride: number | null;
  nowMin: number;
  /** Active "what if I leave at..." override, applied across the whole page. */
  whatIf: { eventId: string; startMin: number } | null;
  /** What the displayed numbers actually are. Drives the source note. */
  origin: DataOrigin;
  load: (location: GeoLocation, scenarioId?: string | null) => Promise<void>;
  setScenario: (id: string | null) => Promise<void>;
  setClock: (min: number | null) => void;
  setWhatIf: (eventId: string, startMin: number) => void;
  clearWhatIf: () => void;
}

export const useWeather = create<WeatherStore>((set, get) => ({
  forecast: null,
  loading: true,
  degraded: false,
  scenarioId: null,
  clockOverride: null,
  nowMin: 12 * 60,
  whatIf: null,
  origin: "simulated",

  async load(location, scenarioId = undefined) {
    const gen = ++generation;
    set({ loading: true });

    // `undefined` means "keep what is pinned"; an explicit null clears it.
    const id = scenarioId === undefined ? get().scenarioId : scenarioId;
    const now = Date.now();
    const isDemo = id !== null;
    if (id) setActiveScenario(id);

    let forecast: NormalizedForecast;
    let degraded = false;
    let reason: string | undefined;
    let origin: DataOrigin;

    if (isDemo) {
      /* Demo: generated, offline, pinned to Kochi. Deliberately ignores
         `location` so a demo can never show the real place's coordinates, and
         never writes a live snapshot. */
      forecast = await loadDemoForecast(DEMO_LOCATION, now);
      origin = "demo";
    } else {
      /* Live: the only path that may produce origin "live" or "cached". */
      try {
        const live = await loadLiveForecast(location, now);
        forecast = live.forecast;
        origin = "live";
        writeLiveSnapshot(forecast, now);
      } catch (err) {
        reason = err instanceof Error ? err.message : "live source unavailable";
        degraded = true;
        const fallback = await loadDemoForecast(location, now);
        const snap = readLiveSnapshot(location);
        if (snap) {
          forecast = snap;
          origin = "cached";
        } else {
          /* No observation was ever taken for this exact request, so the
             numbers are generated and are labelled as such. This is the only
             way to reach "simulated" — never a user-selectable mode. */
          forecast = fallback;
          origin = "simulated";
        }
      }
    }

    // A slower request for a place the user has already left must never
    // publish over the current one.
    if (gen !== generation) return;

    const spec = get().scenarioId ? SCENARIOS.find((s) => s.id === get().scenarioId) : (id ? SCENARIOS.find((s) => s.id === id) : undefined);
    const clock = spec?.clockMin ?? get().clockOverride;

    set({
      forecast,
      origin,
      degraded,
      degradedReason: reason,
      scenarioId: id,
      whatIf: null,
      loading: false,
      clockOverride: clock,
      nowMin: clock ?? realNowMin(forecast.tzOffsetMin),
    });
  },

  /* Presentation Mode has exactly two settings: a named demo scenario, or null
     for live weather. There is deliberately no third "simulated" mode — a user
     who asks for live either gets an observation, a replay of their own last
     observation, or an honest "live unavailable" note. Generated data is
     reachable only as the last-resort fallback inside `load`. */
  async setScenario(id: string | null) {
    await get().load(currentLocation(), id);
  },

  setClock(min: number | null) {
    const f = get().forecast;
    set({ clockOverride: min, nowMin: min ?? (f ? realNowMin(f.tzOffsetMin) : 720) });
  },

  setWhatIf(eventId: string, startMin: number) {
    set({ whatIf: { eventId, startMin } });
  },

  clearWhatIf() {
    set({ whatIf: null });
  },
}));

/* The store needs to know which place to fetch. Kept as a module-level
   reference set whenever the location changes, to avoid a circular import
   between the two stores. */
let locationRef: GeoLocation = DEMO_LOCATION;
export function bindLocation(loc: GeoLocation): void {
  locationRef = loc;
}
function currentLocation(): GeoLocation {
  return locationRef;
}

/* ------------------------------------------------------- derived selectors */

export function currentSample(f: NormalizedForecast | null, nowMin: number) {
  return f ? currentObservationAt(f, nowMin) : null;
}

export function currentState(f: NormalizedForecast | null, nowMin: number): WeatherState {
  const s = currentSample(f, nowMin);
  return s ? deriveState(s.code, s.isDay) : "sunny";
}

export function useDecisions(profile: UserProfile) {
  const forecast = useWeather((s) => s.forecast);
  const nowMin = useWeather((s) => s.nowMin);
  const scenarioId = useWeather((s) => s.scenarioId);
  const whatIf = useWeather((s) => s.whatIf);
  /* Only the active focuses' windows are scored, so the routine lane cannot
     offer a Commute journey to someone reading their field window. */
  const selectedFocus = useFocus((s) => s.selected);

  if (!forecast) return [] as Decision[];

  return runDecisionEngine({
    forecast,
    profile: scopeProfile(profile, selectedFocus),
    nowMin,
    scenario: scenarioId !== null,
    overrideEventId: whatIf?.eventId,
    overrideStartMin: whatIf?.startMin,
  });
}