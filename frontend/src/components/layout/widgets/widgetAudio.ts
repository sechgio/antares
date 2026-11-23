import { atom, type Atom } from '../radio/core';

export interface WidgetVolumeState {
  volume: Atom<number>;
  lastVolumeRef: { current: number };
}

export function storedVolumeState(store: {
  get<T>(key: string, fallback: T): T;
}): WidgetVolumeState {
  const storedVolume = store.get<number>('volume', 25);
  const volume = atom<number>(
    Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 25,
  );
  return { volume, lastVolumeRef: { current: volume.get() || 25 } };
}

export function toggleMute(
  volume: Atom<number>,
  setVolume: (value: number) => void,
  lastVolumeRef: { current: number },
) {
  if (volume.get()) {
    lastVolumeRef.current = volume.get();
    setVolume(0);
  } else {
    setVolume(lastVolumeRef.current);
  }
}

export function appendStreamAudio(volumeRatio: number): HTMLAudioElement {
  const element = new Audio();
  element.hidden = true;
  element.preload = 'none';
  element.volume = volumeRatio;
  document.body.append(element);
  return element;
}

export function releaseAudioElement(audio: HTMLAudioElement | null): null {
  if (!audio) return null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.remove();
  return null;
}
