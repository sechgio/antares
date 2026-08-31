import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

export type CanvasDocumentSavedEvent = {
  type: 'document_saved';
  documentId: string;
  updatedAt: string;
  updatedBy: string;
};

export type CanvasPresence = {
  userId: string;
  displayName: string;
  mode: 'viewing' | 'editing';
};

export type CanvasCollaborator = CanvasPresence & { presenceKey: string };

export type CanvasRealtimeStatus = 'idle' | 'connecting' | 'live' | 'error' | 'offline';

export type CanvasRealtimeHandlers = {
  onSaved: (event: CanvasDocumentSavedEvent) => void;
  onPresence: (collaborators: CanvasCollaborator[]) => void;
  onStatus: (status: CanvasRealtimeStatus) => void;
};

export type CanvasRealtimeSubscription = {
  updatePresence: (presence: CanvasPresence) => Promise<boolean>;
  close: () => Promise<void>;
};

type UnknownRecord = Record<string, unknown>;

const realtimeChannels = new Map<string, RealtimeChannel>();
const realtimeAuthSubscriptions = new Map<string, { unsubscribe: () => void }>();

export function canvasDocumentTopic(documentId: string): string {
  return `canvas-document:${documentId}`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key));
}

function isPresence(value: unknown): value is CanvasPresence {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ['userId', 'displayName', 'mode'])
    && isNonEmptyString(value.userId)
    && isNonEmptyString(value.displayName)
    && (value.mode === 'viewing' || value.mode === 'editing');
}

function isSavedEvent(value: unknown, documentId: string): value is CanvasDocumentSavedEvent {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ['type', 'documentId', 'updatedAt', 'updatedBy'])
    && value.type === 'document_saved'
    && value.documentId === documentId
    && isNonEmptyString(value.updatedAt)
    && !Number.isNaN(Date.parse(value.updatedAt))
    && isNonEmptyString(value.updatedBy);
}

export function collaboratorsFromPresence(state: unknown): CanvasCollaborator[] {
  if (!isRecord(state)) return [];

  return Object.entries(state).flatMap(([presenceKey, entries]) => {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => (
      isPresence(entry) ? [{ ...entry, presenceKey }] : []
    ));
  });
}

function presenceDisplayName(user: { email?: string; user_metadata?: UnknownRecord }): string {
  const metadata = user.user_metadata;
  const metadataName = metadata?.display_name ?? metadata?.displayName ?? metadata?.full_name;
  if (isNonEmptyString(metadataName)) return metadataName.trim().slice(0, 80);

  if (isNonEmptyString(user.email)) {
    const localPart = user.email.split('@')[0]?.trim();
    if (localPart) return localPart.slice(0, 80);
  }

  return 'Usuario';
}

export async function getCanvasPresenceIdentity(): Promise<CanvasPresence | null> {
  if (!supabase) return null;

  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user?.id) return null;

    return {
      userId: user.id,
      displayName: presenceDisplayName(user),
      mode: 'viewing',
    };
  } catch {
    return null;
  }
}

function statusFromSubscription(status: string): CanvasRealtimeStatus {
  if (status === 'SUBSCRIBED') return 'live';
  if (status === 'CLOSED') return 'offline';
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return 'error';
  return 'connecting';
}

export function subscribeCanvasDocument(
  documentId: string,
  presence: CanvasPresence,
  handlers: CanvasRealtimeHandlers,
): CanvasRealtimeSubscription | null {
  if (!documentId.trim()) {
    handlers.onStatus('error');
    return null;
  }

  if (!supabase) {
    handlers.onStatus('offline');
    return null;
  }
  const client = supabase;

  const topic = canvasDocumentTopic(documentId);
  const previous = realtimeChannels.get(topic);
  if (previous) {
    realtimeChannels.delete(topic);
    realtimeAuthSubscriptions.get(topic)?.unsubscribe();
    realtimeAuthSubscriptions.delete(topic);
    void client.removeChannel(previous);
  }

  const channel = client.channel(topic, {
    config: {
      private: true,
      broadcast: { ack: true, self: false },
      presence: { enabled: true, key: presence.userId },
    },
  });
  realtimeChannels.set(topic, channel);

  let closed = false;
  let currentPresence = presence;
  let trackedMode: CanvasPresence['mode'] | null = null;
  let authSubscription: { unsubscribe: () => void } | null = null;

  const subscription: CanvasRealtimeSubscription = {
    async updatePresence(nextPresence) {
      if (closed || !isPresence(nextPresence)) return false;
      if (trackedMode === nextPresence.mode) {
        currentPresence = nextPresence;
        return true;
      }

      currentPresence = nextPresence;
      try {
        const result = await channel.track(currentPresence);
        if (result === 'ok') {
          trackedMode = currentPresence.mode;
          return true;
        }
      } catch {
        // The channel status callback remains the source of connection state.
      }
      return false;
    },

    async close() {
      if (closed) return;
      closed = true;
      authSubscription?.unsubscribe();
      if (authSubscription && realtimeAuthSubscriptions.get(topic) === authSubscription) {
        realtimeAuthSubscriptions.delete(topic);
      }
      authSubscription = null;
      if (realtimeChannels.get(topic) === channel) realtimeChannels.delete(topic);
      await client.removeChannel(channel);
    },
  };

  handlers.onStatus('connecting');

  channel
    .on(
      'broadcast',
      { event: 'document_saved' },
      (payload: { payload?: unknown }) => {
        if (isSavedEvent(payload.payload, documentId)) handlers.onSaved(payload.payload);
      },
    )
    .on('presence', { event: 'sync' }, () => {
      handlers.onPresence(collaboratorsFromPresence(channel.presenceState()));
    });

  try {
    channel.subscribe((status) => {
      const mappedStatus = statusFromSubscription(status);
      handlers.onStatus(mappedStatus);
      if (mappedStatus !== 'live') return;

      // A rejoin starts a fresh server-side presence state.
      trackedMode = null;
      void subscription.updatePresence(currentPresence).then((tracked) => {
        if (!tracked && !closed) handlers.onStatus('error');
      });
    });
  } catch {
    handlers.onStatus('error');
  }

  try {
    const authResult = client.auth.onAuthStateChange((event) => {
      const authEvent = String(event);
      if (authEvent !== 'SIGNED_OUT' && authEvent !== 'USER_DELETED') return;
      handlers.onStatus('offline');
      handlers.onPresence([]);
      void subscription.close();
    });
    authSubscription = authResult.data.subscription;
    if (closed) {
      authSubscription.unsubscribe();
      authSubscription = null;
    } else {
      realtimeAuthSubscriptions.set(topic, authSubscription);
    }
  } catch {
    // Auth cleanup is best-effort; channel cleanup remains idempotent.
  }

  return subscription;
}

export async function broadcastCanvasDocumentSaved(
  event: CanvasDocumentSavedEvent,
): Promise<boolean> {
  if (!supabase || !isNonEmptyString(event.documentId)) return false;

  const channel = realtimeChannels.get(canvasDocumentTopic(event.documentId));
  if (!channel || !isSavedEvent(event, event.documentId)) return false;

  try {
    return (await channel.send({
      type: 'broadcast',
      event: 'document_saved',
      payload: event,
    })) === 'ok';
  } catch {
    return false;
  }
}
