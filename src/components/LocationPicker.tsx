import { useEffect, useRef, useState } from "react";
import { Crosshair, LocateFixed, MapPin, Navigation, Search } from "lucide-react";
import { Sheet, SectionLabel } from "./ui";
import { cn } from "../lib/utils";
import { geolocationSupported, isSecureOrigin, useLocation } from "../state/location-store";
import { placeSubtitle, searchPlaces, type PlaceResult } from "../lib/geocode";
import { formatPlace } from "../domain/location";
import type { GeoLocation } from "../domain/weather";

/**
 * Choosing where the weather is for.
 *
 * Device location is offered but never demanded: the browser prompt appears
 * only when the user asks for it, and every failure leaves the previously
 * chosen place untouched. There is no IP-based fallback anywhere in this file —
 * a guess presented as a precise fix would be a lie the header then repeats.
 */
export function LocationPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mode = useLocation((s) => s.mode);
  const place = useLocation((s) => s.place);
  const lastSelected = useLocation((s) => s.lastSelected);
  const stage = useLocation((s) => s.stage);
  const error = useLocation((s) => s.error);
  const canRetryPrecisely = useLocation((s) => s.canRetryPrecisely);
  const requestLive = useLocation((s) => s.requestLive);
  const selectPlace = useLocation((s) => s.selectPlace);
  const useSelected = useLocation((s) => s.useSelected);

  const [query, setQuery] = useState("");
  const busy = stage === "prompting" || stage === "locating" || stage === "naming";
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);

  // A new query supersedes whatever was in flight, so a slow earlier response
  // can never overwrite the results for what the user typed most recently.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setProblem(null);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q);
        if (seq.current !== mine) return;
        setResults(found);
        setProblem(found.length === 0 ? "No matching place." : null);
      } catch {
        if (seq.current !== mine) return;
        setResults(null);
        setProblem("Place search is unavailable offline.");
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
      setProblem(null);
    }
  }, [open]);

  const choose = (p: GeoLocation) => {
    selectPlace(p);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Location">
      <div className="space-y-5">
        <section>
          <SectionLabel>Current location</SectionLabel>
          <button
            onClick={() => void requestLive()}
            disabled={busy}
            aria-busy={busy}
            className={cn(
              "flex min-h-[52px] w-full items-center gap-3 rounded-[16px] px-3.5 text-left transition-colors",
              "bg-white/[0.06] shadow-[inset_0_0_0_1px_rgb(255_255_255_0.09)]",
              "hover:bg-white/[0.1] disabled:opacity-60",
              mode === "live" && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_55%,transparent)]",
            )}
          >
            <Navigation
              size={17}
              className={cn("shrink-0", mode === "live" ? "text-[var(--wx-accent)]" : "text-[var(--ink-soft)]")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                {stage === "prompting"
                  ? "Waiting for permission…"
                  : stage === "locating"
                    ? "Finding you…"
                    : stage === "naming"
                      ? "Naming your place…"
                      : "Use my location"}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-[var(--ink-faint)]">
                {mode === "live" && place
                  ? `Showing your device location · ${formatPlace(place)}`
                  : geolocationSupported() && isSecureOrigin()
                    ? "Asks your browser for a location fix"
                    : geolocationSupported()
                      ? "Needs localhost or https://"
                      : "This browser cannot share a location"}
              </span>
            </span>
          </button>

          {error && (
            <p role="status" className="mt-2 text-[12px] leading-snug text-[var(--ink-soft)]">
              {error}
            </p>
          )}

          {canRetryPrecisely && !busy && (
            <button
              onClick={() => void requestLive({ precise: true })}
              className="-ml-1.5 mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-1.5 text-[12.5px] text-[var(--wx-accent)] transition-opacity hover:opacity-80"
            >
              <Crosshair size={12} />
              Try precise location
            </button>
          )}

          {mode === "live" && place && lastSelected && lastSelected.name !== place.name && (
            <button
              onClick={useSelected}
              className="-ml-1.5 mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-1.5 text-[12.5px] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-soft)]"
            >
              <MapPin size={12} />
              Back to {lastSelected.name}
            </button>
          )}
        </section>

        <section>
          <SectionLabel>Search for a place</SectionLabel>
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Mumbai, Pune, Kochi…"
              aria-label="Search for a place"
              className={cn(
                "min-h-[46px] w-full rounded-[14px] bg-white/[0.06] pl-9 pr-3 text-[14px]",
                "shadow-[inset_0_0_0_1px_rgb(255_255_255_0.09)] outline-none",
                "placeholder:text-[var(--ink-faint)] focus:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_55%,transparent)]",
              )}
            />
          </div>

          {problem && (
            <p role="status" className="mt-2.5 text-[12px] text-[var(--ink-faint)]">
              {problem}
            </p>
          )}

          {results !== null && results.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {results.map((p) => {
                const on = mode === "selected" && place?.name === p.name && place?.admin === p.admin;
                return (
                  <li key={`${p.lat},${p.lon},${p.name}`}>
                    <button
                      onClick={() => choose(p)}
                      className={cn(
                        "flex min-h-[48px] w-full items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors",
                        "hover:bg-white/[0.08]",
                        on && "bg-white/[0.1]",
                      )}
                    >
                      <MapPin
                        size={14}
                        className={cn("shrink-0", on ? "text-[var(--wx-accent)]" : "text-[var(--ink-faint)]")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium leading-tight">
                          {p.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ink-faint)]">
                          {placeSubtitle(p)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {searching && results === null && (
            <p className="mt-2.5 text-[12px] text-[var(--ink-faint)]">Searching…</p>
          )}
        </section>

        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ink-faint)]">
          <LocateFixed size={12} className="mt-0.5 shrink-0" />
          Your location stays on this device. It never changes your routine, and
          demo scenarios always use Kochi regardless of where you are.
        </p>
      </div>
    </Sheet>
  );
}
