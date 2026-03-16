export function normalizeMonacoRenderedText(value: string): string {
  return value.replaceAll("\u00a0", " ").replaceAll("\u200b", "");
}

export function joinMonacoRenderedLines(lines: readonly string[]): string {
  return lines.map((line) => normalizeMonacoRenderedText(line)).join("\n");
}

export function didMonacoContentChange(
  before: string,
  after: string,
  tagged: string
): boolean {
  if (before === after) {
    return false;
  }

  return normalizeMonacoRenderedText(after).includes(
    normalizeMonacoRenderedText(tagged)
  );
}
