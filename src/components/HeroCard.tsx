import { useCallback, useEffect, useRef, useState } from "react";
import { Droplets, Eye, Thermometer, Wind, Zap } from "lucide-react";
import type { HourSample, NormalizedForecast } from "../domain/weather";
import { deriveState, STATE_LABEL } from "../domain/taxonomy";
import { sampleAt } from "../domain/decision";
import { formatClock, formatTemp } from "../lib/utils";
import { HourGlyph, StateIcon } from "./icons";

/**
 * Current conditions. This is the top of the visual hierarchy, so it carries
 * the largest type on the page and no container at all — it sits directly on
 * the weather, separated by space rather than by a border.
 */
export function HeroCard({
  forecast,
  nowMin,
  name,
}: {
  forecast: NormalizedForecast;
  nowMin: number;
  name: string;
}) {
  const s = sampleAt(forecast, nowMin);
  const state = deriveState(s.code, s.isDay);

  const temps = forecast.hourly.map((h) => h.tempC);
  const hi = Math.max(...temps);
  const lo = Math.min(...temps);

  /* Derived from nowMin with plain arithmetic. Routing this through
     `new Date(nowMin * 60000).getHours()` would read the hour in the *device's*
     timezone, so a viewer in UTC saw "Good morning" for a 9:40 PM Kerala sky. */
  const hour24 = Math.floor((((nowMin % 1440) + 1440) % 1440) / 60);
  const greeting =
    hour24 < 12 ? "Good morning" : hour24 < 17 ? "Good afternoon" : "Good evening";

  /* Only the factors that are actually notable. A row of six icons regardless
     of conditions is noise; two or three real ones is information.

     Rain gets two distinct phrasings because the two facts are different. A
     probability is a forecast about the coming hour, and it only exists on the
     hourly grid. When the now-sample is the provider's observation there is no
     probability at all — but there is measured rain, which is a stronger fact
     and must not be reported as silence. */
  const notes: Array<{ icon: React.ReactNode; text: string }> = [];
  if (s.precipProb > 0.15) {
    notes.push({ icon: <Droplets size={14} />, text: `${Math.round(s.precipProb * 100)}% rain` });
  } else if (s.precipMm > 0) {
    notes.push({ icon: <Droplets size={14} />, text: "Raining now" });
  }
  if (s.gustKph >= 20) {
    notes.push({ icon: <Wind size={14} />, text: `${Math.round(s.gustKph)} km/h gusts` });
  }
  if (s.visibilityKm < 8) {
    notes.push({ icon: <Eye size={14} />, text: `${s.visibilityKm.toFixed(1)} km visibility` });
  }
  if (s.thunderProb > 0.2) {
    notes.push({ icon: <Zap size={14} />, text: "Lightning risk" });
  }
  if (s.feelsC >= 35) {
    notes.push({ icon: <Thermometer size={14} />, text: "Heat stress" });
  }

  return (
    <header className="pt-3">
      <p className="text-[14px] text-[var(--ink-soft)]">
        {greeting}, {name}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex items-start">
          <span
            data-obs-temp
            data-obs-temp-c={s.tempC}
            className="text-[92px] font-light leading-[0.82] tracking-[-0.045em] tabular-nums"
          >
            {formatTemp(s.tempC)}
          </span>
          <span className="ml-1 mt-2.5 text-[26px] font-light text-[var(--ink-soft)]">°</span>
        </div>
        <StateIcon state={state} size={54} className="mb-5 shrink-0 text-[var(--wx-accent)]" />
      </div>

      <div className="mt-3 flex items-baseline gap-2.5">
        <p className="text-[19px] font-medium tracking-tight">{STATE_LABEL[state]}</p>
        <p className="text-[13.5px] text-[var(--ink-soft)]">
          Feels {formatTemp(s.feelsC)}° · H {formatTemp(hi)}° L {formatTemp(lo)}°
        </p>
      </div>

      {notes.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-[var(--ink-soft)]">
          {notes.map((n) => (
            <li key={n.text} className="inline-flex items-center gap-1.5">
              <span className="text-[var(--wx-accent)]">{n.icon}</span>
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/**
 * Supporting information, not a card grid. Hours read as a quiet row of ticks
 * with the current one emphasised; only the "now" column gets a surface.
 */
export function WindowStrip({
  forecast,
  nowMin,
  from = 0,
  count = 12,
}: {
  forecast: NormalizedForecast;
  nowMin: number;
  from?: number;
  count?: number;
}) {
  const startH = Math.floor(nowMin / 60);
  const hours: HourSample[] = Array.from({ length: count }, (_, i) =>
    sampleAt(forecast, (startH + from + i) * 60),
  );

  /* The strip scrolls sideways, and a row that simply stops at the frame edge
     reads as the end of the forecast rather than as more of it. Track which
     edges still have content so a fade can be drawn only where there is
     something to scroll towards, and so the last hour can come fully clear of
     the frame instead of being sliced in half. */
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    /* 1px slack absorbs sub-pixel layout so a settled strip does not report a
       phantom pixel of overflow. */
    const slack = 1;
    setEdges({
      left: el.scrollLeft > slack,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - slack,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, hours.length, forecast]);

  const mask = edges.left
    ? edges.right
      ? "linear-gradient(to right, transparent 0, #000 20px, #000 calc(100% - 36px), transparent 100%)"
      : "linear-gradient(to right, transparent 0, #000 20px, #000 100%)"
    : edges.right
      ? "linear-gradient(to right, #000 0, #000 calc(100% - 36px), transparent 100%)"
      : undefined;

  return (
    <div className="-mx-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      ref={scroller}
      onScroll={measure}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {/* Left inset comes from padding, but the trailing clearance is an
          explicit spacer: right padding on a flex row inside an overflow
          container is not reliably counted in the scroll extent, which left the
          final hour sitting flush against the frame when scrolled fully right. */}
      <div className="flex gap-1 pl-5">
        {hours.map((h, i) => {
          const isNow = i === 0;
          const wet = h.precipProb > 0.3 || h.precipMm > 0.1;
          return (
            <div
              key={i}
              className={
                "flex w-[52px] shrink-0 flex-col items-center gap-1.5 rounded-[14px] py-2.5 " +
                // Only the current hour is given a surface; the rest are just type.
                (isNow ? "bg-white/[0.13] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]" : "")
              }
            >
              <span
                className={
                  "text-[10.5px] tabular-nums " +
                  (isNow ? "font-semibold text-white" : "text-[var(--ink-faint)]")
                }
              >
                {isNow ? "Now" : formatClock(h.hour * 60).replace(" ", "")}
              </span>
              <span className={isNow ? "text-white" : "text-[var(--ink-soft)]"}>
                <HourGlyph sample={h} size={17} />
              </span>
              <span className="text-[13.5px] font-medium tabular-nums">{formatTemp(h.tempC)}°</span>
              <span
                className={
                  "text-[10.5px] tabular-nums " +
                  (wet ? "font-semibold text-[var(--wx-accent)]" : "text-[var(--ink-faint)]")
                }
              >
                {h.precipProb > 0.05 ? `${Math.round(h.precipProb * 100)}%` : "·"}
              </span>
            </div>
          );
        })}
        <div aria-hidden className="w-5 shrink-0" />
      </div>
    </div>
  );
}
