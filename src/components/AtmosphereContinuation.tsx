import { continuation } from "../lib/continuation";
import type { NormalizedForecast, WeatherState } from "../domain/weather";

/**
 * The bottom of the homepage.
 *
 * The page used to stop after the hours strip and leave the rest of the
 * viewport to the background, which read as a layout that had run out of things
 * to say. This closes the composition: a hairline that fades out at both ends
 * (a separator, not a container) and one line about what the sky does next.
 *
 * There is no surface, no border and no icon. It is set in the same quiet type
 * as the section labels above it, because it is a continuation of the forecast
 * and not a new component. When there is nothing honest to say the whole region
 * collapses, leaving the atmosphere to finish the page on its own.
 */
export function AtmosphereContinuation({
  forecast,
  nowMin,
  state,
}: {
  forecast: NormalizedForecast;
  nowMin: number;
  state: WeatherState;
}) {
  const c = continuation(forecast, nowMin, state);
  if (!c) return null;

  return (
    <div
      data-wx-continuation
      className="relative shrink-0 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4"
    >
      {/* The horizon glow puts real light in the lower third, which is the point
          of it, but it also lifts the background under this line. A soft
          settling shadow in the last few centimetres guarantees the text a floor
          without putting a panel back into the layout. It reads as the bottom of
          the frame falling into shadow, and it is the one place the page is
          allowed to be quieter than the sky above it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -top-28"
        style={{
          background:
            "linear-gradient(to top, rgb(3 7 14 / 0.34), rgb(3 7 14 / 0.16) 42%, rgb(3 7 14 / 0))",
        }}
      />
      <div className="relative">
        {/* Fades at both ends so the rule reads as the page continuing off-frame
            rather than as the top edge of a box. */}
        <div
          aria-hidden
          className="h-px w-full"
          style={{
            background:
              "linear-gradient(to right, transparent, var(--line-soft) 18%, var(--line-soft) 82%, transparent)",
          }}
        />
        <p className="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
          {c.label}
        </p>
        <p className="mt-1 text-[15px] leading-snug tracking-tight text-[var(--ink-soft)]">
          {c.line}
        </p>
      </div>
    </div>
  );
}

