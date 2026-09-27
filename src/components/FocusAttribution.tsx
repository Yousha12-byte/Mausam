import { FOCUS_BY_ID, type FocusId } from "../domain/focus";
import { cn } from "../lib/utils";

/**
 * "Why am I being told this?" — answered above the sentence, not beneath it.
 *
 * An unexplained personalized sentence is indistinguishable from a horoscope, so
 * the selection that produced it is stated. It used to sit under the headline in
 * 11px grey, which put it below the fold on a 390×844 screen and made it read as
 * a footnote to a claim the reader had already accepted. Attribution belongs
 * *before* the claim, where it reads as a label on what follows.
 *
 * Two things it will not do. It will not say "because you chose Daily Life" when
 * nothing was chosen, because that is a small lie on first run and the whole point
 * of this line is that it can be trusted. And it will not name a focus for a
 * reading that came from the routine, because the routine is not a lens the user
 * set.
 */
export function FocusAttribution({
  name,
  focusId,
  isDefault,
  onEdit,
  className,
}: {
  /** The reader's name, if they gave one. */
  name?: string;
  /** The focus that produced the reading. Null when it came from the routine. */
  focusId: FocusId | null;
  /** True when nothing is selected and the default is standing in. */
  isDefault?: boolean;
  onEdit: () => void;
  className?: string;
}) {
  if (!focusId) return null;

  const label = FOCUS_BY_ID[focusId]?.short ?? focusId;
  const who = name?.trim();

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}
      data-testid="focus-attribution"
      data-focus={focusId}
      data-default={isDefault ? "true" : "false"}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">
        {who ? `For ${who}` : "For you"}
        <span className="mx-1 opacity-50">·</span>
        <span className="text-[var(--ink-soft)]">{label}</span>
        {isDefault && <span className="ml-1.5 normal-case tracking-normal opacity-70">by default</span>}
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-full px-1 py-0.5 text-[10.5px] text-[var(--ink-faint)] underline decoration-white/20 underline-offset-2 transition-colors hover:text-[var(--ink-soft)]"
      >
        Change
      </button>
    </div>
  );
}
