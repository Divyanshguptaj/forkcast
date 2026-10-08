interface ArtProps {
  className?: string;
}

const OUT = "#14110f";

export function Tomato({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <circle cx="50" cy="56" r="34" fill="#ff5a36" stroke={OUT} strokeWidth="3" />
      <path d="M50 24l-8 8 8-3 8 3zM50 24c-4-8-10-10-14-9M50 24c4-8 10-10 14-9" fill="#3ddc84" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M33 48c3-7 9-10 14-10" stroke="#f6efe4" strokeWidth="4" strokeLinecap="round" opacity=".6" fill="none" />
    </svg>
  );
}

export function Lemon({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <ellipse cx="50" cy="52" rx="38" ry="28" fill="#ffc83d" stroke={OUT} strokeWidth="3" />
      <path d="M86 52l8-4-2 8z" fill="#ffc83d" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M26 44c4-6 10-8 16-8" stroke="#f6efe4" strokeWidth="4" strokeLinecap="round" opacity=".7" fill="none" />
    </svg>
  );
}

export function Chilli({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <path d="M26 22c30-8 52 14 46 52-2 10-10 14-14 6 4-26-10-38-34-34-8-2-6-20 2-24z" fill="#ff5a36" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M24 24l-8-8" stroke="#3ddc84" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

export function PizzaSlice({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className={className}>
      <path d="M50 92L12 24c24-12 52-12 76 0z" fill="#ffc83d" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M12 24c24-12 52-12 76 0" stroke="#d68a2e" strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="42" cy="44" r="7" fill="#ff5a36" stroke={OUT} strokeWidth="2.5" />
      <circle cx="60" cy="52" r="6" fill="#ff5a36" stroke={OUT} strokeWidth="2.5" />
      <circle cx="50" cy="68" r="5" fill="#ff5a36" stroke={OUT} strokeWidth="2.5" />
    </svg>
  );
}

export function Squiggle({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 150 16" className={className} preserveAspectRatio="none">
      <path d="M2 10c14-10 24 8 38 0s24 8 38 0 24 8 38 0 20 6 32-2" stroke="#ffc83d" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function CurlyArrow({ className }: ArtProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 30" className={className}>
      <path d="M4 4c14 2 24 10 28 22M32 26l-8-2m8 2l2-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
