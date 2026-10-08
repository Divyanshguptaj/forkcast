import { ConflictingRequestError, UnsupportedCityError } from "../discovery/nlUnderstand";
import { NaturalLanguageUnavailableError } from "../discovery/understand";
import { PlacesError } from "../providers/places/errors";

const FRIENDLY: Array<[(e: unknown) => boolean, { code: string; message: string; recoverable: boolean }]> = [
  [(e) => e instanceof ConflictingRequestError, { code: "conflicting_request", message: "", recoverable: false }],
  [(e) => e instanceof UnsupportedCityError, { code: "unsupported_city", message: "", recoverable: false }],
  [(e) => e instanceof NaturalLanguageUnavailableError, { code: "invalid_request", message: "Tell Forkcast what you are looking for, or pick a few filters.", recoverable: false }],
];

export function describeFailure(err: unknown): { code: string; message: string; recoverable: boolean } {
  for (const [test, info] of FRIENDLY) if (test(err)) return { ...info, message: info.message || (err as Error).message.slice(0, 300) };
  if (err instanceof PlacesError) return { code: `places_${err.code}`, message: "The restaurant directory is unavailable right now. Please try again in a moment.", recoverable: true };
  return { code: "internal", message: "Something went wrong while researching. Please try again.", recoverable: true };
}

