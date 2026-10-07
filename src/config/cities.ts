export interface CityConfig {
  id: string;
  name: string;
  country: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
  menuLanguages: Array<"ca" | "es" | "en">;
}

export const CITIES: Record<string, CityConfig> = {
  barcelona: {
    id: "barcelona",
    name: "Barcelona",
    country: "ES",
    center: { lat: 41.3874, lng: 2.1686 },
    radiusMeters: 6_000,
    menuLanguages: ["ca", "es", "en"],
  },
};

export function getCity(id: string): CityConfig | undefined {
  return CITIES[id.trim().toLowerCase()];
}
