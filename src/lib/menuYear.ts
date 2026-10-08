export function menuYear(url: string): number | undefined {
  const years = [...url.matchAll(/(?<![0-9])(20[12][0-9])(?![0-9])/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : undefined;
}
