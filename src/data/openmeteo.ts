import type { GeoLocation, HourSample, NormalizedForecast } from "../domain/weather";
import type { WeatherProvider } from "./provider";
import { fromWmoCode } from "../domain/taxonomy";

/* Open-Meteo is the live source: no API key, CORS-enabled, and it exposes
   visibility and cloud cover — both of which the atmosphere engine needs. */

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "soil_moisture_0_to_1cm",
  "precipitation",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "visibility",
  "uv_index",
  "weather_code",
  "is_day",
].join(",");

/* The hourly grid is a forecast: its "current" entry is the centre of an hour
   that has partly elapsed, so reading it as conditions right now is an
   approximation that drifts by up to 30 minutes. The `current` block is the
   provider's actual observation for this instant, and every field in it comes
   from one place, which is what keeps temperature, code and precipitation
   describing the same moment. */
const CURRENT = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "visibility",
  "uv_index",
  "weather_code",
  "is_day",
].join(",");

/** Identity of a live request: coordinates, provider and the exact variable set. */
export const OM_REQUEST_SHAPE = `hourly=${HOURLY}&current=${CURRENT}`;

/**
 * Open-Meteo answers with *naive* local timestamps when `timezone=auto` is
 * used ("2026-09-26T14:00", no offset). `Date.parse` reads a string without an
 * offset as device-local time, so the resulting epoch was off by
 * (location offset - device offset) — harmless only while nothing compared
 * timestamps, and wrong the moment anything does. The response carries
 * `utc_offset_seconds`, so subtracting it yields the true instant.
 */
export function isoLocalToEpoch(iso: string, tzOffsetMin: number): number {
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso) ? `${iso}:00` : iso;
  return Date.parse(`${withSeconds}Z`) - tzOffsetMin * 60_000;
}

/** The exact live request, exposed so the coordinates can be asserted in tests. */
export function omForecastUrl(location: GeoLocation): string {
  return (
    `${ENDPOINT}?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=${HOURLY}&current=${CURRENT}&daily=sunrise,sunset&timezone=auto&forecast_days=2`
  );
}

interface OmCurrent {
  time: string;
  temperature_2m?: number | null;
  apparent_temperature?: number | null;
  precipitation?: number | null;
  wind_speed_10m?: number | null;
  wind_gusts_10m?: number | null;
  cloud_cover?: number | null;
  visibility?: number | null;
  uv_index?: number | null;
  weather_code?: number | null;
  is_day?: number | null;
}

interface OmResponse {
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  hourly: Record<string, Array<number | null>> & { time: string[] };
  current?: OmCurrent;
  daily?: { sunrise: string[]; sunset: string[] };
}

function clockOf(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function col(r: OmResponse, key: string, i: number, fallback = 0): number {
  const v = r.hourly[key]?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * An optional capability reading: undefined when the column is missing or null.
 *
 * Distinct from `col`, which substitutes 0. For humidity or soil moisture a 0
 * is a claim about the world rather than a gap in the data, and "Humidity 0%"
 * is exactly the kind of plausible-looking nonsense this app should never show.
 */
function opt(
  source: { hourly?: Record<string, (number | null)[] | undefined> } | undefined,
  key: string,
  i: number,
): number | undefined {
  const v = source?.hourly?.[key]?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Same, for a `current` block, which carries fields directly. */
function optField(source: object | undefined, key: string): number | undefined {
  const v = (source as Record<string, number | null | undefined> | undefined)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function thunderProbOf(code: number): number {
  return code >= 95 ? 0.9 : code >= 80 ? 0.05 : 0;
}

export async function fetchOpenMeteo(
  location: GeoLocation,
  at: number,
): Promise<NormalizedForecast> {
  const res = await fetch(omForecastUrl(location), { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
  const r = (await res.json()) as OmResponse;

  const times = r.hourly.time ?? [];
  const tzOffsetMin = Math.round((r.utc_offset_seconds ?? 19800) / 60);
  const timezone = r.timezone ?? "UTC";

  const hourly = times.map((iso, i) => {
    const code = col(r, "weather_code", i);
    const isDay = col(r, "is_day", i, 1) === 1;
    const precipMm = col(r, "precipitation", i);
    return {
      t: isoLocalToEpoch(iso, tzOffsetMin),
      hour: Number(iso.slice(11, 13)),
      tempC: col(r, "temperature_2m", i),
      feelsC: col(r, "apparent_temperature", i),
      // Open-Meteo reports precipitation_probability as a percentage.
      precipProb: col(r, "precipitation_probability", i) / 100,
      precipMm,
      windKph: col(r, "wind_speed_10m", i),
      gustKph: col(r, "wind_gusts_10m", i),
      cloudCover: col(r, "cloud_cover", i) / 100,
      // Open-Meteo reports visibility in metres.
      visibilityKm: col(r, "visibility", i, 20000) / 1000,
      uvIndex: col(r, "uv_index", i),
      code: fromWmoCode(code),
      isDay,
      thunderProb: thunderProbOf(code),
      // Optional capability fields. Left undefined when the column is absent so
      // a thinner response yields "Unavailable" rather than a zero.
      humidityPct: opt(r, "relative_humidity_2m", i),
      soilMoisture: opt(r, "soil_moisture_0_to_1cm", i),
    };
  });

  /* One observation, one instant. Every field below comes out of the same
     `current` object, so the displayed temperature can never disagree with the
     displayed condition. */
  const c = r.current;
  const current: HourSample | null = c?.time
    ? (() => {
        const code = num(c.weather_code);
        return {
          t: isoLocalToEpoch(c.time, tzOffsetMin),
          hour: Number(c.time.slice(11, 13)),
          tempC: num(c.temperature_2m),
          feelsC: num(c.apparent_temperature),
          precipMm: num(c.precipitation),
          // `current` does not publish precipitation_probability; a real
          // probability is a forecast product, so this stays unknown (0) rather
          // than being invented from the observed rain amount.
          precipProb: 0,
          windKph: num(c.wind_speed_10m),
          gustKph: num(c.wind_gusts_10m),
          cloudCover: num(c.cloud_cover) / 100,
          visibilityKm: num(c.visibility, 20000) / 1000,
          uvIndex: num(c.uv_index),
          code: fromWmoCode(code),
          isDay: num(c.is_day, 1) === 1,
          thunderProb: thunderProbOf(code),
          // Humidity is observed, so it belongs here. Soil moisture is a
          // numerical-model field with no observation product, so it is
          // deliberately absent from `current` — the "now" row must not present
          // a modelled value as though it were measured.
          humidityPct: optField(c, "relative_humidity_2m"),
        };
      })()
    : null;

  const sunriseMin = r.daily?.sunrise?.[0] ? clockOf(r.daily.sunrise[0]) : 360;
  const sunsetMin = r.daily?.sunset?.[0] ? clockOf(r.daily.sunset[0]) : 1080;

  return {
    location: { ...location, timezone },
    tzOffsetMin,
    timezone,
    fetchedAt: at,
    source: "open-meteo",
    current,
    hourly,
    sunriseMin,
    sunsetMin,
  };
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  label: "Live · Open-Meteo",
  live: true,
  getForecast: fetchOpenMeteo,
};
