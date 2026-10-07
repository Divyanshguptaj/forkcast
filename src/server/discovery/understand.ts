import { getEnv } from "@/config/env";
import { getCity } from "@/config/cities";
import { UserRequestSchema, type RecommendRequestBodyType, type UserRequest } from "@/schemas/request";

export interface RequestUnderstander {
  understand(body: RecommendRequestBodyType): Promise<UserRequest>;
}

export class NaturalLanguageUnavailableError extends Error {
  constructor() {
    super("Free-text parsing is not available yet; send structured form fields.");
    this.name = "NaturalLanguageUnavailableError";
  }
}

export class StructuredRequestUnderstander implements RequestUnderstander {
  constructor(private readonly defaultCity: () => string = () => getCity(getEnv().DEFAULT_CITY)?.name ?? "Barcelona") {}

  async understand(body: RecommendRequestBodyType): Promise<UserRequest> {
    if (!body.form) throw new NaturalLanguageUnavailableError();
    return UserRequestSchema.parse({
      ...body.form,
      city: body.form.city ?? this.defaultCity(),
      rawText: body.text ?? body.form.rawText,
    });
  }
}
