import { useEditorRecorder } from '../hooks/useEditorRecorder';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Listo para grabar',
  requesting: 'Solicitando permiso…',
  recording: 'Grabando',
  paused: 'En pausa',
  finishing: 'Finalizando…',
  done: 'Grabación lista',
  error: 'Error',
};

export function RecordPanel({
  onImported,
}: {
  onImported?: (fileToken: string) => void;
}) {
  const recorder = useEditorRecorder();
  const { state } = recorder;

  return (
    <div className="space-y-3 p-3" data-testid="record-panel">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-2 rounded-full ${
            state === 'recording' ? 'bg-red-500' : 'bg-[var(--text-muted)]'
          }`}
          aria-hidden
        />
        <span className="text-xs text-[var(--text-primary)]">{STATE_LABEL[state] ?? state}</span>
        <span className="ml-auto font-mono text-xs text-[var(--text-secondary)]" data-testid="record-elapsed">
          {formatElapsed(recorder.elapsedMs)}
        </span>
      </div>

      <div className="flex gap-2">
        {state === 'idle' || state === 'error' ? (
          <>
            <button
              type="button"
              className="rounded bg-[var(--accent-primary)] px-3 py-1 text-xs text-white"
              onClick={() => void recorder.start({ withMic: true })}
            >
              Grabar con micrófono
            </button>
            <button
              type="button"
              className="rounded border border-[var(--border-medium)] px-3 py-1 text-xs text-[var(--text-secondary)]"
              onClick={() => void recorder.start()}
            >
              Solo pantalla
            </button>
          </>
        ) : null}

        {state === 'recording' ? (
          <button
            type="button"
            className="rounded border border-[var(--border-medium)] px-3 py-1 text-xs text-[var(--text-secondary)]"
            onClick={recorder.pause}
          >
            Pausar
          </button>
        ) : null}

        {state === 'paused' ? (
          <button
            type="button"
            className="rounded border border-[var(--border-medium)] px-3 py-1 text-xs text-[var(--text-secondary)]"
            onClick={recorder.resume}
          >
            Continuar
          </button>
        ) : null}

        {state === 'recording' || state === 'paused' ? (
          <>
            <button
              type="button"
              className="rounded bg-[var(--accent-primary)] px-3 py-1 text-xs text-white"
              onClick={() => void recorder.stop()}
            >
              Detener
            </button>
            <button
              type="button"
              className="rounded border border-[var(--accent-red)] px-3 py-1 text-xs text-[var(--accent-red)]"
              onClick={() => void recorder.discard()}
            >
              Descartar
            </button>
          </>
        ) : null}
      </div>

      {recorder.error && (
        <p className="text-xs text-[var(--accent-red)]" role="alert">
          {recorder.error}
        </p>
      )}

      {state === 'done' && recorder.result && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Grabación de {(recorder.result.writtenBytes / 1024).toFixed(0)} KB lista para importar.
          </p>
          <button
            type="button"
            className="rounded bg-[var(--accent-primary)] px-3 py-1 text-xs text-white"
            onClick={() => onImported?.(recorder.result!.fileToken)}
          >
            Importar al proyecto
          </button>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        La captura se guarda en tu equipo por bloques con cuota; nada se sube a internet.
      </p>
    </div>
  );
}
