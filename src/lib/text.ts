export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || index === lines.length - 1);
}

export function chunkText(input: string, maxChars = 900): string[] {
  const chunks: string[] = [];
  let buffer = '';

  for (const paragraph of input.split(/\n{2,}/)) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = '';
    }

    if (paragraph.length <= maxChars) {
      buffer = paragraph;
      continue;
    }

    let segment = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = segment ? `${segment} ${word}` : word;
      if (next.length > maxChars) {
        if (segment) chunks.push(segment);
        segment = word;
      } else {
        segment = next;
      }
    }
    if (segment) chunks.push(segment);
  }

  if (buffer) chunks.push(buffer);
  return chunks.length > 0 ? chunks : [''];
}

export function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}
