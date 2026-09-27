import { CalendarClock, ChevronRight, Database, User } from "lucide-react";
import type { Decision } from "../domain/decision";
import { Row } from "./icons";
import { SEV_COLOR } from "./Insight";

/**
 * Secondary decisions. The engine can return several; only the first is worth
 * headline treatment, so the rest are a quiet list — a severity dot, the
 * verdict, and a one-line action. No panel, no border, no uppercase label:
 * the reader should be able to skim past them to the one that matters.
 */
export function DecisionList({
  decisions,
  onWhatIf,
}: {
  decisions: Decision[];
  onWhatIf?: (eventId: string) => void;
}) {
  if (decisions.length === 0) return null;
  return (
    <ul className="divide-y divide-[var(--line-soft)]">
      {decisions.map((d) => {
        const color = SEV_COLOR[d.severity];
        return (
          <li key={d.id} className="py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span
                className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: color }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-snug tracking-tight">
                  {d.title}
                </p>
                {d.action && (
                  <p className="mt-1 text-[13.5px] font-medium leading-snug" style={{ color }}>
                    {d.action}
                  </p>
                )}
                {d.why.length > 0 && (
                  <details className="group mt-1.5">
                    <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center text-[12.5px] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-soft)]">
                      <ChevronRight
                        size={13}
                        className="mr-1 transition-transform group-open:rotate-90"
                      />
                      Why?
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      <p className="text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
                        {d.detail}
                      </p>
                      <ul className="space-y-1.5 pt-0.5">
                        {d.why.map((w, i) => (
                          <Row
                            key={i}
                            tone={w.kind === "action" ? "accent" : "default"}
                            icon={
                              w.kind === "data" ? (
                                <Database size={12} />
                              ) : w.kind === "profile" ? (
                                <User size={12} />
                              ) : (
                                <CalendarClock size={12} />
                              )
                            }
                          >
                            <span className="text-[12.5px]">{w.text}</span>
                          </Row>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
                {d.eventId && (
                  <button
                    onClick={() => onWhatIf?.(d.eventId!)}
                    className="-ml-1.5 mt-1 inline-flex min-h-[36px] items-center gap-1 rounded-full px-1.5 text-[12.5px] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-soft)]"
                  >
                    <CalendarClock size={13} />
                    What if I left earlier?
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
