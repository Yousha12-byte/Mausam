import { create } from "zustand";
import { FOCUSES, type FocusId } from "../domain/focus";
import {
  DEFAULT_PROFILE,
  allEvents,
  type RoutineEvent,
  type UserProfile,
} from "../domain/routine";

const KEY = "mausam.profile.v1";

/** A stored window, before it is known to be well-formed. */
type RawEvent = Partial<RoutineEvent> & { id?: unknown };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Clock minutes, because a window outside the day is a data error, not a
 *  schedule. A legacy payload with a stringified time is coerced, since every
 *  earlier build wrote numbers and only a hand-edited payload would not. */
function minutes(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return isFiniteNumber(n) ? Math.max(0, Math.min(1439, Math.round(n))) : fallback;
}

const MODES = new Set(["walk", "bike", "auto", "car"]);

function event(raw: RawEvent, i: number): RoutineEvent | null {
  if (typeof raw?.id !== "string" || !raw.id) return null;
  const durationMin = minutes(raw.durationMin, 30);
  return {
    id: raw.id,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label : `Window ${i + 1}`,
    startMin: minutes(raw.startMin, 9 * 60),
    durationMin,
    // A window cannot contain more outdoor time than it has duration; a legacy
    // value above it would otherwise imply exposure that never happens.
    travelMin: Math.min(minutes(raw.travelMin, durationMin), durationMin),
    mode: MODES.has(raw.mode as string) ? (raw.mode as RoutineEvent["mode"]) : "walk",
  };
}

/**
 * Read a persisted profile, migrating the old flat `routine`.
 *
 * The previous build kept every window in one list with no owner, which is
 * exactly why a college commute reached every focus. Those windows were
 * unambiguously Commute — they are the commute times — so they are filed under
 * `schedules.commute` and the flat key is dropped. Any schedule already present
 * wins over the migration, so a payload written by the new build is never
 * clobbered by an old one.
 */
function load(): UserProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserProfile> & {
        routine?: RawEvent[];
        schedules?: Partial<Record<FocusId, { focusId?: string; events?: RawEvent[] }>>;
      };

      const schedules: UserProfile["schedules"] = {};
      for (const focus of FOCUSES) {
        const entry = parsed.schedules?.[focus.id];
        if (!entry || !Array.isArray(entry.events)) continue;
        const events = entry.events
          .map((e, i) => event(e, i))
          .filter((e): e is RoutineEvent => e !== null);
        if (events.length) schedules[focus.id] = { focusId: focus.id, events };
      }

      if (!schedules.commute && Array.isArray(parsed.routine)) {
        const events = parsed.routine
          .map((e, i) => event(e, i))
          .filter((e): e is RoutineEvent => e !== null);
        if (events.length) {
          schedules.commute = {
            focusId: "commute",
            events: events.map((e) => ({ ...e, id: `commute-${e.id}` })),
          };
        }
      }

      return {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : DEFAULT_PROFILE.name,
        schedules: Object.keys(schedules).length ? schedules : DEFAULT_PROFILE.schedules,
        sensitivity: { ...DEFAULT_PROFILE.sensitivity, ...parsed.sensitivity },
        varianceMin: isFiniteNumber(parsed.varianceMin) ? parsed.varianceMin : DEFAULT_PROFILE.varianceMin,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_PROFILE;
}

interface ProfileStore {
  profile: UserProfile;
  /** The windows configured for one focus. */
  eventsFor: (focusId: FocusId) => RoutineEvent[];
  setWindowTime: (focusId: FocusId, id: string, startMin: number) => void;
  setLabel: (id: string, label: string) => void;
  setVariance: (min: number) => void;
  /** Add a window to a focus, or remove it. Nothing is invented for a focus the
   *  user has not asked to schedule. */
  addWindow: (focusId: FocusId, seed: Partial<RoutineEvent> & { id: string }) => void;
  removeWindow: (id: string) => void;
  reset: () => void;
}

function withWindows(
  profile: UserProfile,
  focusId: FocusId,
  fn: (events: RoutineEvent[]) => RoutineEvent[],
): UserProfile {
  const current = profile.schedules[focusId]?.events ?? [];
  const events = fn(current);
  const schedules = { ...profile.schedules };
  if (events.length) schedules[focusId] = { focusId, events };
  else delete schedules[focusId];
  return { ...profile, schedules };
}

export const useProfile = create<ProfileStore>((set, get) => ({
  profile: load(),

  eventsFor: (focusId) => get().profile.schedules[focusId]?.events ?? [],

  setWindowTime(focusId, id, startMin) {
    const profile = withWindows(get().profile, focusId, (events) =>
      events.map((e) => (e.id === id ? { ...e, startMin: minutes(startMin, e.startMin) } : e)),
    );
    set({ profile });
    persist(profile);
  },

  setLabel(id, label) {
    const owner = allEvents(get().profile).find((e) => e.id === id);
    if (!owner) return;
    const profile = withWindows(get().profile, owner.focusId, (events) =>
      events.map((e) => (e.id === id ? { ...e, label } : e)),
    );
    set({ profile });
    persist(profile);
  },

  setVariance(min) {
    const profile = { ...get().profile, varianceMin: min };
    set({ profile });
    persist(profile);
  },

  addWindow(focusId, seed) {
    const added = event(seed as RawEvent, get().profile.schedules[focusId]?.events.length ?? 0);
    if (!added) return;
    const profile = withWindows(get().profile, focusId, (events) =>
      events.some((e) => e.id === added.id) ? events : [...events, added],
    );
    set({ profile });
    persist(profile);
  },

  removeWindow(id) {
    const owner = allEvents(get().profile).find((e) => e.id === id);
    if (!owner) return;
    const profile = withWindows(get().profile, owner.focusId, (events) =>
      events.filter((e) => e.id !== id),
    );
    set({ profile });
    persist(profile);
  },

  reset() {
    set({ profile: DEFAULT_PROFILE });
    persist(DEFAULT_PROFILE);
  },
}));

function persist(p: UserProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — profile stays in memory for this session */
  }
}
