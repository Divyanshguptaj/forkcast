export function Hero() {
  return (
    <header className="space-y-4">
      <p className="inline-flex items-center gap-2 rounded-full border-2 border-line bg-surface px-3 py-1 text-sm font-semibold text-muted">
        <span aria-hidden="true">🍴</span> Forkcast <span className="text-line" aria-hidden="true">/</span> Barcelona first
      </p>
      <h1 className="text-balance text-5xl font-extrabold sm:text-6xl lg:text-7xl">
        Tell us what you&apos;re <span className="text-saffron">hungry</span> for.
      </h1>
      <p className="max-w-2xl text-pretty text-lg text-muted sm:text-xl">
        Forkcast researches real restaurants, reads their menus and checks what diners say, then shows you why each place made the cut.
      </p>
      <ol className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm font-semibold text-ink" aria-label="How it works">
        <li>
          <span aria-hidden="true">📍 </span>Search
        </li>
        <li>
          <span aria-hidden="true">📖 </span>Read menus
        </li>
        <li>
          <span aria-hidden="true">💬 </span>Check reviews
        </li>
        <li>
          <span aria-hidden="true">🏆 </span>Rank
        </li>
      </ol>
    </header>
  );
}
