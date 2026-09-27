import { useState } from "react";
import { CalendarClock, ChevronDown, Database, User } from "lucide-react";
import type { Decision, Severity } from "../domain/decision";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { Row } from "./icons";

export const SEV_COLOR: Record<Severity, string> = {
  calm: "var(--sev-calm)",
  note: "var(--sev-note)",
  caution: "var(--sev-caution)",
  avoid: "var(--sev-avoid)",
};

/**
 * The one thing the app exists to say.
 *
 * Hierarchy, deliberately: the verdict is the largest type after the
 * temperature, the action sits directly beneath it as a single short line, and
 * the entire evidence trail is one tap away. Nothing about the reasoning is
 * hidden — it is just not forced on someone who did not ask for it, which is
 * what turned the old page into a wall of panels.
 */
export function Insight({
  decision,
  onWhatIf,
  defaultOpen = false,
}: {
  decision: Decision;
  onWhatIf?: (eventId: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = SEV_COLOR[decision.severity];
  const isSevere = decision.kind === "severe";
  const isPreview = decision.kind === "preview";

  // A severe-weather advisory is a safety statement, not an insight, so it gets
  // a persistent edge instead of a large type treatment.
  if (isSevere) {
    return (
      <div
        className="rounded-[18px] px-4 py-3.5"
        style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color }}>
            Severe weather
          </p>
        </div>
        <h3
          data-testid="decision-title"
          className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight"
        >
          {decision.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-soft)]">
          {decision.detail}
        </p>
        {decision.why.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-[var(--line-soft)] pt-3">
            {decision.why.map((w, i) => (
              <Row
                key={i}
                tone={w.kind === "action" ? "accent" : "default"}
                icon={
                  w.kind === "data" ? (
                    <Database size={13} />
                  ) : w.kind === "profile" ? (
                    <User size={13} />
                  ) : (
                    <CalendarClock size={13} />
                  )
                }
              >
                {w.text}
              </Row>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={`insight-${decision.id}`}>
      {/* A thin severity rule, not a coloured box: the colour is information
          without becoming a card. */}
      <div className="flex items-center gap-2.5">
        <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
          {isPreview ? "Looking ahead" : "For you today"}
        </p>
      </div>

      <h2
        id={`insight-${decision.id}`}
        data-testid="decision-title"
        className="mt-2.5 text-[27px] font-semibold leading-[1.15] tracking-[-0.02em] text-balance"
      >
        {decision.title}
      </h2>

      {decision.action && (
        <div className="mt-3.5 flex items-start gap-2.5">
          <CalendarClock size={17} className="mt-[3px] shrink-0" style={{ color }} />
          <div className="min-w-0">
            <p className="text-[16px] font-semibold leading-snug" style={{ color }}>
              {decision.action}
            </p>
            {decision.actionSub && (
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--ink-faint)]">
                {decision.actionSub}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {decision.why.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`why-${decision.id}`}
            className="-ml-1.5 inline-flex min-h-[36px] items-center gap-1 rounded-full px-1.5 text-[13px] font-medium text-[var(--ink-soft)] transition-colors hover:text-white"
          >
            <ChevronDown
              size={14}
              className="transition-transform duration-300"
              style={{ transform: open ? "rotate(180deg)" : "none" }}
            />
            Why?
          </button>
        )}
        {decision.eventId && (
          <button
            onClick={() => onWhatIf?.(decision.eventId!)}
            className="-ml-1.5 inline-flex min-h-[36px] items-center gap-1 rounded-full px-1.5 text-[13px] font-medium text-[var(--ink-soft)] transition-colors hover:text-white"
          >
            <CalendarClock size={14} />
            What if I left earlier?
          </button>
        )}
      </div>

      {open && (
        <div
          id={`why-${decision.id}`}
          className="mt-3 border-t border-[var(--line-soft)] pt-3.5"
        >
          <p className="text-[13px] leading-relaxed text-[var(--ink-soft)]">
            {decision.detail}
          </p>
          {decision.why.length > 0 && (
            <ul className="mt-3 space-y-2">
              {decision.why.map((w, i) => (
                <Row
                  key={i}
                  tone={w.kind === "action" ? "accent" : "default"}
                  icon={
                    w.kind === "data" ? (
                      <Database size={13} />
                    ) : w.kind === "profile" ? (
                      <User size={13} />
                    ) : (
                      <CalendarClock size={13} />
                    )
                  }
                >
                  {w.text}
                </Row>
              ))}
            </ul>
          )}
          {decision.confidence.factors.length > 0 && (
            <div className="mt-4">
              <ConfidenceMeter
                overall={decision.confidence.overall}
                factors={decision.confidence.factors}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
