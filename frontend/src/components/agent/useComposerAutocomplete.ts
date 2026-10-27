import { useState, type KeyboardEvent } from 'react';

export type ComposerTrigger<T> = Readonly<{
  id: string;
  pattern: RegExp;
  options: (match: RegExpMatchArray) => readonly T[];
}>;

export type ComposerSuggestion<T> = Readonly<{
  id: string;
  start: number;
  end: number;
  options: readonly T[];
  selected: T | undefined;
}>;

export function useComposerAutocomplete<T>(draft: string, triggers: readonly ComposerTrigger<T>[]) {
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  let suggestion: ComposerSuggestion<T> | null = null;
  if (!hidden) {
    const before = draft.slice(0, cursor);
    for (const trigger of triggers) {
      const match = before.match(trigger.pattern);
      if (!match) continue;
      const options = trigger.options(match);
      suggestion = {
        id: trigger.id,
        start: cursor - match[0].length + (/^\s/u.test(match[0]) ? 1 : 0),
        end: cursor,
        options,
        selected: options[Math.min(index, Math.max(0, options.length - 1))],
      };
      break;
    }
  }
  return {
    suggestion,
    edited: (caret: number) => { setCursor(caret); setIndex(0); setHidden(false); },
    moved: (caret: number) => setCursor(caret),
    close: (caret?: number) => { if (caret !== undefined) setCursor(caret); setHidden(true); },
    keyDown: (event: KeyboardEvent, pick: (option: T, suggestion: ComposerSuggestion<T>) => void) => {
      if (!suggestion) return false;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setHidden(true); return true; }
      const { options, selected } = suggestion;
      if (selected === undefined || event.shiftKey || !['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) return false;
      event.preventDefault();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setIndex((options.indexOf(selected) + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      } else pick(selected, suggestion);
      return true;
    },
  };
}
