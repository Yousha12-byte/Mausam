import type { ConfidenceFactor } from "../domain/decision";

export function ConfidenceMeter({
  overall,
  factors,
}: {
  overall: number;
  factors: ConfidenceFactor[];
}) {
  const pct = Math.round(overall * 100);
  const band = pct >= 75 ? "High" : pct >= 50 ? "Moderate" : "Low";
  const color =
    pct >= 75 ? "var(--sev-calm)" : pct >= 50 ? "var(--sev-caution)" : "var(--sev-avoid)";

  return (
    <div className="rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_var(--line-soft)]">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
          Confidence
        </span>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
          {band} · {pct}%
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      {factors.length > 0 && (
        <dl className="mt-3 space-y-2">
          {factors.map((f) => (
            <div key={f.label} className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
              <dt className="text-[11px] text-[var(--ink-faint)]">{f.label}</dt>
              <dd className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-white/55"
                    style={{ width: `${Math.round(f.value * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-[10px] leading-tight text-[var(--ink-faint)]">
                  {f.detail}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
