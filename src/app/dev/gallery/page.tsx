import type { Metadata } from "next";
import { MenuTicket } from "@/components/research/MenuTicket";
import { DietBadge } from "@/components/results/DietBadge";
import { MatchRing } from "@/components/results/MatchRing";
import { PriceTag } from "@/components/results/PriceTag";
import { RecommendationCardShell } from "@/components/results/RecommendationCardShell";
import { SourceIndicator } from "@/components/results/SourceIndicator";
import { Badge, DemoSticker } from "@/components/shared/Badge";
import { Button } from "@/components/shared/Button";
import { Chip } from "@/components/shared/Chip";
import { NOTICE_COPY, StatusNotice, type NoticeKind } from "@/components/states/StatusNotice";
import { RESULT_PREVIEW } from "@/mocks/replay/resultPreview";

export const metadata: Metadata = { title: "Design gallery · Forkcast", robots: { index: false } };

const SWATCHES = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-2", "bg-surface-2"],
  ["line", "bg-line"],
  ["ink", "bg-ink"],
  ["muted", "bg-muted"],
  ["tomato", "bg-tomato"],
  ["saffron", "bg-saffron"],
  ["basil", "bg-basil"],
  ["chili", "bg-chili"],
] as const;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

export default function Gallery() {
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-5xl font-extrabold">Forkcast design gallery</h1>
        <p className="text-muted">Tokens and components used by the app. Data shown here is for visual development only.</p>
      </header>

      <Block title="Palette">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, cls]) => (
            <li key={name} className="space-y-1.5">
              <div className={`${cls} h-14 rounded-control border-2 border-ink/40`} />
              <p className="text-xs font-semibold">{name}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Type">
        <p className="font-display text-5xl font-extrabold">Bricolage Grotesque, display</p>
        <p className="text-lg">DM Sans for reading. Menus, dishes and everything a user has to scan fast.</p>
        <p className="tabular text-lg">€6.50 · 4.8 ★ (3,120) · 0.5 km — JetBrains Mono for numbers</p>
      </Block>

      <Block title="Buttons and chips">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Find my table</Button>
          <Button variant="secondary">Edit search</Button>
          <Button variant="ghost">Cancel</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip emoji="🌱" tone="basil" selected>
            Vegetarian
          </Chip>
          <Chip emoji="🍝">Italian</Chip>
          <Chip emoji="🌙" selected>
            Dinner
          </Chip>
          <Chip>Quiet</Chip>
        </div>
      </Block>

      <Block title="Diet, price and provenance">
        <div className="flex flex-wrap items-center gap-3">
          <DietBadge status="confirmed_vegetarian" />
          <DietBadge status="likely_vegetarian" />
          <DietBadge status="unknown" />
          <DietBadge status="contains_meat_or_fish" />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <PriceTag price={6.5} status="verified" />
          <PriceTag price={4.5} status="ocr_agreed" />
          <PriceTag status="disputed" />
          <PriceTag status="absent" />
          <PriceTag price={9.9} status="unverified" />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <SourceIndicator kind="retrieved" showLabel />
          <SourceIndicator kind="extracted" showLabel />
          <SourceIndicator kind="inferred" showLabel />
          <SourceIndicator kind="uncertain" showLabel />
          <Badge tone="saffron">Badge</Badge>
          <DemoSticker />
          <MatchRing percent={92} mock />
        </div>
      </Block>

      <Block title="Menu ticket">
        <MenuTicket items={RESULT_PREVIEW[1].dishes} demo caption="1 menu document" />
      </Block>

      <Block title="Notices and degraded states">
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(NOTICE_COPY) as NoticeKind[]).map((kind) => (
            <StatusNotice key={kind} kind={kind} compact />
          ))}
        </div>
      </Block>

      <Block title="Recommendation card shell">
        <RecommendationCardShell {...RESULT_PREVIEW[0]} />
      </Block>
    </main>
  );
}
