export type InternalCopy = { start: number; end: number; text: string };

export function sourceKind(
  source: { id: number; kind?: string },
  current: { id: number; kind?: string }[],
) {
  return source.kind === 'internal_note' ||
    current.find((document) => document.id === source.id)?.kind ===
      'internal_note'
    ? 'internal_note'
    : 'help_article';
}

export function internalDocuments<
  Document extends { id: number; body: string; title?: string; kind?: string },
>(current: Document[], snapshots: Document[]) {
  return [
    ...current.filter((document) => document.kind === 'internal_note'),
    ...snapshots.filter(
      (document) => sourceKind(document, current) === 'internal_note',
    ),
  ];
}

export function internalCopies(
  reply: string,
  notes: { body: string; title?: string }[],
): InternalCopy[] {
  const tokens = [...reply.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)];
  const words = tokens.map((token) => token[0].normalize('NFC').toLowerCase());
  const phrases = new Set<string>();
  for (const note of notes) {
    for (const text of [note.title ?? '', note.body]) {
      const noteWords =
        text
          .normalize('NFC')
          .toLowerCase()
          .match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
      for (let index = 0; index <= noteWords.length - 8; index++)
        phrases.add(noteWords.slice(index, index + 8).join(' '));
    }
  }
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index <= words.length - 8; index++) {
    if (!phrases.has(words.slice(index, index + 8).join(' '))) continue;
    const start = tokens[index].index!;
    const end = tokens[index + 7].index! + tokens[index + 7][0].length;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end)
      previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  return ranges.map(({ start, end }) => ({
    start,
    end,
    text: reply.slice(start, end),
  }));
}
