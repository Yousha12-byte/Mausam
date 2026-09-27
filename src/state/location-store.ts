import { create } from "zustand";
import type { GeoLocation } from "../domain/weather";
import { coercePlace } from "../domain/location";
import { reverseGeocode } from "../lib/geocode";

const KEY = "mausam.location.v1";

/** The two states a real location can be in. `demo` is never stored. */
export type RealMode = "live" | "selected";

/**
 * Where a locate attempt has got to. Kept granular because "Locating…" while
 * the browser waits for a permission decision reads as a hang, and the two
 * waits are nothing alike.
 */
export type LocateStage = "idle" | "prompting" | "locating" | "naming" | "ready" | "error";

export type LocateErrorKind =
  | "denied"
  | "unavailable"
  | "timeout"
  | "insecure"
  | "unsupported"
  | "naming"
  | "unknown";

export type PermissionState = "granted" | "denied" | "prompt" | "unknown";

interface Persisted {
  mode: RealMode;
  place: GeoLocation;
  /** Kept apart from `place` so a live fix never destroys the user's own choice. */
  lastSelected?: GeoLocation | null;
}

function readStorage(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (p.mode !== "live" && p.mode !== "selected") return null;
    const place = coercePlace(p.place);
    if (!place) return null;
    // Written before this field existed, so a stored selection is its own
    // fallback for itself.
    const lastSelected = coercePlace(p.lastSelected) ?? (p.mode === "selected" ? place : null);
    return { mode: p.mode, place, lastSelected };
  } catch {
    return null;
  }
}

function writeStorage(v: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable — the location still works for this session */
  }
}

export function geolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Geolocation is gated on a secure context. Some browsers still expose the API
 * on plain HTTP and then fail every call, which surfaces as a baffling timeout,
 * so the origin is checked directly and named in the message.
 */
export function isSecureOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

const ATTEMPTS = {
  /** A city-level fix is enough for weather and far kinder to the battery. */
  quick: { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
  /**
   * The escalation, offered rather than attempted silently. GPS-grade fixes are
   * genuinely slower, so this only makes sense as a deliberate second try.
   */
  precise: { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
} satisfies Record<string, PositionOptions>;

/** Permission state is a hint, never a dependency. */
async function readPermission(): Promise<PermissionState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    const v = status.state;
    return v === "granted" || v === "denied" || v === "prompt" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

const MESSAGES: Record<LocateErrorKind, string> = {
  denied: "Location permission was declined. Allow it in your browser's site settings, or search for a place below.",
  unavailable: "Your device could not determine a location. Search for a place below instead.",
  timeout: "No location fix arrived in time. This is common indoors or on a desktop without location services.",
  insecure: "This page is not on a secure origin, so the browser blocks location. Use localhost or an https:// address.",
  unsupported: "This browser cannot share a location. Search for a place below instead.",
  naming: "Located, but the place name could not be looked up. Showing your coordinates until you pick a place.",
  unknown: "Could not determine your location. Search for a place below instead.",
};

interface LocationStore {
  /** How the current place was arrived at. Never "demo" — that is not stored. */
  mode: RealMode;
  /** The user's real location, or null if they have never chosen one. */
  place: GeoLocation | null;
  /** The last place they searched for, kept while live mode is active. */
  lastSelected: GeoLocation | null;
  stage: LocateStage;
  error: string | null;
  errorKind: LocateErrorKind | null;
  /** True only after a timeout, where a slower precise fix is worth offering. */
  canRetryPrecisely: boolean;
  permission: PermissionState;
  hydrated: boolean;

  hydrate: () => void;
  requestLive: (opts?: { precise?: boolean }) => Promise<void>;
  selectPlace: (place: GeoLocation) => void;
  /** Leave live mode and go back to the last place that was searched for. */
  useSelected: () => void;
}

/* Only the newest attempt may publish. An older one that resolves late is
   discarded rather than allowed to overwrite a newer fix. */
let attempt = 0;
/** Watchdog for browsers that invoke neither callback. Cleared every time. */
let watchdog: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog(): void {
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

function describe(err: unknown): LocateErrorKind {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unknown";
}

function fix(position: GeolocationPosition): { lat: number; lon: number } {
  return { lat: position.coords.latitude, lon: position.coords.longitude };
}

export const useLocation = create<LocationStore>((set, get) => ({
  mode: "selected",
  place: null,
  lastSelected: null,
  stage: "idle",
  error: null,
  errorKind: null,
  canRetryPrecisely: false,
  permission: "unknown",
  hydrated: false,

  hydrate() {
    if (get().hydrated) return;
    const stored = readStorage();
    set({
      hydrated: true,
      permission: "unknown",
      ...(stored
        ? {
            mode: stored.mode,
            place: stored.place,
            lastSelected: stored.lastSelected ?? null,
            stage: "ready" as const,
          }
        : {}),
    });
    void readPermission().then((permission) => {
      if (!get().hydrated) return;
      set({ permission });
    });
  },

  async requestLive(opts = {}) {
    const precise = opts.precise === true;
    const mine = ++attempt;
    clearWatchdog();

    if (!geolocationSupported()) {
      set({
        stage: "error",
        errorKind: "unsupported",
        error: MESSAGES.unsupported,
        canRetryPrecisely: false,
      });
      return;
    }
    if (!isSecureOrigin()) {
      set({
        stage: "error",
        errorKind: "insecure",
        error: MESSAGES.insecure,
        canRetryPrecisely: false,
      });
      return;
    }
    // Already known to be blocked: do not raise a prompt that cannot be granted.
    if (get().permission === "denied") {
      set({ stage: "error", errorKind: "denied", error: MESSAGES.denied, canRetryPrecisely: false });
      return;
    }

    const position = ATTEMPTS[precise ? "precise" : "quick"]!;
    set({
      stage: "prompting",
      error: null,
      errorKind: null,
      canRetryPrecisely: false,
    });

    let coords: { lat: number; lon: number };
    try {
      coords = await new Promise<{ lat: number; lon: number }>((resolve, reject) => {
        // A browser that invokes neither callback must not leave this hanging.
        watchdog = setTimeout(
          () => reject({ code: 3, message: "no fix" }),
          position.timeout + 2000,
        );
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(fix(p)),
          (err) => reject(err),
          position,
        );
      });
    } catch (err) {
      clearWatchdog();
      if (mine !== attempt) return;
      const kind = describe(err);
      set({
        stage: "error",
        errorKind: kind,
        error: MESSAGES[kind],
        // A slow first answer is the one failure a slower retry can fix.
        canRetryPrecisely: kind === "timeout" && !precise,
      });
      void readPermission().then((permission) => {
        if (mine === attempt) set({ permission });
      });
      return;
    }
    clearWatchdog();
    if (mine !== attempt) return;

    /* Coordinates first, name second. The fix is what the weather needs, so it
       is committed immediately and the app can fetch on it while the label is
       still being resolved. */
    const provisional: GeoLocation = { name: "Current location", admin: "", ...coords };
    writeStorage({ mode: "live", place: provisional, lastSelected: get().lastSelected });
    set({
      mode: "live",
      place: provisional,
      lastSelected: get().lastSelected,
      stage: "naming",
      error: null,
      errorKind: null,
    });

    try {
      const named = await reverseGeocode(coords.lat, coords.lon);
      if (mine !== attempt) return;
      writeStorage({ mode: "live", place: named, lastSelected: get().lastSelected });
      set({
        mode: "live",
        place: named,
        lastSelected: get().lastSelected,
        stage: "ready",
        error: null,
        errorKind: null,
      });
    } catch {
      // The coordinates are good and already saved; only the label is missing.
      if (mine !== attempt) return;
      set({ stage: "ready", errorKind: "naming", error: MESSAGES.naming });
    }
    void readPermission().then((permission) => {
      if (mine === attempt) set({ permission });
    });
  },

  selectPlace(place) {
    // Choosing by hand supersedes any attempt still in flight.
    attempt++;
    clearWatchdog();
    writeStorage({ mode: "selected", place, lastSelected: place });
    set({
      mode: "selected",
      place,
      lastSelected: place,
      stage: "ready",
      error: null,
      errorKind: null,
      canRetryPrecisely: false,
    });
  },

  useSelected() {
    const { place, lastSelected, mode } = get();
    // Only meaningful while live is showing something different.
    if (!place || mode === "selected") return;
    const back = lastSelected ?? (get().mode === "selected" ? place : null);
    if (!back) return;
    writeStorage({ mode: "selected", place: back, lastSelected: back });
    set({ mode: "selected", place: back, lastSelected: back, stage: "ready", error: null, errorKind: null });
  },
}));

/** The label for the header, or null when no real location is known yet. */
export function useLocationPlace(): GeoLocation | null {
  return useLocation((s) => s.place);
}
