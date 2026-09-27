import type { FocusId } from "./focus";

/* ------------------------------------------------------------------ COPY

   The wording of the context sheet, per focus, in one place.

   The old sheet was titled "Your routine" and opened with "Mausam compares the
   forecast against these times", which is a false statement to show someone who
   has selected Agriculture and configured no field window: there are no times to
   compare against, and the copy implied a schedule they had never given. Worse,
   it offered the commute's time inputs to everybody.

   So the sheet describes the context of the focus actually being edited, and a
   focus with nothing configured says so instead of implying a schedule. The
   sentences live here rather than in the component so they can be asserted
   against, and so "which copy belongs to which focus" is one lookup rather than a
   switch buried in JSX. */

export interface ContextCopy {
  /** Sheet title. */
  title: string;
  /** What the times are for, in one sentence. */
  blurb: string;
  /** What one configured window represents in this focus. */
  windowNoun: string;
  /** Label for the control that creates a window. */
  addLabel: string;
  /**
   * True when the focus has no schedule of its own and must never be shown one.
   * Daily Life reads the day as a whole; inventing a window for it would be
   * asking for a number that changes nothing.
   */
  scheduleOptional: boolean;
  /**
   * True when the focus is about a *departure*, so departure-time uncertainty is
   * meaningful. It is not meaningful for a window you sit inside all afternoon.
   */
  hasDeparture: boolean;
  /** Shown when the focus has no configured window. */
  empty: string;
}

export const CONTEXT_COPY: Record<FocusId, ContextCopy> = {
  daily: {
    title: "Your day",
    blurb:
      "Daily Life reads the whole day as it comes, with no times to compare against. Add a window only if you want a particular part of the day called out.",
    windowNoun: "Part of your day",
    addLabel: "Add a part of your day",
    scheduleOptional: true,
    hasDeparture: false,
    empty:
      "No times needed. Mausam is reading today as a whole — nothing here is missing.",
  },
  commute: {
    title: "Your commute",
    blurb:
      "Mausam compares the forecast against your commute, using how exposed your usual mode is and how much your departure time varies.",
    windowNoun: "Journey",
    addLabel: "Add a journey",
    scheduleOptional: false,
    hasDeparture: true,
    empty: "Add the journey you want checked, and when you usually set off.",
  },
  health: {
    title: "Your environmental window",
    blurb:
      "Health reports on the environment — heat, humidity, sun and air quality. It is not a medical assessment. Add a window if you want a particular stretch of the day covered.",
    windowNoun: "Environmental window",
    addLabel: "Add an environmental window",
    scheduleOptional: true,
    hasDeparture: false,
    empty: "No window needed. Mausam is reporting on the hours ahead as they come.",
  },
  travel: {
    title: "Your travel window",
    blurb:
      "Mausam reads the forecast across the hours you are actually moving through, so it can tell you about the leg that matters rather than the day in general.",
    windowNoun: "Travel window",
    addLabel: "Add a travel window",
    scheduleOptional: true,
    hasDeparture: true,
    empty: "Add the journey you are planning, and roughly when you leave.",
  },
  work: {
    title: "Your workday",
    blurb:
      "Mausam compares the forecast against your working hours, scoring the time you spend outside separately from time indoors.",
    windowNoun: "Working window",
    addLabel: "Add your working hours",
    scheduleOptional: true,
    hasDeparture: false,
    empty: "Add your working hours, and the part of them you spend outside.",
  },
  agri: {
    title: "Your field window",
    blurb:
      "Mausam scores rainfall, humidity and temperature across your field hours. Soil moisture is a model estimate for this location, not a reading from your field.",
    windowNoun: "Field window",
    addLabel: "Add a field window",
    scheduleOptional: true,
    hasDeparture: false,
    empty: "Add the hours you are working in the field.",
  },
  outdoor: {
    title: "Your outdoor window",
    blurb:
      "Mausam scores the forecast across the hours you are outside, using the same exposure weighting it applies to any outdoor time.",
    windowNoun: "Activity window",
    addLabel: "Add an outdoor window",
    scheduleOptional: true,
    hasDeparture: false,
    empty: "Add when you are out, and Mausam will read the weather across it.",
  },
  events: {
    title: "Your event",
    blurb:
      "Mausam reads the forecast across your event window, and treats an indoor event differently from an outdoor one.",
    windowNoun: "Event",
    addLabel: "Add an event",
    scheduleOptional: true,
    hasDeparture: false,
    empty: "Add your event and the hours it runs.",
  },
};

/** A sensible new window for a focus, never stored until the user asks. */
export function windowSeed(
  focusId: FocusId,
): { id: string; label: string; startMin: number; durationMin: number; travelMin: number; mode: "walk" | "car" } {
  const seeds = {
    daily: { label: "Part of your day", startMin: 8 * 60, durationMin: 120, travelMin: 120, mode: "walk" },
    commute: { label: "New journey", startMin: 18 * 60, durationMin: 30, travelMin: 20, mode: "car" },
    health: { label: "Environmental window", startMin: 12 * 60, durationMin: 120, travelMin: 0, mode: "car" },
    travel: { label: "Travel window", startMin: 7 * 60, durationMin: 90, travelMin: 90, mode: "car" },
    work: { label: "Working window", startMin: 9 * 60, durationMin: 480, travelMin: 45, mode: "walk" },
    agri: { label: "Field work", startMin: 6 * 60 + 30, durationMin: 240, travelMin: 240, mode: "walk" },
    outdoor: { label: "Outdoor time", startMin: 17 * 60, durationMin: 120, travelMin: 120, mode: "walk" },
    events: { label: "Event", startMin: 19 * 60, durationMin: 120, travelMin: 120, mode: "walk" },
  } as const;
  const s = seeds[focusId];
  return { id: `${focusId}-${s.startMin}`, ...s };
}
