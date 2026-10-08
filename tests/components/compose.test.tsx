// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchComposer } from "@/components/compose/SearchComposer";
import { PreferenceChips } from "@/components/compose/PreferenceChips";
import { DEFAULT_COMPOSER, summarize, toRecommendBody, toggleIn, type ComposerState } from "@/components/compose/composerModel";
import { RecommendRequestBody } from "@/schemas/request";
import { useState } from "react";

function Harness({ onChange }: { onChange?: (s: ComposerState) => void }) {
  const [state, setState] = useState<ComposerState>(DEFAULT_COMPOSER);
  return (
    <PreferenceChips
      state={state}
      onChange={(p) =>
        setState((s) => {
          const next = { ...s, ...p };
          onChange?.(next);
          return next;
        })
      }
    />
  );
}

describe("composer model", () => {
  it("builds a request body the API schema accepts", () => {
    const body = toRecommendBody({ ...DEFAULT_COMPOSER, text: "  vegetarian dinner  ", diet: ["vegetarian"], cuisines: ["Italian"], budgetMax: 30, allergies: ["peanuts"] });
    expect(RecommendRequestBody.safeParse(body).success).toBe(true);
    expect(body.text).toBe("vegetarian dinner");
    expect(body.form).toMatchObject({ city: "Barcelona", meal: "dinner", diet: ["vegetarian"], cuisines: ["Italian"], allergies: ["peanuts"], budget: { max: 30, currency: "EUR" } });
  });

  it("omits the budget when 'any budget' is chosen and keeps free text out of the structured fields", () => {
    const body = toRecommendBody({ ...DEFAULT_COMPOSER, text: "Somewhere not too crowded" });
    expect(body.form?.budget).toBeUndefined();
    expect(body.form?.preferences).toBeUndefined();
    expect(body.form?.rawText).toBe("Somewhere not too crowded");
  });

  it("summarizes the selection", () => {
    expect(summarize({ ...DEFAULT_COMPOSER, diet: ["vegan"], cuisines: ["Italian"], budgetMax: 25 })).toEqual(["Barcelona", "Dinner", "Vegan", "Italian", "Under €25"]);
  });

  it("toggles list membership", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("SearchComposer", () => {
  it("labels the sentence box and states what is and isn't understood", () => {
    render(<SearchComposer onSubmit={() => undefined} />);
    expect(screen.getByLabelText("What are you hungry for?")).toBeInTheDocument();
    expect(screen.getByText(/free-text sentences comes in a later release/i)).toBeInTheDocument();
  });

  it("fills both the sentence and the filters from an example", async () => {
    const user = userEvent.setup();
    render(<SearchComposer onSubmit={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /Vegan brunch somewhere relaxed/ }));
    expect(screen.getByLabelText("What are you hungry for?")).toHaveValue("Vegan brunch somewhere relaxed");
    expect(screen.getByRole("button", { name: /Meal.*Brunch/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diet.*Vegan/ })).toBeInTheDocument();
  });

  it("submits the structured body and the state", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SearchComposer onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: /Romantic Italian dinner/ }));
    await user.click(screen.getByRole("button", { name: /Find my table/ }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const [body, state] = onSubmit.mock.calls[0];
    expect(body.form).toMatchObject({ cuisines: ["Italian"], budget: { max: 40 }, mustHave: ["Quiet"] });
    expect(state.text).toBe("Romantic Italian dinner, around €40");
  });

  it("does not submit while busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SearchComposer onSubmit={onSubmit} busy />);
    expect(screen.getByRole("button", { name: /Find my table/ })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("PreferenceChips", () => {
  it("opens one panel at a time with correct aria-expanded and aria-controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const diet = screen.getByRole("button", { name: /Diet/ });
    const meal = screen.getByRole("button", { name: /Meal/ });
    expect(diet).toHaveAttribute("aria-expanded", "false");
    await user.click(diet);
    expect(diet).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(diet.getAttribute("aria-controls")!)).toBeInTheDocument();
    await user.click(meal);
    expect(diet).toHaveAttribute("aria-expanded", "false");
    expect(meal).toHaveAttribute("aria-expanded", "true");
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const diet = screen.getByRole("button", { name: /Diet/ });
    diet.focus();
    await user.keyboard("{Enter}");
    expect(diet).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(diet).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles diet chips with aria-pressed and reflects them in the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Diet/ }));
    const group = screen.getByRole("group", { name: "Dietary preferences" });
    const veg = within(group).getByRole("button", { name: "Vegetarian" });
    expect(veg).toHaveAttribute("aria-pressed", "false");
    await user.click(veg);
    expect(veg).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Gluten-free" }));
    expect(screen.getByRole("button", { name: /Diet/ })).toHaveTextContent("Vegetarian, Gluten-free");
    await user.click(veg);
    expect(veg).toHaveAttribute("aria-pressed", "false");
  });

  it("meal is a single-choice radio group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Meal/ }));
    const radios = within(screen.getByRole("radiogroup", { name: "Meal" })).getAllByRole("radio");
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    await user.click(screen.getByRole("radio", { name: /Breakfast/ }));
    expect(screen.getByRole("radio", { name: /Breakfast/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Dinner/ })).toHaveAttribute("aria-checked", "false");
  });

  it("budget can be unset and set again", async () => {
    const user = userEvent.setup();
    const seen: Array<number | null> = [];
    render(<Harness onChange={(s) => seen.push(s.budgetMax)} />);
    await user.click(screen.getByRole("button", { name: /Budget/ }));
    expect(screen.getByText("No limit")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum budget per person in euros")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Any budget" }));
    expect(screen.getByText("Under €30 per person")).toBeInTheDocument();
    expect(seen.at(-1)).toBe(30);
    await user.click(screen.getByRole("button", { name: "Any budget" }));
    expect(seen.at(-1)).toBeNull();
  });

  it("adds custom cuisines and allergies, and removes them again", async () => {
    const user = userEvent.setup();
    let latest = DEFAULT_COMPOSER;
    render(<Harness onChange={(s) => (latest = s)} />);
    await user.click(screen.getByRole("button", { name: /Cuisine/ }));
    await user.type(screen.getByLabelText("Add another cuisine"), "Peruvian{Enter}");
    expect(latest.cuisines).toEqual(["Peruvian"]);
    await user.click(screen.getByRole("button", { name: "Remove Peruvian" }));
    expect(latest.cuisines).toEqual([]);

    await user.click(screen.getByRole("button", { name: /More filters/ }));
    await user.type(await screen.findByLabelText("Add an allergy"), "peanuts{Enter}");
    expect(latest.allergies).toEqual(["peanuts"]);
    expect(screen.getByRole("button", { name: /More filters/ })).toHaveTextContent("1 set");
  });

  it("warns that allergen safety can't be guaranteed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /More filters/ }));
    expect(await screen.findByText(/can't guarantee allergen safety/i)).toBeInTheDocument();
  });
});
