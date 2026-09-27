import { create } from "zustand";

const KEY = "mausam.settings.v1";

interface Stored {
  sound?: boolean;
  reduceMotion?: boolean | null;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Stored;
    return typeof v === "object" && v !== null ? v : {};
  } catch {
    return {};
  }
}

function write(patch: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    /* Private mode or a full quota must never break the app. */
  }
}

interface Settings {
  sound: boolean;
  /** null means "follow the operating system". */
  reduceMotion: boolean | null;
  /** Resolved value actually used by the atmosphere. */
  motion: boolean;
}

interface SettingsStore extends Settings {
  hydrate: (osReduced: boolean) => void;
  toggleSound: () => void;
  toggleMotion: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => {
  const initial = read();
  return {
    // Sound always starts off: it cannot autoplay, so restoring a stale "on"
    // would show a toggle that promises sound the app is not allowed to make.
    sound: false,
    reduceMotion: initial.reduceMotion ?? null,
    motion: initial.reduceMotion ?? false,

    hydrate(osReduced) {
      const override = get().reduceMotion;
      set({ motion: override === null ? osReduced : override });
    },

    toggleSound() {
      const sound = !get().sound;
      set({ sound });
      write({ sound });
    },

    toggleMotion() {
      const reduceMotion = !get().motion;
      set({ reduceMotion, motion: reduceMotion });
      write({ reduceMotion });
    },
  };
});
