import type { ReactNode } from 'react';

export interface MarkdownListItem {
  text: string;
  depth: number;
  kind: 'ul' | 'ol';
  start?: number;
}

type ListNode = {
  item: MarkdownListItem;
  children: ListNode[];
};

type RenderInline = (value: string, key: string) => ReactNode[];

function listTree(items: MarkdownListItem[]): ListNode[] {
  const root: ListNode[] = [];
  const stack: { depth: number; children: ListNode[] }[] = [{ depth: -1, children: root }];
  for (const item of items) {
    while (item.depth <= stack[stack.length - 1].depth) stack.pop();
    const node: ListNode = { item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ depth: item.depth, children: node.children });
  }
  return root;
}

function itemContent(item: MarkdownListItem, key: string, renderInline: RenderInline) {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(item.text);
  if (!task) return renderInline(item.text, key);
  return (
    <span className="flex items-start gap-2">
      <input type="checkbox" checked={task[1] !== ' '} readOnly disabled className="mt-[5px] shrink-0" />
      <span className={task[1] !== ' ' ? 'text-[var(--text-muted)] line-through' : undefined}>
        {renderInline(task[2], key)}
      </span>
    </span>
  );
}

function groupNodes(nodes: ListNode[]) {
  const groups: { kind: 'ul' | 'ol'; nodes: ListNode[] }[] = [];
  for (const node of nodes) {
    const latest = groups[groups.length - 1];
    if (latest?.kind === node.item.kind) latest.nodes.push(node);
    else groups.push({ kind: node.item.kind, nodes: [node] });
  }
  return groups;
}

function renderNodes(
  nodes: ListNode[],
  keyPrefix: string,
  renderInline: RenderInline,
  cursor?: ReactNode,
  nested = false,
) {
  return groupNodes(nodes).map((group, groupIndex, groups) => {
    const List = group.kind;
    const key = `${keyPrefix}-${groupIndex}`;
    const start = group.kind === 'ol' ? group.nodes[0].item.start : undefined;
    return (
      <List
        key={key}
        {...(start !== undefined ? { start } : {})}
        className={`${nested || groupIndex > 0 ? 'mt-1 ' : ''}space-y-1 pl-5 ${group.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}
      >
        {group.nodes.map((node, index) => {
          const itemKey = `${key}-${index}`;
          const tailCursor =
            cursor && groupIndex === groups.length - 1 && index === group.nodes.length - 1 ? cursor : undefined;
          const task = node.item.kind === 'ul' && /^\[[ xX]\]\s+/.test(node.item.text);
          return (
            <li key={itemKey} className={task ? '-ml-5 list-none' : undefined}>
              {node.item.kind === 'ul'
                ? itemContent(node.item, itemKey, renderInline)
                : renderInline(node.item.text, itemKey)}
              {node.children.length > 0
                ? renderNodes(node.children, itemKey, renderInline, tailCursor, true)
                : tailCursor}
            </li>
          );
        })}
      </List>
    );
  });
}

export default function MarkdownList({
  items,
  renderInline,
  itemKey,
  cursor,
}: {
  items: MarkdownListItem[];
  renderInline: RenderInline;
  itemKey: string;
  cursor?: ReactNode;
}) {
  return <>{renderNodes(listTree(items), itemKey, renderInline, cursor)}</>;
}
