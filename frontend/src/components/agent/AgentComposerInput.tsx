import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import type { AgentProfile } from '../../api/agentApi';
import AgentAvatar from './AgentAvatar';

const mentionSelector = '[data-agent-mention]';

function draftParts(nodes: Iterable<ChildNode>) {
  let previous = '';
  let previousMention = false;
  return Array.from(nodes, (node) => {
    const token = node instanceof HTMLElement ? node.dataset.agentMention : undefined;
    const text = token ?? (node.nodeName === 'BR' ? '\n' : (node.textContent ?? ''));
    // A mention stays a separate token even if the user erases the space next to it.
    const gap =
      (token && /[\p{L}\p{N}_@/]$/u.test(previous)) || (previousMention && /^[a-zA-Z0-9_@-]/u.test(text)) ? ' ' : '';
    if (text) {
      previous = text;
      previousMention = !!token;
    }
    return { node, text, gap };
  });
}

function readDraft(editor: HTMLElement): string {
  const children = Array.from(editor.childNodes);
  const last = editor.lastChild;
  // Chromium adds an extra line break to keep the caret visible on an empty last line.
  if (last?.nodeName === 'BR' || (last?.textContent === '\n' && last.previousSibling?.textContent?.endsWith('\n'))) {
    children.pop();
  }
  return draftParts(children)
    .map(({ gap, text }) => gap + text)
    .join('');
}

function caretOffset(editor: HTMLElement, text: string): number {
  const selection = document.getSelection();
  if (!selection?.anchorNode || !editor.contains(selection.anchorNode)) return text.length;
  const prefix = document.createRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(selection.anchorNode, selection.anchorOffset);
  const before = draftParts(prefix.cloneContents().childNodes)
    .map(({ gap, text }) => gap + text)
    .join('');
  return Math.min(text.length, before.length);
}

function selectRange(editor: HTMLElement, start: number, end: number) {
  const parts = draftParts(editor.childNodes);
  const point = (offset: number): [Node, number] => {
    for (const [index, { node, text, gap }] of parts.entries()) {
      if (offset <= gap.length) return [editor, index];
      offset -= gap.length;
      if (node instanceof Text && offset <= text.length) return [node, offset];
      if (offset <= text.length) return [editor, index + 1];
      offset -= text.length;
    }
    return [editor, editor.childNodes.length];
  };
  const range = document.createRange();
  range.setStart(...point(start));
  range.setEnd(...point(end));
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function draftNodes(text: string, profiles: AgentProfile[]): Node[] {
  const nodes: Node[] = [];
  let start = 0;
  for (const match of text.matchAll(
    /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|(?<![\p{L}\p{N}_@/])@bot:([a-zA-Z0-9_-]+)/gu,
  )) {
    const profile = profiles.find(({ id }) => id === match[1]);
    if (!profile) continue;
    nodes.push(document.createTextNode(text.slice(start, match.index)));
    const mention = document.createElement('span');
    mention.className = 'agent-composer-mention';
    mention.contentEditable = 'false';
    mention.dataset.agentMention = match[0];
    mention.textContent = profile.name;
    nodes.push(mention);
    start = match.index + match[0].length;
  }
  nodes.push(document.createTextNode(text.slice(start)));
  return nodes;
}

export type AgentComposerInputHandle = {
  replace: (start: number, end: number, text: string) => void;
};

type Props = Pick<ComponentProps<'div'>, 'aria-controls' | 'aria-activedescendant' | 'onKeyDown' | 'onPaste'> & {
  ref: Ref<AgentComposerInputHandle>;
  value: string;
  profiles: AgentProfile[];
  placeholder: string;
  onEdit: (value: string, caret: number) => void;
  onMove: (caret: number) => void;
};

export default function AgentComposerInput({ ref, value, profiles, placeholder, onEdit, onMove, ...props }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const replacingRef = useRef(false);
  const [mentions, setMentions] = useState<HTMLElement[]>([]);

  function syncMentions(editor: HTMLDivElement) {
    const next = Array.from(editor.querySelectorAll<HTMLElement>(mentionSelector));
    setMentions((current) =>
      current.length === next.length && current.every((item, index) => item === next[index]) ? current : next,
    );
  }

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sameDraft = readDraft(editor) === value;
    if (sameDraft && !value.includes('@bot:')) return;
    const nodes = draftNodes(value, profiles);
    if (sameDraft) {
      const current = editor.querySelectorAll<HTMLElement>(mentionSelector);
      const next = nodes.filter((node) => node instanceof HTMLElement);
      if (
        current.length === next.length &&
        next.every(
          (node, index) =>
            node.dataset.agentMention === current[index].dataset.agentMention &&
            node.textContent === current[index].textContent,
        )
      )
        return;
    }
    const caret = sameDraft && document.activeElement === editor ? caretOffset(editor, value) : null;
    if (value.endsWith('\n')) nodes.push(document.createElement('br'));
    editor.replaceChildren(...nodes);
    if (caret !== null) selectRange(editor, caret, caret);
    syncMentions(editor);
  }, [value, profiles]);

  const handleSelection = useEffectEvent(() => {
    const editor = editorRef.current;
    if (editor && document.activeElement === editor) onMove(caretOffset(editor, readDraft(editor)));
  });
  useEffect(() => {
    const listener = () => handleSelection();
    document.addEventListener('selectionchange', listener);
    return () => document.removeEventListener('selectionchange', listener);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      replace(start, end, text) {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const range = selectRange(editor, start, end);
        const nodes = draftNodes(text, profiles);
        const contents = document.createElement('div');
        contents.append(...nodes);
        // Keep the browser's undo history for autocomplete and use plain-text editing elsewhere.
        replacingRef.current = true;
        editor.contentEditable = 'true';
        const inserted = document.execCommand?.('insertHTML', false, contents.innerHTML);
        editor.contentEditable = 'plaintext-only';
        replacingRef.current = false;
        if (!inserted) {
          range.deleteContents();
          const fragment = document.createDocumentFragment();
          fragment.append(...contents.childNodes);
          range.insertNode(fragment);
          selectRange(editor, start + text.length, start + text.length);
        }
        syncMentions(editor);
      },
    }),
    [profiles],
  );

  return (
    <>
      <div
        {...props}
        ref={editorRef}
        role="textbox"
        contentEditable="plaintext-only"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-label="Mensaje para el agente"
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        data-empty={value.length === 0}
        title="Intro para enviar · Mayús+Intro para otra línea · @ para mencionar · / para usar una skill"
        className="agent-composer-input block w-full bg-transparent text-[14px] leading-5 text-[var(--text-primary)] outline-none"
        onInput={(event) => {
          if (replacingRef.current) return;
          const editor = event.currentTarget;
          const text = readDraft(editor);
          syncMentions(editor);
          onEdit(text, caretOffset(editor, text));
        }}
      />
      {mentions.map((mention, index) => {
        const profile = profiles.find(({ id }) => mention.dataset.agentMention === `@bot:${id}`);
        return profile
          ? createPortal(
              <span aria-hidden="true" className="agent-composer-mention-icon">
                <AgentAvatar seed={profile.id} color={profile.color} name={profile.name} size={15} />
              </span>,
              mention,
              String(index),
            )
          : null;
      })}
    </>
  );
}
