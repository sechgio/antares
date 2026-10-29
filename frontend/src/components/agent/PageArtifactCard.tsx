import { useState } from 'react';
import { AppWindow, ExternalLink } from 'lucide-react';
import { agentApi, type AgentPageArtifact } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import Button from '../ui/Button';

export default function PageArtifactCard({ artifact, sessionId }: { artifact: AgentPageArtifact; sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();
  const file = artifact.files[0];
  const open = async () => {
    setBusy(true);
    try {
      await agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifact.id,
        file_index: 0, action: 'open', sha256: file.sha256 });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo abrir la página'), type: 'error' });
    } finally { setBusy(false); }
  };
  return (
    <section aria-label={`Página ${artifact.title}`} className="agent-artifact w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
        <span className="agent-artifact-icon flex size-10 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
          <AppWindow size={20} />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]" title={artifact.title}>{artifact.title}</p>
          <p className="text-[11.5px] leading-4 text-[var(--text-muted)]">Página interactiva · {Math.ceil(file.size / 1024)} KB</p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void open()}>
          <ExternalLink size={13} aria-hidden="true" />{busy ? 'Abriendo…' : 'Abrir página'}
        </Button>
      </div>
    </section>
  );
}
