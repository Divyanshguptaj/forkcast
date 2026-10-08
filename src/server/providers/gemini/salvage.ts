// Closes a JSON document that was cut off mid-stream, keeping only fully closed values.
export function salvageTruncatedJson(text: string): unknown | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let safeEnd = -1;
  let safeStack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      safeEnd = i + 1;
      safeStack = [...stack];
    }
  }
  if (safeEnd < 0) return undefined;
  const repaired = text.slice(0, safeEnd).replace(/,\s*$/, "") + [...safeStack].reverse().join("");
  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}
