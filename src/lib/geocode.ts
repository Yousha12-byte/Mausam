import type { GeoLocation } from "../domain/weather";
import { isUsable, shortAdmin } from "../domain/location";

/* Two keyless, CORS-enabled services. A client-only PWA cannot hold an API key,
   so both are chosen to work from the browser with nothing behind them:
   Open-Meteo's own geocoder for place search, and BigDataCloud's
   reverse-geocode-client for turning coordinates into a name. Open-Meteo has no
   reverse endpoint, and the IANA timezone it returns with `timezone=auto` is far
   too coarse to name a place — Kochi and Thrissur are both Asia/Kolkata. */

const SEARCH = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const TIMEOUT_MS = 9000;

export interface PlaceResult extends GeoLocation {
  country: string;
  countryCode: string;
  population?: number;
}

interface OmPlace {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
  /** IANA identifier, e.g. "Asia/Kolkata". Carried through so the weather
      request can be made against the place's own timezone. */
  timezone?: string;
}

/**
 * Indian results first, then by population. This only orders the list — an
 * international match is never hidden, because "Pune" and "Delhi" and "Kochi"
 * all have legitimate results on other continents and the user may be there.
 *
 * For a handful of highly ambiguous names the most famous match is preferred.
 * `query` is threaded through explicitly rather than read from ambient state:
 * a module-level "last query" variable is wrong the moment two searches are in
 * flight, and the ranking would then silently apply one query's preference to
 * another's results.
 */
const WELL_KNOWN: Record<string, string> = {
  "manali": "Himachal Pradesh",
  "delhi": "Delhi",
  "mumbai": "Maharashtra",
  "bangalore": "Karnataka",
  "pune": "Maharashtra",
  "hyderabad": "Telangana",
  "chennai": "Tamil Nadu",
  "kolkata": "West Bengal",
};

function rank(a: PlaceResult, b: PlaceResult, query: string): number {
  const inA = a.countryCode === "IN" ? 0 : 1;
  const inB = b.countryCode === "IN" ? 0 : 1;
  if (inA !== inB) return inA - inB;

  const wellKnown = WELL_KNOWN[query.trim().toLowerCase()];
  if (wellKnown) {
    const aMatch = a.admin === wellKnown ? 0 : 1;
    const bMatch = b.admin === wellKnown ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
  }

  return (b.population ?? 0) - (a.population ?? 0);
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url =
    `${SEARCH}?name=${encodeURIComponent(q)}` +
    `&count=8&language=en&format=json`;

  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const body = (await res.json()) as { results?: OmPlace[] };

  const out: PlaceResult[] = [];
  for (const r of body.results ?? []) {
    if (r.name == null || r.latitude == null || r.longitude == null) continue;
    const place: PlaceResult = {
      name: r.name,
      admin: r.admin1 ?? "",
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
      country: r.country ?? "",
      countryCode: r.country_code ?? "",
      population: typeof r.population === "number" ? r.population : undefined,
    };
    if (isUsable(place)) out.push(place);
  }
  return out.sort((a, b) => rank(a, b, q));
}

interface BdcPlace {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
  countryCode?: string;
}

/**
 * Coordinates to a place name. Name resolution walks outwards because the
 * service legitimately returns nothing at the city level for rural
 * coordinates, an offshore point, or somewhere inside a national park.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<GeoLocation> {
  const url =
    `${REVERSE}?latitude=${lat}&longitude=${lon}` +
    `&localityLanguage=en`;

  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Reverse lookup failed (${res.status})`);
  const d = (await res.json()) as BdcPlace;

  const name =
    d.city?.trim() ||
    d.locality?.trim() ||
    d.principalSubdivision?.trim() ||
    d.countryName?.trim();

  if (!name) {
    // Coordinates are still perfectly usable for weather; only the label is
    // missing. Say so rather than inventing a place.
    return { name: "Current location", admin: "", lat, lon };
  }

  return {
    name,
    admin: d.principalSubdivision?.trim() ?? "",
    lat,
    lon,
  };
}

/** Header line for a searched result, e.g. "Mumbai · Maharashtra". */
export function placeSubtitle(p: PlaceResult): string {
  const admin = shortAdmin(p.admin);
  if (p.country && admin) return `${admin} · ${p.country}`;
  return p.country || admin;
}
