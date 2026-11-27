import { useId } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { AgentArtifact } from '../../api/agentApi';
import Button from '../ui/Button';
import { DialogSurface } from '../ui/Dialog';

export default function ArtifactShelf({
  artifacts,
  onJump,
  onClose,
}: {
  artifacts: AgentArtifact[];
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const unique = new Map<string, AgentArtifact>();
  for (const artifact of artifacts) {
    if (artifact.files.length) unique.set(artifact.files.map((file) => file.sha256).join(','), artifact);
  }

  return (
    <DialogSurface portal labelledBy={titleId} onClose={onClose} className="max-w-lg p-4">
      <header className="mb-2 flex items-center justify-between">
        <h2 id={titleId} className="text-sm font-semibold">
          Entregables de la conversación
        </h2>
        <Button size="sm" variant="ghost" aria-label="Cerrar entregables" onClick={onClose}>
          <X size={14} />
        </Button>
      </header>
      <ul className="max-h-[60vh] divide-y divide-[var(--border-subtle)] overflow-y-auto">
        {[...unique.values()].reverse().map((artifact) => (
          <li key={artifact.id}>
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-between text-left"
              onClick={() => onJump(artifact.id)}
            >
              <span className="truncate">
                {artifact.kind === 'page' ? artifact.title : artifact.files.map((file) => file.name).join(', ')}
              </span>
              <ArrowRight size={13} />
            </Button>
          </li>
        ))}
      </ul>
    </DialogSurface>
  );
}
