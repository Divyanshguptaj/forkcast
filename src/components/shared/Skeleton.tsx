import { cx } from "@/lib/cx";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("relative overflow-hidden rounded-md bg-surface-2 sweep-bar", className)} />;
}
