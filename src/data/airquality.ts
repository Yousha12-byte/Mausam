import type { GeoLocation } from "../domain/weather";
import { isoLocalToEpoch } from "./openmeteo";

/* ============================================================ AIR QUALITY ===

   A separate capability, on a separate host, with a separate failure mode.

   Everything about this file is shaped by one rule from the product side: a
   failure here must be invisible to the rest of the app. The forecast endpoint
   and the air-quality endpoint share nothing — different host, different
   variable set, different response shape — and this module shares nothing with
   the weather provider either. It is not a fallback chain, it is not a field on
   `HourSample`, and it is not consulted by the weather store. The only thing
   that joins the two is the UI, at render time, and it joins them by
   *absence-tolerant* read: `status !== "ready"` means the row does not exist.

   That separation is what makes the two failure states independently
   expressible, which is the whole point: "the weather is fine but we have no
   air-quality reading" is a real and common state, and it is not the same
   statement as "the forecast failed". */

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";

/* The air-quality API has no `current` block — there is no observation product
   here, only modelled hourly values. So "now" is always the nearest hourly
   entry, and the app says so rather than implying a live reading. */
const HOURLY = ["us_aqi", "pm2_5", "pm10", "ozone", "european_aqi"].join(",");

export const AQ_REQUEST_SHAPE = `hourly=${HOURLY}`;

export interface AqiSample {
  /** Epoch ms, resolved against the location's timezone. */
  t: number;
  /** US AQI, the scale the interface speaks in. */
  usAqi: number;
  pm25?: number;
  pm10?: number;
  ozone?: number;
}

export type AqiStatus = "idle" | "loading" | "ready" | "unavailable";

export interface AirQuality {
  status: AqiStatus;
  samples: AqiSample[];
  /**
   * The US AQI nearest to `localMin`, or null when there is none.
   *
   * Null is a real answer meaning "we do not have a reading for this moment" —
   * it is deliberately not 0, which would render as the cleanest air on Earth.
   */
  usAqiAt: (localMin: number) => number | null;
  /** Set only when `status === "unavailable"`. Never shown as a substitute value. */
  reason?: string;
  /** When the underlying request was issued, for the debug panel. */
  fetchedAtMin?: number;
  /** Location timezone offset, used to resolve local minutes. */
  tzOffsetMin?: number;
}

const EMPTY: AirQuality = {
  status: "idle",
  samples: [],
  usAqiAt: () => null,
};

export const idleAirQuality = (): AirQuality => ({ ...EMPTY, samples: [], usAqiAt: () => null });

/**
 * Resolve `localMin` to an epoch, using the series' own first entry as the
 * anchor. The forecast has `localMinToEpoch` for this, but importing it would
 * mean depending on the weather forecast — and the whole point of this module
 * is that it works when the forecast does not. So the anchor is local, and
 * self-contained.
 */
function epochFor(
  samples: readonly AqiSample[],
  offsetMin: number,
  localMin: number,
): number | null {
  const first = samples[0];
  if (!first) return null;
  const firstLocal = new Date(first.t + offsetMin * 60_000);
  const firstMin = firstLocal.getUTCHours() * 60 + firstLocal.getUTCMinutes();
  const day = Math.floor(localMin / 1440);
  const m = ((localMin % 1440) + 1440) % 1440;
  return first.t + (day * 1440 + m - firstMin) * 60_000;
}

function at(localMin: number, samples: AqiSample[], offsetMin: number): number | null {
  if (samples.length === 0) return null;
  const target = epochFor(samples, offsetMin, localMin);
  if (target === null) return null;

  let best: AqiSample | null = null;
  let bestDist = Infinity;
  for (const s of samples) {
    const dist = Math.abs(s.t - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  // One hour of slack. Beyond that the series has run out and the honest answer
  // is "no reading", not the last value we happened to receive.
  return best && bestDist <= 60 * 60_000 ? best.usAqi : null;
}

export function airQualityUrl(loc: GeoLocation): string {
  const p = new URLSearchParams({
    latitude: loc.lat.toFixed(3),
    longitude: loc.lon.toFixed(3),
    hourly: HOURLY,
    timezone: "auto",
    forecast_days: "2",
  });
  return `${ENDPOINT}?${p.toString()}`;
}

interface OmAirResponse {
  hourly?: { time?: string[]; us_aqi?: (number | null)[]; pm2_5?: (number | null)[]; pm10?: (number | null)[]; ozone?: (number | null)[] };
  utc_offset_seconds?: number;
  error?: boolean;
  reason?: string;
}

/**
 * Fetch air quality. Resolves to `unavailable` on any problem — network, HTTP,
 * malformed payload, empty series — and never throws.
 *
 * The absence of a throw is the contract. Callers cannot accidentally let this
 * reject into a render path, which is how "AQI broke the homepage" would
 * otherwise happen.
 */
export async function loadAirQuality(
  loc: GeoLocation,
  signal?: AbortSignal,
): Promise<AirQuality> {
  try {
    const res = await fetch(airQualityUrl(loc), { signal });
    if (!res.ok) return unavailable(`HTTP ${res.status}`);

    const json = (await res.json()) as OmAirResponse;
    const offsetMin = (json.utc_offset_seconds ?? 0) / 60;
    const times = json.hourly?.time ?? [];
    const aqi = json.hourly?.us_aqi ?? [];

    const samples: AqiSample[] = [];
    for (let i = 0; i < times.length; i++) {
      const v = aqi[i];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      samples.push({
        t: isoLocalToEpoch(times[i]!, offsetMin),
        usAqi: v,
        pm25: num(json.hourly?.pm2_5?.[i]),
        pm10: num(json.hourly?.pm10?.[i]),
        ozone: num(json.hourly?.ozone?.[i]),
      });
    }

    if (samples.length === 0) return unavailable(json.reason ?? "no air-quality data returned");

    return {
      status: "ready",
      samples,
      usAqiAt: (localMin) => at(localMin, samples, offsetMin),
      fetchedAtMin: Date.now(),
      tzOffsetMin: offsetMin,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return idleAirQuality();
    return unavailable("network error");
  }
}

function unavailable(reason: string): AirQuality {
  return { status: "unavailable", samples: [], usAqiAt: () => null, reason };
}

function num(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
