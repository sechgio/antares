import {
  PRESETS,
  atom,
  sameStation,
  storage,
  uniqueStations,
  validStation,
  type Atom,
  type MeterMode,
  type PlayerStatus,
  type Station,
} from './core';

export interface RadioPlayer {
  station: Atom<Station>;
  favorites: Atom<Station[]>;
  volume: Atom<number>;
  status: Atom<PlayerStatus>;
  meterMode: Atom<MeterMode>;
  play: (next?: Station, analyse?: boolean) => Promise<void>;
  stop: (nextStatus?: PlayerStatus) => void;
  toggle: () => void;
  next: () => void;
  setVolume: (value: number) => void;
  mute: () => void;
  favorite: (item: Station) => void;
  waveform: (columns: number) => number[];
  dispose: () => void;
}

export function createPlayer(): RadioPlayer {
  const saved = storage.get<Station[]>('favorites', []);
  const favorites = atom<Station[]>(
    uniqueStations(Array.isArray(saved) ? saved.filter(validStation) : []),
  );
  const previous = storage.get<Station | null>('station', null);
  const station = atom<Station>(validStation(previous) ? previous : PRESETS[0]);
  const storedVolume = storage.get<number>('volume', 25);
  const volume = atom<number>(
    Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 25,
  );
  const status = atom<PlayerStatus>('paused');
  const meterMode = atom<MeterMode>('levels');
  const plainStreams = new Set<string>();
  let audio: HTMLAudioElement | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let output: GainNode | null = null;
  const waveformData = new Float32Array(2048);
  let generation = 0;
  let timeout: number | undefined;
  let disposed = false;
  let lastVolume = volume.get() || 25;
  const bus = new BroadcastChannel('antares:radio:playback');
  const windowId = crypto.randomUUID();

  function stop(nextStatus: PlayerStatus = 'paused') {
    generation++;
    window.clearTimeout(timeout);
    source?.disconnect();
    analyser?.disconnect();
    output?.disconnect();
    output = null;
    source = null;
    analyser = null;
    if (audioContext?.state === 'running') void audioContext.suspend();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
      audio = null;
    }
    status.set(nextStatus);
  }

  async function play(next: Station = station.get(), analyse = true) {
    if (disposed || !validStation(next)) return;
    stop();
    const token = generation;
    station.set(next);
    storage.set('station', next);
    status.set('connecting');
    bus.postMessage({ type: 'play', sender: windowId });
    const element = new Audio();
    audio = element;
    element.dataset.antaresRadioAudio = 'true';
    element.hidden = true;
    element.preload = 'none';
    const metered = analyse && !plainStreams.has(next.url);
    meterMode.set(metered ? 'levels' : 'activity');
    if (metered) element.crossOrigin = 'anonymous';
    element.volume = metered ? 1 : volume.get() / 100;
    document.body.append(element);
    const current = () => !disposed && token === generation;
    const fail = () => {
      if (!current()) return;
      if (metered) {
        plainStreams.add(next.url);
        void play(next, false);
      } else {
        stop('error');
      }
    };
    element.addEventListener('playing', () => {
      if (current()) {
        window.clearTimeout(timeout);
        status.set('live');
      }
    });
    element.addEventListener('pause', () => {
      if (current() && element.paused && !element.ended) stop();
    });
    element.addEventListener('waiting', () => {
      if (current()) {
        status.set('connecting');
        window.clearTimeout(timeout);
        timeout = window.setTimeout(fail, 15000);
      }
    });
    element.addEventListener('error', fail);
    element.addEventListener('ended', fail);
    timeout = window.setTimeout(fail, 15000);
    element.src = next.url;
    try {
      if (metered) {
        audioContext ??= new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = waveformData.length;
        source = audioContext.createMediaElementSource(element);
        output = audioContext.createGain();
        output.gain.value = volume.get() / 100;
        source.connect(analyser);
        analyser.connect(output);
        output.connect(audioContext.destination);
        await audioContext.resume();
        if (!current()) return;
      }
      await element.play();
    } catch {
      fail();
    }
  }

  function toggle() {
    if (status.get() === 'live' || status.get() === 'connecting') stop();
    else void play();
  }

  function next() {
    const queue = uniqueStations([...favorites.get(), ...PRESETS, station.get()]);
    const index = queue.findIndex((item) => sameStation(item, station.get()));
    const target = queue[(index + 1) % queue.length];
    if (target) void play(target);
  }

  function setVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(100, value));
    volume.set(nextVolume);
    if (output) output.gain.value = nextVolume / 100;
    else if (audio) audio.volume = nextVolume / 100;
    storage.set('volume', nextVolume);
  }

  function mute() {
    if (volume.get()) {
      lastVolume = volume.get();
      setVolume(0);
    } else {
      setVolume(lastVolume);
    }
  }

  function favorite(item: Station) {
    const current = favorites.get();
    const nextFavorites = current.some((value) => sameStation(value, item))
      ? current.filter((value) => !sameStation(value, item))
      : [...current, item];
    favorites.set(nextFavorites);
    storage.set('favorites', nextFavorites);
  }

  bus.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; sender?: string } | undefined;
    if (data?.type === 'play' && data.sender !== windowId) stop('elsewhere');
  };

  function waveform(columns: number): number[] {
    if (!analyser || !audioContext || status.get() !== 'live') {
      return new Array(columns).fill(0);
    }
    analyser.getFloatTimeDomainData(waveformData);
    const span = Math.floor(audioContext.sampleRate * 0.004);
    let start = 0;
    for (let i = 1; i < waveformData.length - span; i++) {
      if (waveformData[i - 1] < 0 && waveformData[i] >= 0) {
        start = i;
        break;
      }
    }
    return Array.from({ length: columns }, (_, x) => {
      const from = start + Math.floor((x * span) / columns);
      const to = start + Math.floor(((x + 1) * span) / columns);
      let sum = 0;
      for (let i = from; i < to; i++) sum += waveformData[i];
      return Math.max(-1, Math.min(1, (sum / Math.max(1, to - from)) * 2));
    });
  }

  function dispose() {
    disposed = true;
    stop();
    bus.close();
    if (audioContext) void audioContext.close();
  }

  return {
    station,
    favorites,
    volume,
    status,
    meterMode,
    play,
    stop,
    toggle,
    next,
    setVolume,
    mute,
    favorite,
    waveform,
    dispose,
  };
}
