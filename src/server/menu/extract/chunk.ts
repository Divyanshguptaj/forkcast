export interface ChunkResult {
  chunks: string[];
  droppedChars: number;
}

function splitLongLine(line: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += size) parts.push(line.slice(i, i + size));
  return parts;
}

export function splitIntoChunks(text: string, chunkChars: number, maxChunks: number): ChunkResult {
  if (text.length <= chunkChars) return { chunks: [text], droppedChars: 0 };
  const count = Math.min(maxChunks, Math.ceil(text.length / chunkChars));
  const target = Math.min(chunkChars, Math.ceil(text.length / count));
  const lines = text.split("\n").flatMap((line) => (line.length > chunkChars ? splitLongLine(line, chunkChars) : [line]));

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  let consumed = 0;
  for (const line of lines) {
    if (length + line.length + 1 > target && current.length > 0 && chunks.length < count - 1) {
      chunks.push(current.join("\n"));
      current = [];
      length = 0;
    }
    if (chunks.length === count - 1 && length + line.length + 1 > chunkChars) break;
    current.push(line);
    length += line.length + 1;
    consumed += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  return { chunks, droppedChars: Math.max(0, text.length - consumed) };
}
