export function clamp(n: number, min = 0, max = 1): number {
  return n < min ? min : n > max ? max : n;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map a value from one range to another, clamped. */
export function remap(
  n: number,
  inMin: number,
  inMax: number,
  outMin = 0,
  outMax = 1,
): number {
  if (inMax === inMin) return outMin;
  return clamp(lerp(outMin, outMax, (n - inMin) / (inMax - inMin)));
}

export function smoothstep(t: number): number {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** "17:30" or "5:30 PM" from minutes-since-midnight. */
export function formatClock(minutes: number, use24h = false): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (use24h) return `${String(h24).padStart(2, "0")}:${mm}`;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "in 25 min" / "now" — relative phrasing used in decision copy. */
export function relativeFromNow(targetMin: number, nowMin: number): string {
  const d = Math.round(targetMin - nowMin);
  if (d === 0) return "now";
  if (d > 0) {
    if (d < 60) return `in ${d} min`;
    const h = Math.floor(d / 60);
    const m = d % 60;
    return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
  }
  const a = Math.abs(d);
  if (a < 60) return `${a} min ago`;
  const h = Math.floor(a / 60);
  const m = a % 60;
  return m === 0 ? `${h} hr ago` : `${h} hr ${m} min ago`;
}

export function formatTemp(c: number, unit: "C" | "F" = "C"): string {
  return String(unit === "F" ? Math.round(c * 1.8 + 32) : Math.round(c));
}
