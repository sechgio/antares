export type DiffLine = {
  kind: 'context' | 'add' | 'remove';
  text: string;
  change?: [number, number];
};
export interface FileChange {
  hunks: DiffLine[][];
  added: number;
  removed: number;
  whole: boolean;
  starts: (number | null)[];
}

const MIN_SHARED = 0.4;

function shared(a: string, b: string): [number, number] {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const word = (char: string | undefined) => !!char && /\w/.test(char);
  const cutsStart = word(a[start]) || word(b[start]);
  while (cutsStart && start > 0 && word(a[start - 1])) start -= 1;
  const cutsEnd = word(a[a.length - end - 1]) || word(b[b.length - end - 1]);
  while (cutsEnd && end > 0 && word(a[a.length - end])) end -= 1;
  return [start, end];
}

export function markChanges(lines: DiffLine[]): DiffLine[] {
  const result = lines.map((line) => ({ ...line }));
  let i = 0;
  while (i < result.length) {
    if (result[i].kind !== 'remove') { i += 1; continue; }
    let added = i;
    while (added < result.length && result[added].kind === 'remove') added += 1;
    let end = added;
    while (end < result.length && result[end].kind === 'add') end += 1;
    for (let k = 0; k < Math.min(added - i, end - added); k += 1) {
      const before = result[i + k];
      const after = result[added + k];
      const [start, tail] = shared(before.text, after.text);
      if (start + tail < Math.max(before.text.length, after.text.length) * MIN_SHARED) continue;
      before.change = [start, before.text.length - tail];
      after.change = [start, after.text.length - tail];
    }
    i = end;
  }
  return result;
}

const MAX_LCS_CELLS = 40_000;

function lines(text: string): string[] {
  const parts = text.replace(/\r\n/g, '\n').split('\n');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? lines(before) : [];
  const b = after ? lines(after) : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'context', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'context', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    return [...head, ...midA.map((text): DiffLine => ({ kind: 'remove', text })),
      ...midB.map((text): DiffLine => ({ kind: 'add', text })), ...tail];
  }
  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = midA[i] === midB[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      middle.push({ kind: 'context', text: midA[i] }); i += 1; j += 1;
    } else if (i < midA.length && (j === midB.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      middle.push({ kind: 'remove', text: midA[i] }); i += 1;
    } else {
      middle.push({ kind: 'add', text: midB[j] }); j += 1;
    }
  }
  return [...head, ...middle, ...tail];
}

function count(hunks: DiffLine[][], kind: DiffLine['kind']): number {
  return hunks.reduce((total, hunk) => total + hunk.filter((line) => line.kind === kind).length, 0);
}

export function snippetStart(result: string | null | undefined, hunk: DiffLine[]): number | null {
  const fresh = hunk.filter((line) => line.kind !== 'remove').map((line) => line.text);
  if (!result || fresh.length === 0) return null;
  let snippet: unknown;
  try { snippet = (JSON.parse(result) as { snippet?: unknown }).snippet; } catch { return null; }
  if (typeof snippet !== 'string') return null;
  const rows = snippet.split('\n').map((row) => /^(\d+)\t(.*)$/.exec(row)).filter((row) => row !== null);
  const fits = (k: number) => !!rows[k] && rows[k][2].includes(fresh[0])
    && (fresh.length === 1 || !rows[k + fresh.length - 1] || rows[k + fresh.length - 1][2].includes(fresh[fresh.length - 1]));
  for (let k = Math.min(3, rows.length - 1); k >= 0; k -= 1) if (fits(k)) return Number(rows[k][1]);
  return null;
}

export function fileChange(method: string, params: Record<string, unknown>, result?: string | null): FileChange | null {
  let hunks: DiffLine[][];
  let starts: (number | null)[];
  if (method === 'fs_write') {
    if (typeof params.content !== 'string') return null;
    hunks = [diffLines('', params.content)];
    starts = [1];
  } else if (method === 'fs_edit') {
    const edits = Array.isArray(params.edits) ? params.edits : [params];
    const pairs = edits.map((edit: unknown) => (edit && typeof edit === 'object' && 'old' in edit && 'new' in edit
      && typeof edit.old === 'string' && typeof edit.new === 'string' ? [edit.old, edit.new] as const : null));
    if (pairs.length === 0 || !pairs.every((pair) => pair !== null)) return null;
    hunks = pairs.map((pair) => markChanges(diffLines(pair[0], pair[1])));
    starts = hunks.length === 1 ? [snippetStart(result, hunks[0])] : hunks.map(() => null);
  } else {
    return null;
  }
  return { hunks, added: count(hunks, 'add'), removed: count(hunks, 'remove'), whole: method === 'fs_write', starts };
}
