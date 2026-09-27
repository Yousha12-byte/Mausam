import type { FocusId } from "./focus";
import type { ExposureVector, TravelMode } from "./weather";

/* ------------------------------------------------------------------ ROUTINE */

export interface RoutineEvent {
  id: string;
  label: string;
  /** Departure, minutes after local midnight. 17:30 === 1050. */
  startMin: number;
  /** Total activity duration in minutes. */
  durationMin: number;
  /** Minutes of that duration spent outside and exposed to weather. */
  travelMin: number;
  mode: TravelMode;
}

/* ------------------------------------------------------- FOCUS SCOPED SCHEDULES

   The bug this replaces: `routine` was one flat list on the profile, so every
   configured window was scored for every focus. A student who selected
   Agriculture was still told their college journey was at risk, because the
   engine could not tell that "College to home" belonged to Commute and not to
   them-in-general.

   Context belongs to the focus that gives it meaning. A commute time is not a
   person's routine, it is *their commute*; a field window is not "the routine",
   it is *their field window*. Storing them per focus makes the mistake
   unrepresentable rather than merely avoided.

   One shape serves all eight focuses, because a window is a window: a start, a
   length, and how much of it is spent in the weather. What differs per focus is
   which fields are meaningful, and that is expressed by which focus the
   schedule is filed under — not by eight parallel types.

   `mode` is how exposure is expressed, and it is reused rather than extended: a
   field window or an outdoor event is exactly as exposed as walking, and an
   indoor event is exactly as sheltered as a sealed car. So `effectiveExposure`
   and every severity calculation downstream stay untouched. */

export interface FocusSchedule {
  focusId: FocusId;
  /** Windows configured for this focus alone. Never mixed with another's. */
  events: RoutineEvent[];
}

export interface UserProfile {
  name: string;
  /** Where this person is, resolved on the device. Not part of the profile. */
  /**
   * Per-focus schedules. A focus with no entry has no configured context, and
   * that absence is meaningful: Daily Life is *meant* to have none, and for
   * Work or Travel it means "not configured yet" rather than "at a guess".
   */
  schedules: Partial<Record<FocusId, FocusSchedule>>;
  /** Per-condition sensitivity weights, 0..1. */
  sensitivity: Record<keyof ExposureVector, number>;
  /** Historical spread of this user's departure time, in minutes. */
  varianceMin: number;
}

/** A window that knows which focus it was configured for. */
export interface ScheduledEvent extends RoutineEvent {
  focusId: FocusId;
}

export type SensitivityKey = keyof ExposureVector;

/* ------------------------------------------------------------------ DEFAULTS */

/** Exposure weight per travel mode — how much weather actually reaches you.
 *  An auto-rickshaw and a two-wheeler are largely open to the sky in Indian
 *  conditions, so they sit far closer to walking than to a sealed car. */
export const MODE_EXPOSURE: Record<TravelMode, number> = {
  walk: 1,
  bike: 0.9,
  auto: 0.7,
  car: 0.2,
};

/** Outdoor time scales with how exposed the mode is. */
export function effectiveExposure(event: RoutineEvent): number {
  return event.travelMin * MODE_EXPOSURE[event.mode];
}

/** The SIH reference user: a student who leaves college at 17:30.

   The commute is filed under the Commute focus, because that is the only focus
   it describes. Nobody else is scored against it. */
export const DEFAULT_PROFILE: UserProfile = {
  name: "Ananya",
  schedules: {
    commute: {
      focusId: "commute",
      events: [
        {
          id: "commute-home",
          label: "College to home",
          startMin: 17 * 60 + 30,
          durationMin: 50,
          travelMin: 35,
          mode: "auto",
        },
        {
          id: "morning-college",
          label: "Home to college",
          startMin: 8 * 60 + 15,
          durationMin: 55,
          travelMin: 30,
          mode: "auto",
        },
      ],
    },
  },
  sensitivity: { precip: 0.9, wind: 0.3, heat: 0.7, lowVis: 0.7, thunder: 1 },
  varianceMin: 15,
};

/* ------------------------------------------------------------------ HELPERS */

/** The windows configured for one focus. Empty when none are. */
export function scheduleFor(
  profile: UserProfile,
  focusId: FocusId,
): RoutineEvent[] {
  return profile.schedules[focusId]?.events ?? [];
}

export function hasSchedule(profile: UserProfile, focusId: FocusId): boolean {
  return scheduleFor(profile, focusId).length > 0;
}

/** Every configured window, any focus. For editors that act on a specific
 *  window the user can already see, rather than for scoring. */
export function allEvents(profile: UserProfile): ScheduledEvent[] {
  return (Object.keys(profile.schedules) as FocusId[]).flatMap((focusId) =>
    scheduleFor(profile, focusId).map((e) => ({ ...e, focusId })),
  );
}

export function findEvent(
  profile: UserProfile,
  id: string,
): ScheduledEvent | undefined {
  return allEvents(profile).find((e) => e.id === id);
}

/**
 * Every window belonging to the *selected* focuses, tagged with its owner.
 *
 * This is the whole fix for the cross-focus leak: the decision engine is handed
 * only these, so a Commute window cannot produce a reading under Agriculture
 * even in principle. No branch inside the engine has to remember which focus it
 * is scoring.
 */
export function activeEvents(
  profile: UserProfile,
  focusIds: readonly FocusId[],
): ScheduledEvent[] {
  const wanted = new Set(focusIds);
  return [...wanted].flatMap((focusId) =>
    scheduleFor(profile, focusId).map((e) => ({ ...e, focusId })),
  );
}

/**
 * What the decision engine consumes: a profile, plus the windows to score.
 *
 * `runDecisionEngine` is deliberately given the windows explicitly rather than
 * reaching into `profile.schedules`, because *which* windows are relevant is a
 * question about the active focus, not about who the person is. Keeping them a
 * separate input is what makes scoping a narrowing of one argument rather than
 * a change to the engine.
 */
export type DecisionProfile = UserProfile & { routine: RoutineEvent[] };

/**
 * A copy of the profile carrying only the selected focuses' windows.
 *
 * The decision engine reads `profile.routine` and nothing else about the
 * profile's shape, so scoping by handing it a narrowed profile keeps every
 * severity calculation, confidence score and ordering byte-for-byte identical
 * — there is no second code path that could disagree with the first.
 */
export function scopeProfile(
  profile: UserProfile,
  focusIds: readonly FocusId[],
): DecisionProfile {
  return { ...profile, routine: activeEvents(profile, focusIds) };
}
