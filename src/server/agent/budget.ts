import { GeminiError, type GeminiStats } from "../providers/gemini/client";
import { TavilyError } from "../providers/tavily/client";
import type { CallContext, ExtractedPage, LlmProvider, LlmStructuredRequest, LlmStructuredResult, SearchHit, WebSearchProvider } from "../providers/types";

export class RunBudget {
  llmCalls = 0;
  tavilyCalls = 0;
  llmExhausted = false;
  tavilyExhausted = false;

  constructor(
    readonly maxLlmCalls: number,
    readonly maxTavilyCalls: number,
  ) {}
}

export type BudgetedLlm = LlmProvider & { stats?: GeminiStats };

export function budgetedLlm(inner: BudgetedLlm, budget: RunBudget): BudgetedLlm {
  return {
    get stats() {
      return inner.stats;
    },
    available: () => {
      if (budget.llmCalls >= budget.maxLlmCalls) {
        budget.llmExhausted = true;
        return false;
      }
      return inner.available?.() !== false;
    },
    async generateStructured<T>(req: LlmStructuredRequest<T>, ctx?: CallContext): Promise<LlmStructuredResult<T>> {
      if (budget.llmCalls >= budget.maxLlmCalls) {
        budget.llmExhausted = true;
        throw new GeminiError("budget_exhausted", "The AI call limit for this search was reached");
      }
      budget.llmCalls++;
      return inner.generateStructured(req, ctx);
    },
  };
}

export function budgetedSearch(inner: WebSearchProvider, budget: RunBudget): WebSearchProvider {
  const take = () => {
    if (budget.tavilyCalls >= budget.maxTavilyCalls) {
      budget.tavilyExhausted = true;
      throw new TavilyError("budget_exhausted", "The web search limit for this search was reached");
    }
    budget.tavilyCalls++;
  };
  return {
    async search(query: string, opts: { maxResults: number; includeImages?: boolean }, ctx?: CallContext): Promise<SearchHit[]> {
      take();
      return inner.search(query, opts, ctx);
    },
    async extract(urls: string[], opts: { includeImages?: boolean }, ctx?: CallContext): Promise<{ pages: ExtractedPage[]; failed: Array<{ url: string; error: string }> }> {
      take();
      return inner.extract(urls, opts, ctx);
    },
  };
}
