import { ExternalLink } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/shared/Badge";
import { ButtonLink } from "@/components/shared/Button";
import { cx } from "@/lib/cx";
import type { MatchedRestaurant } from "@/schemas/recommendations";
import { ConstraintChecklist } from "./ConstraintChecklist";
import { MatchRing } from "./MatchRing";
import { MatchedDishRow } from "./MatchedDishRow";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { SourceIndicator } from "./SourceIndicator";

const TIER: Record<MatchedRestaurant["tier"], { tone: BadgeTone; icon: string; ring: "basil" | "saffron" | "chili"; hint: string }> = {
  exact: { tone: "basil", icon: "✓", ring: "basil", hint: "Every requirement is confirmed by the menu and Google data." },
  partial: { tone: "saffron", icon: "~", ring: "saffron", hint: "Your hard requirements are confirmed, but something you asked for is missing." },
  uncertain: { tone: "saffron", icon: "?", ring: "saffron", hint: "Promising, but the menu doesn't confirm every hard requirement." },
  near_miss: { tone: "chili", icon: "!", ring: "chili", hint: "Fits your diet, but verified prices are above your budget." },
};

const TIER_NAME: Record<string, string> = {
  official_site: "Official website",
  official_linked: "Linked from the official website",
  official_domain_search: "File on the official domain",
  unverified_asset: "File with unconfirmed owner",
  third_party: "Third-party site",
};

const METHOD_NAME = { html_text: "web page", pdf_text: "PDF", vision: "photo or scan" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-extrabold uppercase tracking-widest text-muted">{title}</h4>
      {children}
    </section>
  );
}

function DishList({ label, dishes }: { label?: string; dishes: MatchedRestaurant["dishes"] }) {
  if (dishes.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {label ? <p className="text-sm font-semibold text-saffron">{label}</p> : null}
      <ul className="rounded-control border-2 border-line bg-bg px-3">
        {dishes.map((d) => (
          <li key={d.dishId} className="border-b border-dashed border-line py-3 last:border-b-0">
            <MatchedDishRow dish={d} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RestaurantMatchCard({ r, headingLevel = 3 }: { r: MatchedRestaurant; headingLevel?: 3 | 4 }) {
  const tier = TIER[r.tier];
  const exact = r.dishes.filter((d) => d.fit === "exact");
  const possible = r.dishes.filter((d) => d.fit === "possible");
  const near = r.dishes.filter((d) => d.fit === "near_miss");
  const lead = r.tier === "exact" && r.rank === 1;
  const Heading = `h${headingLevel}` as "h3" | "h4";
  return (
    <article
      aria-label={`Recommendation ${r.rank}: ${r.name}`}
      data-testid="recommendation-card"
      data-tier={r.tier}
      className={cx("relative rounded-card border-2 bg-surface p-4 sm:p-6", lead ? "border-ink shadow-pop" : r.tier === "exact" ? "border-line" : "border-dashed border-line")}
    >
      {lead ? (
        <span
          aria-hidden="true"
          className="tabular absolute -top-3.5 right-4 rotate-3 rounded-lg border-2 border-ink bg-saffron px-3 py-0.5 text-xs font-medium uppercase tracking-[0.14em] text-bg shadow-pop-sm"
        >
          Forkcast pick
        </span>
      ) : null}
      <header className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className={cx(
            lead && "stamp-land",
            "flex shrink-0 -rotate-3 items-center justify-center rounded-xl border-2 font-display font-extrabold",
            lead ? "size-14 border-ink bg-tomato text-3xl text-bg" : r.tier === "exact" ? "size-11 border-ink bg-saffron text-2xl text-bg" : "size-11 border-line bg-surface-2 text-2xl text-ink",
          )}
        >
          {r.rank}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Heading className={cx("text-balance font-display font-extrabold leading-tight [overflow-wrap:anywhere]", lead ? "text-3xl" : "text-2xl")}>{r.name}</Heading>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {r.rating !== undefined ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true">⭐</span>
                <span className="sr-only">Rated </span>
                {r.rating.toFixed(1)}
                {r.ratingCount !== undefined ? ` (${r.ratingCount.toLocaleString("en-US")})` : ""}
                <SourceIndicator kind="retrieved" detail="Rating from Google Places." />
              </span>
            ) : null}
            {r.priceLevel ? (
              <span className="tabular font-bold text-ink" title="Google price level">
                <span className="sr-only">Google price level {r.priceLevel} of 4: </span>
                {"€".repeat(r.priceLevel)}
              </span>
            ) : null}
            {r.distanceKm !== undefined ? <span>📍 {r.distanceKm.toFixed(1)} km</span> : null}
          </p>
          <Badge tone={tier.tone} icon={tier.icon} title={tier.hint}>
            {r.categoryLabel}
          </Badge>
        </div>
        <div className="shrink-0">
          <MatchRing percent={r.score} tone={tier.ring} label="score" />
        </div>
      </header>

      {r.allergyWarning ? (
        <p role="note" className="mt-4 flex gap-2 rounded-control border-2 border-saffron/70 bg-saffron/10 px-3 py-2 text-sm text-ink">
          <span aria-hidden="true">⚠️</span>
          <span>
            <strong>Allergy warning.</strong> {r.allergyWarning}
          </span>
        </p>
      ) : null}

      <div className="mt-5 space-y-6">
        {r.reasons.length > 0 ? (
          <Section title={r.tier === "exact" ? "Why it matches" : "What we found"}>
            <ul className="space-y-1.5">
              {r.reasons.map((reason) => (
                <li key={reason.text} className="flex gap-2 text-ink">
                  <span aria-hidden="true">✨</span>
                  <span className="[overflow-wrap:anywhere]">{reason.text}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Dishes">
          <DishList dishes={exact} />
          <DishList label="Might also work — the menu doesn't confirm everything" dishes={possible} />
          <DishList label="Fit your diet but are over budget" dishes={near} />
          {r.exactDishCount + r.possibleDishCount > r.dishes.length ? (
            <p className="text-xs text-muted">
              Showing {r.dishes.length} of {r.exactDishCount + r.possibleDishCount} candidate dishes ({r.menuDishCount} dishes read in total).
            </p>
          ) : null}
        </Section>

        {r.unmet.length > 0 ? (
          <Section title="Doesn't match">
            <ul className="space-y-1">
              {r.unmet.map((u) => (
                <li key={u} className="flex gap-2 text-ink">
                  <span aria-hidden="true">✕</span>
                  <span className="[overflow-wrap:anywhere]">{u}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {r.uncertainties.length > 0 ? (
          <Section title="Check before you go">
            <ul className="space-y-1">
              {r.uncertainties.map((u) => (
                <li key={u} className="flex gap-2 text-ink">
                  <span aria-hidden="true">⚠️</span>
                  <span className="[overflow-wrap:anywhere]">{u}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <details className="group text-sm">
          <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
            <span className="underline decoration-line underline-offset-4 group-open:decoration-saffron">What we checked</span>
          </summary>
          <div className="mt-2">
            <ConstraintChecklist outcomes={r.outcomes} />
          </div>
        </details>

        <ScoreBreakdown components={r.components} score={r.score} />
      </div>

      <footer className="mt-5 space-y-3 border-t-2 border-dashed border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {r.links.map((l) => (
            <ButtonLink key={l.kind} href={l.url}>
              {l.label} <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only"> (opens in a new tab)</span>
            </ButtonLink>
          ))}
        </div>
        <details className="group text-sm">
          <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
            <span className="underline decoration-line underline-offset-4 group-open:decoration-saffron">Sources ({r.menuSources.length + 1})</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            <li className="flex flex-wrap items-center gap-2">
              <SourceIndicator kind="retrieved" showLabel />
              <span className="text-muted">Rating, price level and opening hours: Google Places</span>
            </li>
            {r.menuSources.map((s) => (
              <li key={s.documentId} className="flex flex-wrap items-center gap-2">
                <SourceIndicator kind={s.method === "vision" ? "uncertain" : "extracted"} showLabel />
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 text-muted underline decoration-line underline-offset-4 [overflow-wrap:anywhere] hover:text-ink">
                  {TIER_NAME[s.tier]}
                  {s.method ? ` (${METHOD_NAME[s.method]})` : ""}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </footer>
    </article>
  );
}
