import { ExternalLink } from "lucide-react";
import { Badge, DemoSticker } from "@/components/shared/Badge";
import { ButtonLink } from "@/components/shared/Button";
import { cx } from "@/lib/cx";
import type { MenuItemPreview } from "@/schemas/menu";
import { DishPreview } from "./DishPreview";
import { MatchRing } from "./MatchRing";
import { SourceIndicator, type ProvenanceKind } from "./SourceIndicator";

export interface CardSource {
  label: string;
  kind: ProvenanceKind;
  url?: string;
}

export interface RecommendationCardShellProps {
  rank: number;
  name: string;
  matchPercent: number;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  distanceKm?: number;
  why: string[];
  vegetarianCount: number;
  dishes: MenuItemPreview[];
  liked: string[];
  thingsToKnow: string[];
  beatsNext?: string;
  links: { website?: string; menu?: string; maps?: string };
  sources: CardSource[];
  mock: boolean;
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-2", className)}>
      <h4 className="text-xs font-extrabold uppercase tracking-widest text-muted">{title}</h4>
      {children}
    </section>
  );
}

export function RecommendationCardShell(p: RecommendationCardShellProps) {
  const first = p.rank === 1;
  return (
    <article
      aria-label={`Recommendation ${p.rank}: ${p.name}`}
      className={cx("rounded-card border-2 bg-surface p-5 sm:p-6", first ? "border-ink shadow-pop" : "border-line")}
    >
      <header className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={cx(
            "flex shrink-0 -rotate-3 items-center justify-center rounded-xl border-2 border-ink font-display font-extrabold text-bg",
            first ? "size-14 bg-tomato text-3xl" : "size-11 bg-saffron text-2xl",
          )}
        >
          {p.rank}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cx("text-balance font-display font-extrabold leading-tight", first ? "text-3xl" : "text-2xl")}>{p.name}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {p.rating !== undefined ? (
              <span className="inline-flex items-center gap-1">
                ⭐ {p.rating.toFixed(1)}
                {p.ratingCount !== undefined ? ` (${p.ratingCount.toLocaleString("en-US")})` : ""}
                <SourceIndicator kind="retrieved" detail="Rating from Google Places." />
              </span>
            ) : null}
            {p.priceLevel ? <span className="tabular font-bold text-ink">{"€".repeat(p.priceLevel)}</span> : null}
            {p.distanceKm !== undefined ? <span>📍 {p.distanceKm.toFixed(1)} km</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <MatchRing percent={p.matchPercent} mock={p.mock} />
        </div>
      </header>

      {p.mock ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <DemoSticker /> Simulated recommendation for design preview.
        </p>
      ) : null}

      <div className="mt-5 space-y-6">
        <div className="space-y-5">
          <Section title="Why you'll like it">
            <ul className="space-y-1.5">
              {p.why.map((w) => (
                <li key={w} className="flex gap-2 text-ink">
                  <span aria-hidden="true">✨</span>
                  <span>
                    {w} <SourceIndicator kind="inferred" />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="People liked">
            <ul className="space-y-1">
              {p.liked.map((l) => (
                <li key={l} className="flex gap-2 text-ink">
                  <span aria-hidden="true">❤️</span>
                  {l}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Things to know">
            <ul className="space-y-1">
              {p.thingsToKnow.map((t) => (
                <li key={t} className="flex gap-2 text-ink">
                  <span aria-hidden="true">⚠️</span>
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section title="Menu highlights">
          <p className="flex items-center gap-2 text-sm font-bold text-basil">
            <span aria-hidden="true">🌱</span> {p.vegetarianCount} vegetarian option{p.vegetarianCount === 1 ? "" : "s"}
          </p>
          <ul className="rounded-control border-2 border-line bg-bg px-3">
            {p.dishes.map((d) => (
              <li key={d.originalName} className="border-b border-dashed border-line py-3 last:border-b-0">
                <DishPreview item={d} />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {p.beatsNext ? (
        <p className="mt-5 rounded-control border-2 border-dashed border-saffron/60 bg-saffron/8 px-3 py-2 text-sm text-ink">
          <Badge tone="saffron" className="mr-2">
            Why #{p.rank} beat #{p.rank + 1}
          </Badge>
          {p.beatsNext}
        </p>
      ) : null}

      <footer className="mt-5 space-y-3 border-t-2 border-dashed border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {p.links.website ? (
            <ButtonLink href={p.links.website}>
              Website <ExternalLink aria-hidden="true" className="size-4" />
            </ButtonLink>
          ) : null}
          {p.links.menu ? (
            <ButtonLink href={p.links.menu}>
              View menu <ExternalLink aria-hidden="true" className="size-4" />
            </ButtonLink>
          ) : null}
          {p.links.maps ? (
            <ButtonLink href={p.links.maps}>
              Google Maps <ExternalLink aria-hidden="true" className="size-4" />
            </ButtonLink>
          ) : null}
          {!p.links.website && !p.links.menu && !p.links.maps ? (
            <p className="text-sm text-muted">Website, menu and map links appear here once real data is connected.</p>
          ) : null}
        </div>
        <details className="group text-sm">
          <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
            <span className="underline decoration-line underline-offset-4 group-open:decoration-saffron">Sources ({p.sources.length})</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {p.sources.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <SourceIndicator kind={s.kind} showLabel />
                <span className="text-muted">{s.label}</span>
              </li>
            ))}
          </ul>
        </details>
      </footer>
    </article>
  );
}
