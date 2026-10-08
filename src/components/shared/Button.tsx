import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-control border-2 font-semibold transition-[transform,box-shadow,background-color] duration-150 ease-snap disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-ink bg-tomato text-bg shadow-pop-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-pop active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
  secondary:
    "border-ink/70 bg-surface-2 text-ink shadow-soft hover:-translate-y-px hover:border-ink active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
  ghost: "border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-ink",
};

const SIZES: Record<Size, string> = {
  md: "min-h-12 px-5 py-2.5 text-base",
  sm: "min-h-10 px-3.5 py-2 text-sm",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  external?: boolean;
  children: ReactNode;
}

export function ButtonLink({ variant = "secondary", size = "sm", external = true, className, ...rest }: ButtonLinkProps) {
  const ext = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return <a className={buttonClasses(variant, size, className)} {...ext} {...rest} />;
}
