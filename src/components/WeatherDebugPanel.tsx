import { useWeather, currentSample } from "../state/weather-store";
import { useLocation } from "../state/location-store";
import { omForecastUrl } from "../data/openmeteo";
import { describeSource } from "../lib/source";
import { localMinToEpoch } from "../domain/decision";
import { formatClock } from "../lib/utils";

/**
 * Development-only provenance panel.
 *
 * Every field the weather pipeline can disagree about itself on — which
 * coordinates were requested, which timezone the provider named, whether the
 * number on screen is an observation or an interpolation, where the data came
 * from, and what is sitting in the live cache — in one place, so a wrong
 * temperature can be traced to a specific stage instead of guessed at.
 *
 * The `import.meta.env.DEV` guard is what keeps this out of production builds:
 * Vite replaces it with `false` and tree-shakes the branch, along with this
 * module, so no diagnostics ship to users.
 */
export function WeatherDebugPanel() {
  const forecast = useWeather((s) => s.forecast);
  const origin = useWeather((s) => s.origin);
  const scenarioId = useWeather((s) => s.scenarioId);
  const degraded = useWeather((s) => s.degraded);
  const degradedReason = useWeather((s) => s.degradedReason);
  const nowMin = useWeather((s) => s.nowMin);
  const clockOverride = useWeather((s) => s.clockOverride);
  const realPlace = useLocation((s) => s.place);

  if (!forecast) return null;

  const sample = currentSample(forecast, nowMin);
  const note = describeSource({ forecast, origin, degradedReason, nowEpoch: Date.now() });
  const isObservation = forecast.current != null && sample?.t === forecast.current.t;
  const snapCount = (() => {
    try {
      const raw = localStorage.getItem("mausam.snapshots.live.v2");
      return raw ? Object.keys(JSON.parse(raw) as object).length : 0;
    } catch {
      return 0;
    }
  })();

  const rows: Array<[string, string]> = [
    ["mode", scenarioId ? `demo:${scenarioId}` : "live"],
    ["origin", origin],
    ["source label", note.text],
    ["degraded", String(degraded)],
    ["degraded reason", degradedReason ?? "—"],
    ["place (saved)", realPlace ? `${realPlace.name} · ${realPlace.admin}` : "—"],
    ["place (effective)", `${forecast.location.name} · ${forecast.location.admin}`],
    ["coordinates", `${forecast.location.lat.toFixed(4)}, ${forecast.location.lon.toFixed(4)}`],
    ["provider timezone", forecast.timezone],
    ["utc offset (min)", String(forecast.tzOffsetMin)],
    ["clock", `${formatClock(nowMin)}${clockOverride != null ? " (pinned)" : ""}`],
    ["now-sample", sample ? `t=${new Date(sample.t).toISOString()}` : "—"],
    ["now-sample kind", isObservation ? "provider observation" : "interpolated hourly"],
    ["provider current time", forecast.current ? new Date(forecast.current.t).toISOString() : "none"],
    ["sample temp / code", sample ? `${sample.tempC}°C · ${sample.code}` : "—"],
    ["sample precip / wind", sample ? `${sample.precipMm}mm · ${sample.windKph}kph` : "—"],
    ["hourly points", String(forecast.hourly.length)],
    ["fetched at", new Date(forecast.fetchedAt).toISOString()],
    ["live snapshots cached", String(snapCount)],
  ];

  return (
    <section
      aria-label="Weather debug"
      data-debug="weather"
      className="mx-4 mb-4 rounded-[14px] bg-black/45 p-3 font-mono text-[10.5px] leading-tight text-emerald-200/90 backdrop-blur"
    >
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-300/90">
        Weather debug
      </h2>
      <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-emerald-400/70">{k}</dt>
            <dd className="break-all text-emerald-100/90">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 break-all text-emerald-400/60">{omForecastUrl(forecast.location)}</p>
      <p className="mt-1 text-emerald-400/60">
        {origin === "live" || origin === "cached"
          ? `now-sample epoch ${localMinToEpoch(forecast, nowMin)}`
          : "no live request is in play"}
      </p>
    </section>
  );
}
