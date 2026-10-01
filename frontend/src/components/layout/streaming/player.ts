import { atom } from '../radio/core';
import type { Atom } from '../radio/core';
import type { StreamTrack } from './core';

export type StreamStatus = 'paused' | 'connecting' | 'live' | 'error';

export interface StreamPlayer<T extends { id: string } = StreamTrack> {
  queue: Atom<T[]>;
  track: Atom<T | null>;
  status: Atom<StreamStatus>;
  volume: Atom<number>;
  select: (track: T, queue?: T[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  setVolume: (value: number) => void;
  mute: () => void;
  dispose: () => void;
}

export function createStreamPlayer(sourceId: string): StreamPlayer;
export function createStreamPlayer<T extends { id: string }>(
  sourceId: string, resolveStream: (track: T) => string,
): StreamPlayer<T>;
export function createStreamPlayer<T extends { id: string; stream?: string } = StreamTrack>(
  sourceId: string, resolveStream: (track: T) => string = (item) => item.stream!,
): StreamPlayer<T> {
  const store = {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = window.localStorage.getItem(`antares.${sourceId}.${key}`);
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown) {
      try {
        window.localStorage.setItem(`antares.${sourceId}.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const storedVolume = store.get<number>('volume', 25);
  const volume = atom<number>(
    Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 25,
  );
  const queue = atom<T[]>([]);
  const track = atom<T | null>(null);
  const status = atom<StreamStatus>('paused');
  let audio: HTMLAudioElement | null = null;
  let disposed = false;
  let lastVolume = volume.get() || 25;

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio;
    const element = new Audio();
    element.hidden = true;
    element.preload = 'none';
    element.volume = volume.get() / 100;
    element.addEventListener('playing', () => {
      if (!disposed) status.set('live');
    });
    element.addEventListener('pause', () => {
      if (!disposed && element.paused && !element.ended) status.set('paused');
    });
    element.addEventListener('ended', () => {
      if (!disposed) next();
    });
    element.addEventListener('error', () => {
      if (!disposed) status.set('error');
    });
    document.body.append(element);
    audio = element;
    return element;
  }

  function load(item: T) {
    const element = ensureAudio();
    track.set(item);
    status.set('connecting');
    element.src = resolveStream(item);
    void element.play().catch(() => {
      if (!disposed) status.set('error');
    });
  }

  function select(item: T, list?: T[]) {
    if (disposed) return;
    if (list) queue.set(list);
    load(item);
  }

  function toggle() {
    if (disposed) return;
    const current = track.get();
    if (!current) {
      const first = queue.get()[0];
      if (first) load(first);
      return;
    }
    if (!audio) return;
    if (status.get() === 'live' || status.get() === 'connecting') {
      audio.pause();
      status.set('paused');
    } else {
      status.set('connecting');
      void audio.play().catch(() => {
        if (!disposed) status.set('error');
      });
    }
  }

  function step(delta: number) {
    const list = queue.get();
    if (!list.length) return;
    const current = track.get();
    const index = current ? list.findIndex((item) => item.id === current.id) : -1;
    const target = list[(index + delta + list.length) % list.length];
    if (target) load(target);
  }

  function next() {
    step(1);
  }

  function previous() {
    step(-1);
  }

  function setVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(100, value));
    volume.set(nextVolume);
    if (audio) audio.volume = nextVolume / 100;
    store.set('volume', nextVolume);
  }

  function mute() {
    if (volume.get()) {
      lastVolume = volume.get();
      setVolume(0);
    } else {
      setVolume(lastVolume);
    }
  }

  function dispose() {
    disposed = true;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
      audio = null;
    }
  }

  return {
    queue,
    track,
    status,
    volume,
    select,
    toggle,
    next,
    previous,
    setVolume,
    mute,
    dispose,
  };
}
