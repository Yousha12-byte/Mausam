import { create } from "zustand";
import { DEFAULT_FOCUS, FOCUS_BY_ID, type FocusId } from "../domain/focus";

/* Focus lives in its own store beside the profile and the weather.

   It is deliberately *not* a field on `UserProfile`. The profile answers "who is
   this person and when are they out"; focus answers "what do they want the
   weather to tell them". Folding one into the other would make changing what
   someone cares about look like editing their identity, and would couple the
   routine editor to a concept it has nothing to do with.

   Personalisation is derived from the selected focuses alone — there is no
   hand-picked metric list. An earlier draft carried an unused `custom` array
   with `setCustom`/`toggleCustom` for overriding which metrics appear. Nothing
   ever read it, so it was dead state that would only ever have been
   *persisted* to localStorage, never used, while looking load-bearing. It is
   gone rather than stubbed out; if manual metric choice is ever wanted it
   deserves a designed feature and a real consumer, not a placeholder. */

const KEY = "mausam.focus.v1";
const ONBOARDED_KEY = "mausam.onboarded.v1";

interface Persisted {
  selected: FocusId[];
}

function isFocusId(v: unknown): v is FocusId {
  return typeof v === "string" && v in FOCUS_BY_ID;
}

/**
 * Read persisted focuses.
 *
 * Only `selected` is read, so a payload written by an older build — which also
 * carried a `custom` array — still loads, with the stale key ignored. Migrating
 * it away would mean a pointless second round trip to rewrite storage that the
 * app then never consults again.
 */
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return { selected: (parsed.selected ?? []).filter(isFocusId) };
    }
  } catch {
    /* fall through to defaults */
  }
  return { selected: [] };
}

function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

interface FocusStore {
  selected: FocusId[];
  /** False until the user has either chosen focuses or skipped the prompt. */
  onboarded: boolean;

  toggle: (id: FocusId) => void;
  /** Used by the onboarding "Skip for now" path. */
  skipOnboarding: () => void;
  completeOnboarding: (ids: FocusId[]) => void;
  reset: () => void;
}

function persist(state: Pick<FocusStore, "selected">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ selected: state.selected }));
  } catch {
    /* storage unavailable — focus stays in memory for this session */
  }
}

export const useFocus = create<FocusStore>((set, get) => ({
  selected: load().selected,
  onboarded: loadOnboarded(),

  toggle(id) {
    if (!isFocusId(id)) return;
    const has = get().selected.includes(id);
    /* Unchecking the last focus is allowed. An empty selection is a legitimate
       state, and `combineFocuses` already resolves it to Daily Life at read
       time — the same place that resolves a skipped onboarding. Guarding it
       here as well would have meant the chip refused to untick with no visible
       reason, and left Settings showing a focus the user had not chosen. */
    const selected = has ? get().selected.filter((x) => x !== id) : [...get().selected, id];
    set({ selected });
    persist({ selected });
  },

  skipOnboarding() {
    set({ onboarded: true, selected: [DEFAULT_FOCUS] });
    persist({ selected: [DEFAULT_FOCUS] });
    markOnboarded();
  },

  completeOnboarding(ids) {
    const selected = ids.filter(isFocusId);
    const next = selected.length > 0 ? selected : [DEFAULT_FOCUS];
    set({ selected: next, onboarded: true });
    persist({ selected: next });
    markOnboarded();
  },

  reset() {
    const next = { selected: [DEFAULT_FOCUS] };
    set({ ...next, onboarded: true });
    persist(next);
  },
}));

function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* non-fatal: the prompt simply reappears next session */
  }
}
