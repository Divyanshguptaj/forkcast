import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type NoticeKind =
  | "no_results"
  | "places_unavailable"
  | "agent_timeout"
  | "partial_results"
  | "unexpected_error"
  | "menu_unavailable"
  | "menu_unreadable"
  | "menu_low_confidence"
  | "price_unclear"
  | "reviews_unavailable";

interface NoticeCopy {
  emoji: string;
  title: string;
  body: string;
  tone: "soft" | "warn" | "problem";
}

export const NOTICE_COPY: Record<NoticeKind, NoticeCopy> = {
  no_results: {
    emoji: "🍽️",
    title: "No tables found",
    body: "We couldn't find restaurants for that search. Try a wider budget, fewer filters or another cuisine.",
    tone: "soft",
  },
  places_unavailable: {
    emoji: "🔌",
    title: "The restaurant directory isn't answering",
    body: "We couldn't reach Google Places just now. Nothing is wrong with your search. Give it a moment and try again.",
    tone: "problem",
  },
  agent_timeout: {
    emoji: "⏱️",
    title: "That took longer than expected",
    body: "We ran out of time before we had anything solid to show. Try again, or narrow the search.",
    tone: "warn",
  },
  partial_results: {
    emoji: "🧩",
    title: "Partial results",
    body: "We ran out of time before finishing every restaurant. Here's what we confirmed so far. Anything unfinished is marked.",
    tone: "warn",
  },
  unexpected_error: {
    emoji: "🫠",
    title: "Something went sideways",
    body: "We hit an unexpected problem. Your search wasn't lost. Try again.",
    tone: "problem",
  },
  menu_unavailable: {
    emoji: "📭",
    title: "No menu found online",
    body: "We checked the website, searched in Spanish and Catalan, and looked for PDFs and photos. We won't guess what's on the menu.",
    tone: "soft",
  },
  menu_unreadable: {
    emoji: "📖",
    title: "Menu found, but we couldn't read it",
    body: "This menu couldn't be read automatically, so we haven't judged its dishes. You can open it yourself.",
    tone: "warn",
  },
  menu_low_confidence: {
    emoji: "📷",
    title: "Photo menu, low confidence",
    body: "Some dishes or prices were hard to read. Double-check with the restaurant before you go.",
    tone: "warn",
  },
  price_unclear: {
    emoji: "💶",
    title: "Price unclear",
    body: "The price couldn't be read reliably, so we're not showing a number.",
    tone: "soft",
  },
  reviews_unavailable: {
    emoji: "💬",
    title: "Review research unavailable",
    body: "We couldn't reach review sources for this place, so nothing here is based on diner comments.",
    tone: "soft",
  },
};

const TONES = {
  soft: "border-line bg-surface",
  warn: "border-saffron/60 bg-saffron/8",
  problem: "border-chili/60 bg-chili/8",
} as const;

interface Props {
  kind: NoticeKind;
  compact?: boolean;
  actions?: ReactNode;
  className?: string;
}

export function StatusNotice({ kind, compact = false, actions, className }: Props) {
  const copy = NOTICE_COPY[kind];
  const alert = copy.tone === "problem";
  return (
    <div
      role={alert ? "alert" : "status"}
      data-notice={kind}
      className={cx("rounded-card border-2", TONES[copy.tone], compact ? "flex gap-3 p-3" : "flex gap-4 p-5", className)}
    >
      <span aria-hidden="true" className={cx("shrink-0 leading-none", compact ? "text-xl" : "text-4xl")}>
        {copy.emoji}
      </span>
      <div className="min-w-0 space-y-1">
        <p className={cx("font-display font-bold text-ink", compact ? "text-base" : "text-xl")}>{copy.title}</p>
        <p className={cx("text-muted", compact ? "text-sm" : "text-base")}>{copy.body}</p>
        {actions ? <div className="flex flex-wrap gap-2 pt-2">{actions}</div> : null}
      </div>
    </div>
  );
}
