import type { GeoLocation } from "./weather";

/**
 * Where the weather on screen comes from.
 *
 * `live` and `selected` are the user's real location. `demo` is the fixed
 * presentation location and is never written to storage — a demo must not
 * quietly become someone's real location.
 */
export type LocationMode = "live" | "selected" | "demo";

/**
 * The presentation location. Demo scenarios are pinned here so a demo looks
 * identical on every machine and never reaches for the presenter's GPS.
 */
export const DEMO_LOCATION: GeoLocation = {
  name: "Kochi",
  admin: "Kerala",
  lat: 9.9312,
  lon: 76.2673,
  timezone: "Asia/Kolkata",
};

/**
 * Geocoders return long official subdivision names, and the header has room for
 * roughly one word. Trim the one verbose Indian case instead of letting the
 * line truncate mid-word. Display only — the value is never sent anywhere.
 */
export function shortAdmin(admin: string): string {
  const a = (admin ?? "").trim();
  const nct = /^National Capital Territory of (.+)$/i.exec(a);
  return nct ? nct[1]! : a;
}

/** "Mumbai · Maharashtra" — the header's single line. */
export function formatPlace(place: GeoLocation): string {
  const admin = shortAdmin(place.admin);
  return admin ? `${place.name} · ${admin}` : place.name;
}

/**
 * A place is only usable if it carries coordinates we can actually fetch.
 * Guards storage written by an older build and hand-edited values.
 */
export function isUsable(p: Partial<GeoLocation> | null | undefined): p is GeoLocation {
  if (!p) return false;
  const { lat, lon, name } = p;
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Reads persisted state without trusting it. */
export function coercePlace(raw: unknown): GeoLocation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Partial<GeoLocation>;
  if (!isUsable(p)) return null;
  return {
    name: p.name!.trim(),
    admin: typeof p.admin === "string" ? p.admin : "",
    lat: p.lat!,
    lon: p.lon!,
  };
}

/**
 * The place the sky on screen is actually for. A pinned demo scenario always
 * resolves to Kochi so a presentation is identical everywhere, and never
 * disturbs the user's real location.
 */
export function effectiveLocation(
  realPlace: GeoLocation | null,
  scenarioId: string | null,
): GeoLocation {
  return scenarioId !== null ? DEMO_LOCATION : (realPlace ?? DEMO_LOCATION);
}
