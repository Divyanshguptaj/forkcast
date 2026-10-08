import { Badge } from "@/components/shared/Badge";
import type { VegetarianStatusValue } from "@/schemas/menu";

const COPY: Record<VegetarianStatusValue, { label: string; tone: "basil" | "neutral" | "chili"; icon: string; hint: string }> = {
  confirmed_vegetarian: { label: "Vegetarian", tone: "basil", icon: "✓", hint: "The menu says so, or lists every ingredient." },
  likely_vegetarian: { label: "Likely vegetarian", tone: "basil", icon: "🌱", hint: "Usually vegetarian, but the menu doesn't say. Ask to be sure." },
  unknown: { label: "Unclear", tone: "neutral", icon: "?", hint: "Not enough information on the menu." },
  contains_meat_or_fish: { label: "Contains meat or fish", tone: "chili", icon: "✕", hint: "Meat, fish or shellfish is named on the menu." },
};

export function DietBadge({ status, className }: { status: VegetarianStatusValue; className?: string }) {
  const copy = COPY[status];
  const dashed = status === "likely_vegetarian" ? "border-dashed" : "";
  return (
    <Badge tone={copy.tone} icon={copy.icon} title={copy.hint} className={`${dashed} ${className ?? ""}`.trim()}>
      {copy.label}
    </Badge>
  );
}
