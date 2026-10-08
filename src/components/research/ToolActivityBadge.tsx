import { Eye, Globe, MapPin, Search, Sparkles } from "lucide-react";
import { cx } from "@/lib/cx";
import type { ToolActivity } from "@/lib/agent/types";

const ICONS = {
  places: MapPin,
  web_search: Search,
  web_extract: Globe,
  fetch: Globe,
  gemini: Sparkles,
  vision: Eye,
} as const;

const NAMES: Record<ToolActivity["name"], string> = {
  places: "Google Places",
  web_search: "Web search",
  web_extract: "Reading a page",
  fetch: "Fetching a page",
  gemini: "AI reading",
  vision: "Reading a photo",
};

export function ToolActivityBadge({ tool, latest }: { tool: ToolActivity; latest?: boolean }) {
  const Icon = ICONS[tool.name];
  return (
    <li
      className={cx(
        "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        latest ? "border-saffron/70 bg-saffron/10 text-ink" : "border-line bg-surface text-muted",
      )}
      title={tool.label}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="shrink-0">{NAMES[tool.name]}</span>
      <span className="truncate font-normal text-muted">{tool.label.replace(/^Places text search: /, "")}</span>
    </li>
  );
}

export function ToolActivityStrip({ tools, running }: { tools: ToolActivity[]; running: boolean }) {
  const recent = tools.slice(-3);
  if (recent.length === 0) return null;
  return (
    <section aria-label="Recent activity">
      <ul className="flex flex-wrap gap-2">
        {recent.map((t, i) => (
          <ToolActivityBadge key={t.seq} tool={t} latest={running && i === recent.length - 1} />
        ))}
      </ul>
    </section>
  );
}
