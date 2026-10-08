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

const TIER_LABEL: Record<string, string> = {
  official_site: "official site",
  official_linked: "linked from their site",
  official_domain_search: "official site",
  unverified_asset: "web search",
  third_party: "third-party",
};

const UNREADABLE_BODY: Record<string, string> = {
  flipbook_viewer: "Their menu lives in an online flipbook viewer that can't be read automatically. We haven't judged its dishes. You can open it yourself.",
  blocked: "The site blocks automated reading, so we haven't judged its dishes. You can open the menu yourself.",
  js_only: "This menu only shows up after a page runs scripts we can't run, so we haven't judged its dishes. You can open it yourself.",
  unsupported_format: "The menu is in a file format we can't read, so we haven't judged its dishes. You can open it yourself.",
  fetch_failed: "We couldn't download this menu just now, so we haven't judged its dishes. You can open it yourself.",
};

const UNAVAILABLE_BODY: Record<string, string> = {
  no_website: "This place lists no website, and searching the web turned up no menu. We won't guess what's on it.",
  identity_mismatch: "The only menus we found seem to belong to a different restaurant, so we ignored them. We won't guess what's on this one.",
};

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
            {s.found && s.sourceTier ? ` · ${TIER_LABEL[s.sourceTier] ?? s.sourceTier}` : ""}
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
          body={resolved.reason ? UNREADABLE_BODY[resolved.reason] : undefined}
          actions={
            <ButtonLink href={resolved.officialMenuUrl} variant="secondary">
              View official menu <ExternalLink aria-hidden="true" className="size-4" />
            </ButtonLink>
          }
        />
      ) : null}
      {resolved?.status === "unavailable" ? <StatusNotice kind="menu_unavailable" compact body={resolved.reason ? UNAVAILABLE_BODY[resolved.reason] : undefined} /> : null}
      {hasPhotoDoubt ? <StatusNotice kind="menu_low_confidence" compact /> : null}
      {r.menu.extraction ? (
        <>
          <p className="text-sm text-muted">
            <span aria-hidden="true">🧾 </span>
            Read {r.menu.extraction.documentCount} menu document{r.menu.extraction.documentCount === 1 ? "" : "s"} · {r.menu.extraction.dishCount} dish{r.menu.extraction.dishCount === 1 ? "" : "es"}
            {r.menu.extraction.skippedCount > 0 ? ` · ${r.menu.extraction.skippedCount} skipped` : ""}
          </p>
          {r.menu.extraction.status === "partial" ? <StatusNotice kind="menu_partial" compact /> : null}
          {r.menu.extraction.status === "failed" ? <StatusNotice kind="menu_extraction_failed" compact /> : null}
        </>
      ) : null}

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
