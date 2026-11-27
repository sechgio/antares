import { useEffect, useRef, useState } from 'react';
import type { AgentAttachment, AgentSession, AgentSkill } from '../../api/agentApi';

type Draft = {
  text: string;
  attachments: (AgentAttachment & { preview?: string })[];
  skill: AgentSkill | null;
  version: number;
};

const EMPTY: Draft = { text: '', attachments: [], skill: null, version: 0 };
const storageKey = (id: string) => `antares-agent-draft:${id}`;

function storedText(id: string) {
  try {
    return localStorage.getItem(storageKey(id)) ?? '';
  } catch {
    return '';
  }
}

function storeText(id: string, text: string) {
  try {
    if (text) localStorage.setItem(storageKey(id), text);
    else localStorage.removeItem(storageKey(id));
  } catch {
    // A full or disabled store leaves the draft available in memory.
  }
}

export function useConversationDrafts(sessionId: string, sessions: AgentSession[]) {
  const drafts = useRef(new Map<string, Draft>());
  const privateSessions = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState(drafts.current);

  const canPersist = (id: string) =>
    !!id && !privateSessions.current.has(id) && !sessions.some((session) => session.id === id && session.incognito);

  useEffect(() => {
    for (const session of sessions) {
      if (session.incognito) storeText(session.id, '');
    }
  }, [sessions]);

  const read = (map: Map<string, Draft>, id: string): Draft =>
    map.get(id) ?? (canPersist(id) ? { ...EMPTY, text: storedText(id) } : EMPTY);

  const publish = (next: Map<string, Draft>) => {
    drafts.current = next;
    setSnapshot(next);
  };

  const update = (id: string, change: (draft: Draft) => Partial<Draft>, edited = false) => {
    if (removed.current.has(id)) return;
    const current = read(drafts.current, id);
    const next = { ...current, ...change(current), version: current.version + Number(edited) };
    publish(new Map(drafts.current).set(id, next));
    if (next.text !== current.text && canPersist(id)) storeText(id, next.text);
  };

  return {
    current: read(snapshot, sessionId),
    version: (id: string) => read(drafts.current, id).version,
    update,
    adoptNew: (id: string) => {
      const next = new Map(drafts.current).set(id, read(drafts.current, ''));
      next.delete('');
      publish(next);
      if (canPersist(id)) storeText(id, next.get(id)?.text ?? '');
    },
    discard: (id: string) => {
      removed.current.add(id);
      const next = new Map(drafts.current);
      next.delete(id);
      publish(next);
      storeText(id, '');
    },
    setPrivate: (id: string, enabled: boolean) => {
      if (enabled) {
        const current = read(drafts.current, id);
        privateSessions.current.add(id);
        publish(new Map(drafts.current).set(id, current));
        storeText(id, '');
      } else {
        privateSessions.current.delete(id);
        storeText(id, read(drafts.current, id).text);
      }
    },
  };
}
