import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveLocation } from "../src/domain/location";
import { DEMO_LOCATION } from "../src/domain/location";

const MUMBAI_FIX = { coords: { latitude: 19.076, longitude: 72.8777 } };
const DELHI_FIX = { coords: { latitude: 28.6519, longitude: 77.2315 } };

interface GeoOpts {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

type Fix = { coords: { latitude: number; longitude: number } };
type GeoError = { code: number; message: string };
let handler: { ok: (p: Fix) => void; err: (e: GeoError) => void } | null = null;
let seen: GeoOpts[] = [];

function stubGeo(opts: { supported?: boolean; secure?: boolean } = {}) {
  // The key must be absent, not undefined: `"geolocation" in navigator` has to
  // be false for an unsupported browser.
  const nav: Record<string, unknown> = {};
  if (opts.supported !== false) {
    nav.geolocation = {
      getCurrentPosition: (ok: (p: Fix) => void, err: (e: GeoError) => void, o: GeoOpts) => {
        seen.push(o);
        handler = { ok, err };
      },
    };
  }
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("window", {
    isSecureContext: opts.secure !== false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

async function freshStore() {
  vi.resetModules();
  return import("../src/state/location-store");
}

const stored = () => {
  try {
    return JSON.parse(localStorage.getItem("mausam.location.v1") ?? "null");
  } catch {
    return null;
  }
};

beforeEach(() => {
  seen = [];
  handler = null;
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  });
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in unit tests");
  });
  stubGeo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("geolocation: success", () => {
  it("stores coordinates immediately, then the name when it arrives", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive();
    handler?.ok(MUMBAI_FIX);
    await vi.waitFor(() => expect(useLocation.getState().place).not.toBeNull());

    // Coordinates are committed before the label is known.
    expect(useLocation.getState().place).toMatchObject({
      lat: 19.076,
      lon: 72.8777,
    });
    expect(useLocation.getState().mode).toBe("live");
    await p;
  });

  it("uses a city-level, cached-permitting fix by default", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive();
    expect(seen[0]).toMatchObject({ enableHighAccuracy: false, maximumAge: 300_000 });
    expect(seen[0]!.timeout).toBeGreaterThanOrEqual(10_000);
    handler?.ok(MUMBAI_FIX);
    await p;
  });

  it("asks for a more accurate, longer fix only when told to", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive({ precise: true });
    expect(seen[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(seen[0]!.timeout).toBeGreaterThan(20_000);
    handler?.ok(MUMBAI_FIX);
    await p;
  });
});

describe("geolocation: failures are distinguishable", () => {
  const cases: Array<[number, string, boolean]> = [
    [1, "denied", false],
    [2, "unavailable", false],
    [3, "timeout", true],
  ];

  for (const [code, kind, offersRetry] of cases) {
    it(`maps error ${code} to ${kind}`, async () => {
      const { useLocation } = await freshStore();
      const p = useLocation.getState().requestLive();
      handler?.err({ code, message: "x" });
      await p;
      const s = useLocation.getState();
      expect(s.stage).toBe("error");
      expect(s.errorKind).toBe(kind);
      expect(s.error).toBeTruthy();
      expect(s.canRetryPrecisely).toBe(offersRetry);
      // A failure never invents a position.
      expect(s.place).toBeNull();
    });
  }

  it("does not offer a precise retry when permission was denied", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive();
    handler?.err({ code: 1, message: "denied" });
    await p;
    expect(useLocation.getState().canRetryPrecisely).toBe(false);
  });

  it("names an insecure origin instead of reporting a timeout", async () => {
    stubGeo({ secure: false });
    const { useLocation, isSecureOrigin } = await freshStore();
    expect(isSecureOrigin()).toBe(false);
    await useLocation.getState().requestLive();
    const s = useLocation.getState();
    expect(s.errorKind).toBe("insecure");
    expect(s.error).toMatch(/https|localhost/i);
    // Nothing was even attempted.
    expect(seen).toHaveLength(0);
  });

  it("reports an unsupported browser without attempting", async () => {
    stubGeo({ supported: false });
    const { useLocation, geolocationSupported } = await freshStore();
    expect(geolocationSupported()).toBe(false);
    await useLocation.getState().requestLive();
    expect(useLocation.getState().errorKind).toBe("unsupported");
    expect(seen).toHaveLength(0);
  });

  it("does not hang when the browser never calls back", async () => {
    vi.useFakeTimers();
    stubGeo();
    const { useLocation } = await freshStore();
    void useLocation.getState().requestLive();
    expect(useLocation.getState().stage).toBe("prompting");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(useLocation.getState().stage).toBe("error");
    expect(useLocation.getState().errorKind).toBe("timeout");
  });
});

describe("reverse geocoding never blocks the fix", () => {
  it("keeps the coordinates when the name lookup fails", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive();
    handler?.ok(MUMBAI_FIX);
    await p;
    const s = useLocation.getState();
    expect(s.place).toMatchObject({ lat: 19.076, lon: 72.8777 });
    expect(s.stage).toBe("ready");
    expect(s.errorKind).toBe("naming");
    expect(s.place?.name).toBe("Current location");
    // And it was still persisted, so the coordinates are not lost.
    expect(stored()?.place).toMatchObject({ lat: 19.076, lon: 72.8777 });
  });
});

describe("only the latest attempt may publish", () => {
  it("discards a slow first fix when a second has already landed", async () => {
    const { useLocation } = await freshStore();
    const first = useLocation.getState().requestLive();
    const firstHandler = handler;
    const second = useLocation.getState().requestLive();

    // The newer attempt succeeds first, then the stale one reports late.
    handler?.ok(DELHI_FIX);
    await second;
    firstHandler?.ok(MUMBAI_FIX);
    await first;

    expect(useLocation.getState().place?.lat).toBe(28.6519);
  });

  it("a manual choice supersedes an attempt still in flight", async () => {
    const { useLocation } = await freshStore();
    const p = useLocation.getState().requestLive();
    useLocation.getState().selectPlace({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 });
    handler?.ok(MUMBAI_FIX);
    await p;
    expect(useLocation.getState().mode).toBe("selected");
    expect(useLocation.getState().place?.name).toBe("Pune");
  });
});

describe("persistence", () => {
  it("round-trips a selected place and its mode", async () => {
    const { useLocation } = await freshStore();
    useLocation.getState().selectPlace({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 });
    expect(stored()).toMatchObject({ mode: "selected" });

    const next = await freshStore();
    next.useLocation.getState().hydrate();
    expect(next.useLocation.getState().place?.name).toBe("Pune");
    expect(next.useLocation.getState().mode).toBe("selected");
  });

  it("never persists a demo location as the user's own", async () => {
    const { useLocation } = await freshStore();
    useLocation.getState().selectPlace({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 });
    // A scenario resolves the sky to Kochi without touching the store.
    expect(effectiveLocation(useLocation.getState().place, "fog")).toBe(DEMO_LOCATION);
    expect(stored()?.place.name).toBe("Pune");
    expect(JSON.stringify(stored())).not.toMatch(/"demo"/);
  });

  it("keeps the last valid place when a later attempt fails", async () => {
    const { useLocation } = await freshStore();
    useLocation.getState().selectPlace({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 });
    const p = useLocation.getState().requestLive();
    handler?.err({ code: 2, message: "unavailable" });
    await p;
    expect(useLocation.getState().place?.name).toBe("Pune");
    expect(useLocation.getState().stage).toBe("error");
  });

  it("ignores a corrupted stored place", async () => {
    localStorage.setItem("mausam.location.v1", JSON.stringify({ mode: "live", place: { name: "X" } }));
    const { useLocation } = await freshStore();
    useLocation.getState().hydrate();
    expect(useLocation.getState().place).toBeNull();
  });

  it("switches back from live to the last selected place", async () => {
    const { useLocation } = await freshStore();
    useLocation.getState().selectPlace({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 });
    const p = useLocation.getState().requestLive();
    handler?.ok(MUMBAI_FIX);
    await p;
    expect(useLocation.getState().mode).toBe("live");

    useLocation.getState().useSelected();
    expect(useLocation.getState().mode).toBe("selected");
    expect(useLocation.getState().place?.name).toBe("Pune");
  });
});
