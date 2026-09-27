/* Pure domain types. No React, no DOM, no network. */

/** Canonical condition, independent of any provider's vocabulary. */
export type WxCode =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy_rain"
  | "thunder";

/** The six states the product renders. "night" is time-derived, not code-derived. */
export type WeatherState = "sunny" | "cloudy" | "rain" | "thunderstorm" | "fog" | "night";

export type TravelMode = "walk" | "bike" | "auto" | "car";

export interface GeoLocation {
  name: string;
  admin: string;
  lat: number;
  lon: number;
  /** IANA timezone identifier, e.g. "Asia/Kolkata". */
  timezone?: string;
}

export interface HourSample {
  /** Epoch milliseconds. */
  t: number;
  /** Local hour 0-23, for diurnal logic and copy. */
  hour: number;
  tempC: number;
  feelsC: number;
  /** mm per hour. */
  precipMm: number;
  /** 0..1 */
  precipProb: number;
  windKph: number;
  gustKph: number;
  /** 0..1 */
  cloudCover: number;
  visibilityKm: number;
  uvIndex: number;
  code: WxCode;
  isDay: boolean;
  /** 0..1 — probability of lightning in this hour. */
  thunderProb: number;
  /**
   * Relative humidity, percent, as reported by the provider.
   *
   * Optional on purpose. Every field above has been part of the normalized
   * contract since the app began; these were added later, and a sample that
   * predates them — a cached forecast, a scenario fixture, a test double — is
   * still a valid sample. Consumers must treat `undefined` as "this source did
   * not report it" and render an explicit absence, never a zero.
   */
  humidityPct?: number;
  /** Volumetric soil moisture, 0..1. A model estimate, not a field reading. */
  soilMoisture?: number;
}

/** Daily aggregates, used for totals that no single hour can express. */
export interface DailySummary {
  /** Total rainfall for the day, millimetres. */
  precipitationSumMm?: number;
  /** Hours with measurable rainfall. */
  precipitationHours?: number;
}

export type DataSource = "open-meteo" | "mock" | "imd";

export interface NormalizedForecast {
  location: GeoLocation;
  /** Minutes to add to UTC for local time at this location. */
  tzOffsetMin: number;
  /** IANA timezone identifier from the provider, e.g. "Asia/Kolkata". */
  timezone: string;
  fetchedAt: number;
  source: DataSource;
  /**
   * The provider's own "right now" observation, when it publishes one.
   * This is the only value that is an observation rather than a forecast; the
   * hourly grid is modelled forward in time. `null` for generated data.
   */
  current: HourSample | null;
  hourly: HourSample[];
  sunriseMin: number;
  sunsetMin: number;
  /** Optional daily aggregates. Absent when the source supplies no daily block. */
  daily?: DailySummary;
}

/**
 * Per-user-weighted view of weather. This is the mechanism that makes
 * personalization arithmetic rather than a string template: the same forecast
 * produces a different severity for a pedestrian and a motorcyclist.
 */
export interface ExposureVector {
  precip: number;
  wind: number;
  heat: number;
  lowVis: number;
  thunder: number;
}

export type SensitivityKey = keyof ExposureVector;
