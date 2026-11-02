import { atom, type Atom } from '../radio/core';

/** Volume of a widget player, both as atom and as "last audible" memory for mute. */
export interface WidgetVolumeState {
  volume: Atom<number>;
  lastVolumeRef: { current: number };
}

/**
 * Restores the persisted 0-100 volume of a widget player and the last audible
 * level used to unmute. `store` must persist the `volume` key of the widget.
 */
export function storedVolumeState(store: {
  get<T>(key: string, fallback: T): T;
}): WidgetVolumeState {
  const storedVolume = store.get<number>('volume', 25);
  const volume = atom<number>(
    Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 25,
  );
  return { volume, lastVolumeRef: { current: volume.get() || 25 } };
}

/** Alternates between the current volume and the last audible level. */
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

/**
 * Creates the hidden streaming element, tuned to the given 0-1 volume, and
 * attaches it to the body. Radio and streaming players only diverge afterwards
 * (metering hooks, media listeners and stream source).
 */
export function appendStreamAudio(volumeRatio: number): HTMLAudioElement {
  const element = new Audio();
  element.hidden = true;
  element.preload = 'none';
  element.volume = volumeRatio;
  document.body.append(element);
  return element;
}

/** Fully releases a streaming element: pause, unload and DOM removal. */
export function releaseAudioElement(audio: HTMLAudioElement | null): null {
  if (!audio) return null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.remove();
  return null;
}
