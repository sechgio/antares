import { useEffect, useState } from 'react';
import { AppWindow, ArrowUpRight } from 'lucide-react';
import { agentApi, type AgentPageArtifact } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import Button from '../ui/Button';

type Preview = { kind: 'loading' } | { kind: 'ready'; html: string } | { kind: 'unavailable' };

export default function PageArtifactCard({ artifact, sessionId }: { artifact: AgentPageArtifact; sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const { addToast } = useToast();
  const file = artifact.files[0];
  useEffect(() => {
    const observer = new MutationObserver(() => setColorScheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setPreview({ kind: 'loading' });
    void agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifact.id,
      file_index: 0, action: 'preview', sha256: file.sha256, color_scheme: colorScheme }).then((result) => {
      if (active) setPreview(result.html ? { kind: 'ready', html: result.html } : { kind: 'unavailable' });
    }, () => { if (active) setPreview({ kind: 'unavailable' }); });
    return () => { active = false; };
  }, [sessionId, artifact.id, file.sha256, colorScheme]);
  const open = async () => {
    setBusy(true);
    try {
      await agentApi.agentArtifactAction({ session_id: sessionId, artifact_id: artifact.id,
        file_index: 0, action: 'open', sha256: file.sha256, color_scheme: colorScheme });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo abrir la página'), type: 'error' });
    } finally { setBusy(false); }
  };
  return (
    <section aria-label={`Página ${artifact.title}`} className="agent-page-card">
      <div className="agent-page-card__preview" aria-hidden="true">
        {preview.kind === 'ready'
          ? <iframe title={`Miniatura de ${artifact.title}`} srcDoc={preview.html} sandbox="" tabIndex={-1} inert />
          : <div className="agent-page-card__placeholder">
            <span>{artifact.title}</span>
            <div className="agent-page-card__skeleton"><i /><i /><i /><i /><i /><i /></div>
          </div>}
      </div>
      <div className="agent-page-card__footer">
        <span className="agent-page-card__icon" aria-hidden="true"><AppWindow size={19} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]">{artifact.title}</span>
          <span className="block text-[12px] leading-5 text-[var(--text-secondary)]">{busy ? 'Abriendo…' : 'Página interactiva'}</span>
        </span>
        <ArrowUpRight className="agent-page-card__arrow" size={17} aria-hidden="true" />
      </div>
      <Button variant="none" size="none" className="agent-page-card__button" disabled={busy} aria-busy={busy}
        aria-label={`Abrir página ${artifact.title}`} onClick={() => void open()} />
    </section>
  );
}
