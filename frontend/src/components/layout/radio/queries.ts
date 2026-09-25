import { useEffect, useState } from 'react';
import { fetchJson, searchStations, type Station } from './core';
import { resolveArtist, type IcecastStatus } from './artist';

export function useIcecastMetadata(
  endpoint: string | undefined,
  active: boolean,
): IcecastStatus | null {
  const [data, setData] = useState<IcecastStatus | null>(null);
  useEffect(() => {
    if (!active || !endpoint) return;
    const ctrl = new AbortController();
    let stopped = false;
    const load = async (attempt: number) => {
      try {
        const json = (await fetchJson(endpoint, ctrl.signal)) as IcecastStatus;
        if (!stopped) setData(json);
      } catch {
        if (ctrl.signal.aborted || stopped) return;
        if (attempt < 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          if (!stopped) void load(attempt + 1);
        }
      }
    };
    void load(0);
    const id = window.setInterval(() => void load(0), 25000);
    return () => {
      stopped = true;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [endpoint, active]);
  return data;
}

const artistCache = new Map<string, string | null>();

export function useArtistUrl(artist: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    artist ? (artistCache.get(artist) ?? null) : null,
  );
  useEffect(() => {
    if (!enabled || !artist) return;
    if (artistCache.has(artist)) {
      setUrl(artistCache.get(artist) ?? null);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    const run = async (attempt: number) => {
      try {
        const href = await resolveArtist(artist, ctrl.signal);
        if (!cancelled) {
          artistCache.set(artist, href);
          setUrl(href);
        }
      } catch {
        if (ctrl.signal.aborted || cancelled) return;
        if (attempt < 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          if (!cancelled) void run(attempt + 1);
        }
      }
    };
    void run(0);
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [artist, enabled]);
  return artist ? url : null;
}

const searchCache = new Map<string, { at: number; data: Station[] }>();

export function useStationSearch(query: string, enabled: boolean) {
  const [state, setState] = useState<{ data: Station[]; isFetching: boolean; isError: boolean }>({
    data: [],
    isFetching: false,
    isError: false,
  });
  useEffect(() => {
    if (!enabled) {
      setState({ data: [], isFetching: false, isError: false });
      return;
    }
    const hit = searchCache.get(query);
    if (hit && Date.now() - hit.at < 300000) {
      setState({ data: hit.data, isFetching: false, isError: false });
      return;
    }
    const ctrl = new AbortController();
    setState({ data: hit?.data ?? [], isFetching: true, isError: false });
    searchStations(query, ctrl.signal)
      .then((data) => {
        searchCache.set(query, { at: Date.now(), data });
        setState({ data, isFetching: false, isError: false });
      })
      .catch(() => setState({ data: [], isFetching: false, isError: true }));
    return () => ctrl.abort();
  }, [query, enabled]);
  return state;
}
