import { useCallback, useEffect, useRef } from "react";
import type { WeatherState } from "../domain/weather";
import { Ambience } from "./ambience";

/**
 * Binds the ambience engine to the weather state and exposes a gesture-safe
 * toggle.
 *
 * The AudioContext may only be created or resumed inside a real user gesture,
 * so the toggle is imperative and must be called straight from the click
 * handler. An effect cannot do it, which is why this returns a function instead
 * of watching a boolean.
 */
export function useAmbience(state: WeatherState): {
  toggle: (on: boolean) => void;
  setState: (s: WeatherState) => void;
} {
  const ref = useRef<Ambience | null>(null);
  if (!ref.current) ref.current = new Ambience();

  const toggle = useCallback((on: boolean) => {
    const engine = ref.current!;
    if (on) {
      void engine.start().then(() => {
        engine.setState(state);
        engine.setVolume(1);
      });
    } else {
      engine.stop();
    }
  }, [state]);

  const setState = useCallback((s: WeatherState) => {
    ref.current?.setState(s);
  }, []);

  useEffect(() => {
    ref.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const engine = ref.current!;
    return () => engine.dispose();
  }, []);

  return { toggle, setState };
}
