import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { channel, supabaseMock } = vi.hoisted(() => {
  const channel = {
    on: vi.fn(function (this: unknown, _type: string, _filter: unknown, _callback: unknown) {
      return this;
    }),
    subscribe: vi.fn(),
    send: vi.fn(),
    track: vi.fn(),
    presenceState: vi.fn(),
  };

  const supabaseMock = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };

  return { channel, supabaseMock };
});

vi.mock('../../../lib/supabase', () => ({ supabase: supabaseMock }));

import {
  broadcastCanvasDocumentSaved,
  canvasDocumentTopic,
  collaboratorsFromPresence,
  getCanvasPresenceIdentity,
  subscribeCanvasDocument,
} from './canvasRealtime';

const presence = { userId: 'user-1', displayName: 'Ana', mode: 'viewing' as const };
const savedEvent = {
  type: 'document_saved' as const,
  documentId: 'doc-1',
  updatedAt: '2026-08-31T12:00:00.000Z',
  updatedBy: 'user-2',
};

let activeSubscription: Awaited<ReturnType<typeof subscribeCanvasDocument>> = null;
let subscriptionStatus: ((status: string) => void) | undefined;
let authStateChangeHandler: ((event: string) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  channel.on.mockImplementation(function (this: unknown, _type: string, _filter: unknown, _callback: unknown) {
    return this;
  });
  channel.subscribe.mockImplementation((callback?: (status: string) => void) => {
    subscriptionStatus = callback;
    callback?.('SUBSCRIBED');
    return channel;
  });
  channel.send.mockResolvedValue('ok');
  channel.track.mockResolvedValue('ok');
  channel.presenceState.mockReturnValue({});
  authStateChangeHandler = undefined;
  supabaseMock.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} } } },
  });
  supabaseMock.auth.onAuthStateChange.mockImplementation((callback: (event: string) => void) => {
    authStateChangeHandler = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(async () => {
  await activeSubscription?.close();
  activeSubscription = null;
});

describe('canvas realtime transport', () => {
  it('builds a document topic', () => {
    expect(canvasDocumentTopic('doc-1')).toBe('canvas-document:doc-1');
  });

  it('opens a private channel and publishes accepted events', async () => {
    const onSaved = vi.fn();
    const onPresence = vi.fn();
    const onStatus = vi.fn();
    activeSubscription = subscribeCanvasDocument('doc-1', presence, { onSaved, onPresence, onStatus });

    expect(supabaseMock.channel).toHaveBeenCalledWith('canvas-document:doc-1', {
      config: {
        private: true,
        broadcast: { ack: true, self: false },
        presence: { enabled: true, key: 'user-1' },
      },
    });
    expect(onStatus).toHaveBeenCalledWith('live');
    expect(await broadcastCanvasDocumentSaved(savedEvent)).toBe(true);
    expect(channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'document_saved',
      payload: savedEvent,
    });
  });

  it('rejects malformed broadcast payloads before invoking the handler', () => {
    let broadcastHandler: ((payload: { payload?: unknown }) => void) | undefined;
    channel.on.mockImplementation(function (this: unknown, type: string, _filter: unknown, callback: unknown) {
      if (type === 'broadcast') broadcastHandler = callback as (payload: { payload?: unknown }) => void;
      return this;
    });
    const onSaved = vi.fn();
    activeSubscription = subscribeCanvasDocument('doc-1', presence, {
      onSaved,
      onPresence: vi.fn(),
      onStatus: vi.fn(),
    });

    broadcastHandler?.({ payload: { ...savedEvent, documentId: 'other-doc' } });
    broadcastHandler?.({ payload: { ...savedEvent, updatedAt: 'not-a-date' } });
    broadcastHandler?.({ payload: { ...savedEvent, document: { layers: [] } } });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('normalizes presence state with its presence keys', () => {
    expect(collaboratorsFromPresence({
      'user-2': [{ userId: 'user-2', displayName: 'Luis', mode: 'editing' }],
      'invalid': [{ userId: '', displayName: 'Nope', mode: 'editing' }],
    })).toEqual([{
      userId: 'user-2',
      displayName: 'Luis',
      mode: 'editing',
      presenceKey: 'user-2',
    }]);
  });

  it('tracks identity and only retracks when the mode changes', async () => {
    activeSubscription = subscribeCanvasDocument('doc-1', presence, {
      onSaved: vi.fn(),
      onPresence: vi.fn(),
      onStatus: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initialTrackCalls = channel.track.mock.calls.length;
    await activeSubscription.updatePresence({ ...presence });
    await activeSubscription.updatePresence({ ...presence, mode: 'editing' });

    expect(channel.track).toHaveBeenCalledTimes(initialTrackCalls + 1);
    expect(channel.track).toHaveBeenLastCalledWith({ ...presence, mode: 'editing' });
  });

  it('retracks presence after a channel rejoin', async () => {
    activeSubscription = subscribeCanvasDocument('doc-1', presence, {
      onSaved: vi.fn(),
      onPresence: vi.fn(),
      onStatus: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initialTrackCalls = channel.track.mock.calls.length;

    subscriptionStatus?.('SUBSCRIBED');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(channel.track).toHaveBeenCalledTimes(initialTrackCalls + 1);
    expect(channel.track).toHaveBeenLastCalledWith(presence);
  });

  it('derives a safe display name from the authenticated session', async () => {
    await expect(getCanvasPresenceIdentity()).resolves.toEqual({
      userId: 'user-1',
      displayName: 'ana',
      mode: 'viewing',
    });
  });

  it('closes the channel idempotently', async () => {
    activeSubscription = subscribeCanvasDocument('doc-1', presence, {
      onSaved: vi.fn(),
      onPresence: vi.fn(),
      onStatus: vi.fn(),
    });
    await activeSubscription.close();
    await activeSubscription.close();
    expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('closes the channel and clears Presence when the auth session ends', async () => {
    const onPresence = vi.fn();
    const onStatus = vi.fn();
    activeSubscription = subscribeCanvasDocument('doc-1', presence, {
      onSaved: vi.fn(),
      onPresence,
      onStatus,
    });

    authStateChangeHandler?.('SIGNED_OUT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onStatus).toHaveBeenCalledWith('offline');
    expect(onPresence).toHaveBeenCalledWith([]);
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channel);
  });
});
