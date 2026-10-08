import { ExternalLink } from "lucide-react";
import { DemoSticker } from "@/components/shared/Badge";
import { ButtonLink } from "@/components/shared/Button";
import { StatusNotice } from "@/components/states/StatusNotice";
import { restaurantPhase } from "@/lib/agent/selectors";
import type { MenuStageNote, RestaurantResearch } from "@/lib/agent/types";
import { cx } from "@/lib/cx";
import { MenuTicket } from "./MenuTicket";

const STAGE_LABEL: Record<MenuStageNote["stage"], string> = {
  site: "Their website",
  search: "Web search",
  assets: "PDFs and photos",
  third_party: "Other sources",
};

const LANGUAGE_NAME: Record<string, string> = { ca: "Catalan", es: "Spanish", en: "English" };

function languages(codes: string[]): string {
  return codes.map((c) => LANGUAGE_NAME[c] ?? c).join(" + ");
}

function StageTrail({ stages }: { stages: MenuStageNote[] }) {
  if (stages.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Where we looked for the menu">
      {stages.map((s) => (
        <li
          key={s.stage}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold",
            s.found ? "border-basil/60 text-basil" : "border-line text-muted",
          )}
        >
          <span aria-hidden="true">{s.found ? "✓" : "–"}</span>
          {STAGE_LABEL[s.stage]}
          <span className="font-normal text-muted">
            {s.found ? `${s.candidates} page${s.candidates === 1 ? "" : "s"}` : s.candidates > 0 ? `${s.candidates} checked, no menu` : "nothing"}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  restaurant: RestaurantResearch;
  mocked: boolean;
  showItems: boolean;
}

export function MenuResearchState({ restaurant: r, mocked, showItems }: Props) {
  const phase = restaurantPhase(r);
  const resolved = r.menu.resolved;
  const hasPhotoDoubt = r.menu.items.some((i) => i.priceStatus === "disputed");

  if (phase === "waiting") {
    return <p className="text-sm text-muted">Waiting for menu research…</p>;
  }

  const readLine = r.menu.read
    ? `${r.menu.read.usedVision ? "🖼️ Reading an image menu" : r.menu.read.format.startsWith("pdf") ? "📖 Reading a PDF menu" : "📖 Reading their menu"}${
        r.menu.read.languages.length ? ` · ${languages(r.menu.read.languages)}` : ""
      }`
    : undefined;
  const translating = r.steps.translate.status === "started" || r.steps.translate.status === "progress";
  const dieting = r.steps.diet.status === "started" || r.steps.diet.status === "progress";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StageTrail stages={r.menu.stages} />
        {mocked ? <DemoSticker /> : null}
      </div>

      {r.steps.menu.detail && phase !== "complete" ? <p className="text-sm text-muted">{r.steps.menu.detail}</p> : null}
      {readLine ? <p className="text-sm font-semibold text-ink">{readLine}</p> : null}
      {translating ? <p className="text-sm font-semibold text-ink">🌐 Translating to English…</p> : null}
      {dieting ? <p className="text-sm font-semibold text-ink">🌱 Finding vegetarian dishes…</p> : null}

      {resolved?.status === "found_but_unreadable" ? (
        <StatusNotice
          kind="menu_unreadable"
          compact
          actions={
            <ButtonLink href={resolved.officialMenuUrl} variant="secondary">
              View official menu <ExternalLink aria-hidden="true" className="size-4" />
            </ButtonLink>
          }
        />
      ) : null}
      {resolved?.status === "unavailable" ? <StatusNotice kind="menu_unavailable" compact /> : null}
      {hasPhotoDoubt ? <StatusNotice kind="menu_low_confidence" compact /> : null}

      {showItems && r.menu.items.length > 0 ? (
        <MenuTicket
          items={r.menu.items}
          demo={mocked}
          caption={resolved ? `${resolved.documentCount} menu document${resolved.documentCount === 1 ? "" : "s"}` : undefined}
        />
      ) : null}
    </div>
  );
}
