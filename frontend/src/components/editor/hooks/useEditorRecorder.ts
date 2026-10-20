import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';

type RecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'paused'
  | 'finishing'
  | 'done'
  | 'error';

const MAX_IN_FLIGHT_BYTES = 8 * 1024 * 1024;

interface RecordingResult {
  fileToken: string;
  writtenBytes: number;
}

interface UseEditorRecorderResult {
  state: RecorderState;
  elapsedMs: number;
  error: string | null;
  result: RecordingResult | null;
  start: (options?: { withMic?: boolean }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  discard: () => Promise<void>;
}

function detectSupportedMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function useEditorRecorder(): UseEditorRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      releaseStream();
    },
    [stopTimer, releaseStream],
  );

  const sendChunk = useCallback(async (sessionId: string, blob: Blob) => {
    while (inFlightRef.current > MAX_IN_FLIGHT_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const chunkB64 = toBase64(await blob.arrayBuffer());
    inFlightRef.current += chunkB64.length;
    try {
      await api.editorRecordingAppend(sessionId, seqRef.current++, chunkB64);
    } finally {
      inFlightRef.current -= chunkB64.length;
    }
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const sessionId = sessionRef.current;
    if (!recorder || !sessionId) return;
    setState('finishing');
    stopTimer();
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    releaseStream();
    try {
      const finished = await api.editorRecordingFinish(sessionId);
      setResult({ fileToken: finished.file_token, writtenBytes: finished.writtenBytes });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    } finally {
      recorderRef.current = null;
      sessionRef.current = null;
    }
  }, [releaseStream, stopTimer]);

  const start = useCallback(
    async (options?: { withMic?: boolean }) => {
      setError(null);
      setResult(null);
      setState('requesting');
      try {
        const constraints: DisplayMediaStreamOptions = {
          video: true,
          audio: false,
        };
        if (options?.withMic) {
          constraints.audio = true;
        }
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        if (options?.withMic) {
          try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            for (const track of mic.getAudioTracks()) {
              stream.addTrack(track);
            }
          } catch {
            // Sin micrófono la grabación sigue con video y audio del sistema.
          }
        }
        streamRef.current = stream;
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          void stop();
        });

        const sessionId = `rec-${Date.now()}`;
        sessionRef.current = sessionId;
        seqRef.current = 0;
        inFlightRef.current = 0;
        await api.editorRecordingCreate(sessionId, detectSupportedMime());

        const recorder = new MediaRecorder(stream, { mimeType: detectSupportedMime() });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            void sendChunk(sessionId, event.data);
          }
        };
        recorder.onerror = () => {
          setState('error');
          setError('la grabación falló');
        };
        recorder.start(2000);
        recorderRef.current = recorder;

        startedAtRef.current = Date.now();
        setElapsedMs(0);
        setState('recording');
        timerRef.current = setInterval(() => {
          setElapsedMs(Date.now() - startedAtRef.current);
        }, 250);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/permission|denied|NotAllowed/i.test(message)) {
          setError('Permiso de captura denegado.');
        } else if (/notfound|device/i.test(message)) {
          setError('No se encontró un dispositivo de captura.');
        } else {
          setError(message);
        }
        setState('error');
        releaseStream();
      }
    },
    [releaseStream, sendChunk, stop],
  );

  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      stopTimer();
      setState('paused');
    }
  }, [stopTimer]);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
      setState('recording');
    }
  }, []);

  const discard = useCallback(async () => {
    const recorder = recorderRef.current;
    const sessionId = sessionRef.current;
    stopTimer();
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    releaseStream();
    if (sessionId) {
      try {
        await api.editorRecordingAbort(sessionId);
      } catch {
        // Abortar una sesión inexistente no debe romper el descarte.
      }
    }
    recorderRef.current = null;
    sessionRef.current = null;
    setElapsedMs(0);
    setState('idle');
  }, [releaseStream, stopTimer]);

  return { state, elapsedMs, error, result, start, pause, resume, stop, discard };
}
