import { ExternalLink } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/shared/Badge";
import { cx } from "@/lib/cx";
import type { MatchedDish } from "@/schemas/recommendations";
import { PriceTag } from "./PriceTag";

const DIET_NAME: Record<string, string> = { vegetarian: "vegetarian", vegan: "vegan", pescatarian: "pescatarian", gluten_free: "gluten-free", halal: "halal", kosher: "kosher" };

const ROLE_LABEL: Record<MatchedDish["role"], string> = { main: "Main", starter: "Starter", side: "Side", dessert: "Dessert", set_menu: "Set menu", other: "Dish" };

const FIT: Record<MatchedDish["fit"], { label: string; tone: BadgeTone; icon: string; hint: string }> = {
  exact: { label: "Matches", tone: "basil", icon: "✓", hint: "Every requirement is confirmed by the menu for this dish." },
  possible: { label: "Needs checking", tone: "saffron", icon: "?", hint: "Plausible, but the menu doesn't confirm every requirement." },
  near_miss: { label: "Over budget", tone: "chili", icon: "!", hint: "Meets your diet but its verified price is above your budget." },
};

function dietBadge(d: MatchedDish["diet"][number]) {
  const name = DIET_NAME[d.diet] ?? d.diet;
  if (d.status === "confirmed") return { label: `${name.charAt(0).toUpperCase()}${name.slice(1)}`, tone: "basil" as const, icon: "✓", dashed: false, hint: d.basis === "menu_label" ? "The menu labels this dish." : "The listed ingredients are compatible." };
  if (d.status === "possible") return { label: `Likely ${name}`, tone: "basil" as const, icon: "🌱", dashed: true, hint: "Guessed from the dish name. The menu doesn't say." };
  if (d.status === "not_suitable") return { label: `Not ${name}`, tone: "chili" as const, icon: "✕", dashed: false, hint: "The menu names an ingredient that rules it out." };
  return { label: `${name.charAt(0).toUpperCase()}${name.slice(1)}: unclear`, tone: "neutral" as const, icon: "?", dashed: false, hint: "The menu gives no information." };
}

export function MatchedDishRow({ dish }: { dish: MatchedDish }) {
  const fit = FIT[dish.fit];
  const translated = dish.translatedName && dish.translatedName.toLowerCase() !== dish.name.toLowerCase();
  const budgetNote = dish.outcomes.find((o) => o.kind === "budget" && o.verdict !== "met")?.note;
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {ROLE_LABEL[dish.role]}
            {dish.section ? <span className="normal-case tracking-normal"> · {dish.section}</span> : null}
          </p>
          <p className="font-display text-lg font-bold leading-tight text-ink [overflow-wrap:anywhere]">{dish.name}</p>
          {translated ? (
            <p className="text-sm text-muted">
              <span className="sr-only">English: </span>
              {dish.translatedName}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <PriceTag price={dish.price.amount} status={dish.price.status} />
          {dish.price.setMenuName ? <span className="text-xs text-muted">price of set menu “{dish.price.setMenuName}”</span> : null}
          {dish.price.label && !dish.price.setMenuName ? <span className="text-xs text-muted">{dish.price.label}</span> : null}
          {dish.price.status === "disputed" && dish.price.alternateAmount !== undefined ? <span className="text-xs text-chili">other reading €{dish.price.alternateAmount.toFixed(2)}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={fit.tone} icon={fit.icon} title={fit.hint}>
          {fit.label}
        </Badge>
        {dish.diet.map((d) => {
          const b = dietBadge(d);
          return (
            <Badge key={d.diet} tone={b.tone} icon={b.icon} title={b.hint} className={cx(b.dashed && "border-dashed")}>
              {b.label}
            </Badge>
          );
        })}
      </div>
      {budgetNote ? <p className="text-xs text-muted">Budget: {budgetNote}</p> : null}
      {dish.source.evidence ? <p className="text-xs italic text-muted [overflow-wrap:anywhere]">“{dish.source.evidence}”</p> : null}
      <p className="text-xs text-muted">
        <a href={dish.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-line underline-offset-4 hover:text-ink">
          Menu{dish.source.page ? `, page ${dish.source.page}` : ""} <ExternalLink aria-hidden="true" className="size-3" />
        </a>
        <span className="sr-only"> (opens in a new tab)</span>
      </p>
    </div>
  );
}
