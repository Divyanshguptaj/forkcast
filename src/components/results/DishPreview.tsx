import type { MenuItemPreview } from "@/schemas/menu";
import { DietBadge } from "./DietBadge";
import { PriceTag } from "./PriceTag";
import { SourceIndicator } from "./SourceIndicator";

export function DishPreview({ item }: { item: MenuItemPreview }) {
  const translated = item.translatedName.toLowerCase() !== item.originalName.toLowerCase();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {translated ? "Original" : "Dish"}
          {item.priceStatus === "ocr_agreed" ? " · from photo" : ""}
        </p>
        <p className="truncate font-display text-lg font-bold leading-tight text-ink">
          {item.originalName}
        </p>
        {translated ? (
          <p className="text-sm text-muted">
            <span className="sr-only">English: </span>
            {item.translatedName}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2.5">
        <DietBadge status={item.vegetarian} />
        <PriceTag price={item.price} status={item.priceStatus} />
        <SourceIndicator kind={item.priceStatus === "disputed" ? "uncertain" : "extracted"} />
      </div>
    </div>
  );
}
