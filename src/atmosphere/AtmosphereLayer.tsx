import type { WeatherState } from "../domain/weather";
import { SkyCanvas } from "./SkyCanvas";
import { PrecipitationCanvas } from "./PrecipitationCanvas";

/**
 * The weather world itself, and the only thing that renders it.
 *
 * This layer is absolutely positioned inside the app viewport and clipped to
 * it, so the sky, clouds, rain and fog belong to the *application* rather than
 * sitting behind it. On a projector that makes the distinction legible: outside
 * the viewport is a neutral stage, inside it is Mausam's weather.
 */
export function AtmosphereLayer({
  state,
  motion,
}: {
  state: WeatherState;
  motion: boolean;
}) {
  return (
    <div className="wx-world" data-wx={state} aria-hidden>
      <div className="wx-sky" data-wx={state} />
      <div className="wx-haze" data-wx={state} />
      <SkyCanvas motion={motion} />
      <PrecipitationCanvas motion={motion} />
      {/* Legibility veil. Weighted to the top and the foot of the frame where
          type sits, and left almost clear through the middle so the weather
          stays visible behind the content. */}
      <div className="wx-veil" data-wx={state} />
    </div>
  );
}
