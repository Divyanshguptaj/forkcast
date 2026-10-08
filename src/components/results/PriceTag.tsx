import { Camera } from "lucide-react";
import type { PriceStatusValue } from "@/schemas/menu";
import { cx } from "@/lib/cx";

interface Props {
  price?: number;
  status: PriceStatusValue;
  className?: string;
}

const formatter = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

export function PriceTag({ price, status, className }: Props) {
  if (status === "disputed") {
    return (
      <span className={cx("tabular inline-flex items-center gap-1.5 text-sm text-muted", className)} title="The price on the photo was hard to read, so Forkcast hides it.">
        € -- <span className="font-sans text-xs font-semibold text-chili">Price unclear</span>
      </span>
    );
  }
  if (status === "absent" || price === undefined) {
    return <span className={cx("text-xs font-semibold text-muted", className)}>No price listed</span>;
  }
  return (
    <span className={cx("tabular inline-flex items-center gap-1.5 text-sm font-bold text-ink", className)}>
      {formatter.format(price)}
      {status === "ocr_agreed" ? (
        <span title="Read from a photo and confirmed by a second read." className="inline-flex">
          <Camera aria-label="Read from a photo" className="size-3.5 text-muted" />
        </span>
      ) : null}
      {status === "unverified" ? <span className="font-sans text-xs font-semibold text-saffron">unverified</span> : null}
    </span>
  );
}
