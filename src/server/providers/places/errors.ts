export type PlacesErrorCode =
  | "missing_api_key"
  | "bad_request"
  | "auth"
  | "rate_limited"
  | "server"
  | "timeout"
  | "aborted"
  | "network"
  | "invalid_response";

export class PlacesError extends Error {
  constructor(
    readonly code: PlacesErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

export function codeForStatus(status: number): PlacesErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}
