import { atom, streamUrl, type Atom, type AudiusTrack } from './core';

export type AudiusStatus = 'paused' | 'connecting' | 'live' | 'error';

export interface AudiusPlayer {
  queue: Atom<AudiusTrack[]>;
  track: Atom<AudiusTrack | null>;
  status: Atom<AudiusStatus>;
  volume: Atom<number>;
  select: (track: AudiusTrack, queue?: AudiusTrack[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  setVolume: (value: number) => void;
  mute: () => void;
  dispose: () => void;
}

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(`antares.audius.${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(`antares.audius.${key}`, JSON.stringify(value));
    } catch {}
  },
};

export function createAudiusPlayer(): AudiusPlayer {
  const storedVolume = store.get<number>('volume', 25);
  const volume = atom<number>(
    Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 25,
  );
  const queue = atom<AudiusTrack[]>([]);
  const track = atom<AudiusTrack | null>(null);
  const status = atom<AudiusStatus>('paused');
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

  function load(item: AudiusTrack) {
    const element = ensureAudio();
    track.set(item);
    status.set('connecting');
    element.src = streamUrl(item);
    void element.play().catch(() => {
      if (!disposed) status.set('error');
    });
  }

  function select(item: AudiusTrack, list?: AudiusTrack[]) {
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
