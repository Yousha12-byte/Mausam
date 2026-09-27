/* Simplified solar + lunar position.
   Accurate enough for a correct sun arc and believable twilight, at a fraction
   of the cost of the full NOAA algorithm. */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Degrees above the horizon. Negative means the sun has set. */
  elevation: number;
  /** Compass degrees: 0 = north, 90 = east, 180 = south. */
  azimuth: number;
}

export interface DayTimes {
  sunriseMin: number;
  sunsetMin: number;
}

/** Solar declination for a day of the year. */
function declination(dayOfYear: number): number {
  return 23.44 * Math.sin(RAD * (360 / 365) * (dayOfYear - 81));
}

/** Lunar declination: the moon sweeps the ecliptic over its 29.5-day cycle. */
function moonDeclination(day: number, phase: number): number {
  return 23.44 * Math.sin(RAD * (360 / 365) * (day - 81) + phase * 2 * Math.PI);
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

/**
 * @param hourAngle Hours from local solar noon (negative = before noon).
 */
export function sunPosition(
  lat: number,
  day: number,
  hourAngle: number,
): SunPosition {
  return position(lat, declination(day), hourAngle);
}

function position(lat: number, dec: number, hourAngle: number): SunPosition {
  const H = hourAngle * 15 * RAD;
  const latR = lat * RAD;
  const decR = dec * RAD;

  const sinEl = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const elevation = el * DEG;

  const cosAz =
    (Math.sin(decR) - Math.sin(latR) * sinEl) / (Math.cos(latR) * Math.cos(el));
  // acos gives 0-180 measured from north through east, which is ambiguous:
  // the western half of the sky has to be mirrored back out.
  const azimuth = H > 0 ? 360 - Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG
                         : Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;

  return { elevation, azimuth: (azimuth + 360) % 360 };
}

/** IST standard meridian. Clock noon is not solar noon east or west of 82.5E. */
export const STD_MERIDIAN = 82.5;

export function solarNoonMinutes(lon: number): number {
  return 720 - (lon - STD_MERIDIAN) * 4;
}

/** Hour angle (hours from solar noon) at which the sun crosses the horizon. */
export function sunriseSunset(lat: number, day: number, lon = STD_MERIDIAN): DayTimes {
  const dec = declination(day) * RAD;
  const latR = lat * RAD;
  const cosH = -Math.tan(latR) * Math.tan(dec);

  const noon = solarNoonMinutes(lon);
  if (cosH <= -1) return { sunriseMin: 0, sunsetMin: 1439 }; // polar day
  if (cosH >= 1) return { sunriseMin: noon, sunsetMin: noon }; // polar night

  const H = (Math.acos(cosH) * DEG) / 15;
  return {
    sunriseMin: Math.round(noon - H * 60),
    sunsetMin: Math.round(noon + H * 60),
  };
}

/* ------------------------------------------------------------------- MOON */

/** Days since the last new moon (2000-01-06 18:14 UTC). */
const SYNODIC = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0) / 86400000;

/** 0 = new, 0.25 = first quarter, 0.5 = full. */
export function lunarPhase(date: Date): number {
  const days = date.getTime() / 86400000 - NEW_MOON_EPOCH;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
}

export const PHASE_LABEL = [
  "New moon",
  "Waxing crescent",
  "First quarter",
  "Waxing gibbous",
  "Full moon",
  "Waning gibbous",
  "Last quarter",
  "Waning crescent",
] as const;

export function phaseLabel(phase: number): string {
  return PHASE_LABEL[Math.round(phase * 8) % 8] ?? "Moon";
}

/**
 * Approximate moon position. The moon trails the sun through the sky by its
 * phase: at new moon it rises and sets with the sun, at full moon it is
 * opposite. So its hour angle is the sun's shifted by the phase, and it
 * carries its own declination as it sweeps the ecliptic.
 */
export function moonPosition(
  lat: number,
  day: number,
  hourAngle: number,
  date: Date,
): SunPosition {
  const phase = lunarPhase(date);
  // 0 at new moon (moon with the sun), 0.5 at full (moon opposite).
  const moonHourAngle = hourAngle - phase * 24;
  const p = position(lat, moonDeclination(day, phase), moonHourAngle);
  // The ecliptic tilt keeps the moon's daily arc lower and slower than the sun's.
  return { elevation: p.elevation * 0.94, azimuth: p.azimuth };
}
