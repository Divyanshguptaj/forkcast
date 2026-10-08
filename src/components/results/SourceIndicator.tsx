import { BadgeCheck, FileText, HelpCircle, Sparkles } from "lucide-react";
import { cx } from "@/lib/cx";

export type ProvenanceKind = "retrieved" | "extracted" | "inferred" | "uncertain";

const KINDS: Record<ProvenanceKind, { label: string; hint: string; className: string; Icon: typeof BadgeCheck }> = {
  retrieved: { label: "Verified", hint: "Taken directly from a source such as Google Places.", className: "text-basil", Icon: BadgeCheck },
  extracted: { label: "From the menu", hint: "Read from the restaurant's own menu.", className: "text-ink", Icon: FileText },
  inferred: { label: "Inferred", hint: "Forkcast's best judgement. Not stated by a source.", className: "text-saffron", Icon: Sparkles },
  uncertain: { label: "Uncertain", hint: "Sources disagree or were hard to read. Double-check.", className: "text-chili", Icon: HelpCircle },
};

interface Props {
  kind: ProvenanceKind;
  detail?: string;
  showLabel?: boolean;
  className?: string;
}

export function SourceIndicator({ kind, detail, showLabel = false, className }: Props) {
  const { label, hint, className: tone, Icon } = KINDS[kind];
  const tip = detail ? `${hint} ${detail}` : hint;
  return (
    <span className={cx("group relative inline-flex items-center gap-1 align-middle", tone, className)}>
      <span tabIndex={0} role="img" aria-label={`${label}. ${tip}`} className="inline-flex items-center gap-1 rounded-sm">
        <Icon aria-hidden="true" className={cx("size-4", kind === "uncertain" && "stroke-[2.5]")} strokeDasharray={kind === "inferred" ? "3 2" : undefined} />
        {showLabel ? <span className="text-xs font-semibold">{label}</span> : null}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-56 max-w-[70vw] rounded-control border-2 border-ink bg-bg p-2 text-xs font-medium text-ink shadow-soft group-focus-within:block group-hover:block sm:left-1/2 sm:-translate-x-1/2"
      >
        <span className="block font-bold">{label}</span>
        {tip}
      </span>
    </span>
  );
}
