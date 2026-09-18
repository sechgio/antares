import { CloudDownload, HardDrive, Trash2 } from 'lucide-react';

import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

import type { SyncConflict } from '../sync/syncCompare';

import type { SyncConflictChoice } from '../hooks/useCanvasSync';
import Button from '@/components/ui/Button';

interface SyncConflictBarProps {

  conflict: SyncConflict;

  onResolve: (choice: SyncConflictChoice) => void;

}

export default function SyncConflictBar({ conflict, onResolve }: SyncConflictBarProps) {

  const docName =

    conflict.remoteDoc?.name || conflict.localDoc.name || 'documento';

  if (conflict.remoteDeleted) {

    return (

      <div

        className="canvas-sync-conflict-bar"

        data-testid="sync-conflict-bar"

        role="status"

        aria-live="polite"

        aria-label={`Borrado en la nube · ${docName}`}

      >

        <WithHoverTooltip label={`Mantener mi versión · ${docName}`} placement="bottom" variant="dark">

          <Button variant="none" size="none"


            data-testid="sync-conflict-keep-local"

            className="canvas-icon-btn"

            aria-label="Mantener mi versión"

            onClick={() => onResolve('keep-local')}

          >

            <HardDrive className="h-3.5 w-3.5" />

          </Button>

        </WithHoverTooltip>

        <WithHoverTooltip label={`Eliminar localmente · ${docName}`} placement="bottom" variant="dark">

          <Button variant="none" size="none"


            data-testid="sync-conflict-use-remote"

            className="canvas-icon-btn"

            aria-label="Eliminar localmente"

            onClick={() => onResolve('use-remote')}

          >

            <Trash2 className="h-3.5 w-3.5" />

          </Button>

        </WithHoverTooltip>

      </div>

    );

  }

  return (

    <div

      className="canvas-sync-conflict-bar"

      data-testid="sync-conflict-bar"

      role="status"

      aria-live="polite"

      aria-label={`Versión más nueva en la nube · ${docName}`}

    >

      <WithHoverTooltip label={`Mantener mi versión · ${docName}`} placement="bottom" variant="dark">

        <Button variant="none" size="none"


          data-testid="sync-conflict-keep-local"

          className="canvas-icon-btn"

          aria-label="Mantener mi versión"

          onClick={() => onResolve('keep-local')}

        >

          <HardDrive className="h-3.5 w-3.5" />

        </Button>

      </WithHoverTooltip>

      <WithHoverTooltip label={`Usar versión en la nube · ${docName}`} placement="bottom" variant="dark">

        <Button variant="none" size="none"


          data-testid="sync-conflict-use-remote"

          className="canvas-icon-btn"

          aria-label="Usar versión en la nube"

          onClick={() => onResolve('use-remote')}

        >

          <CloudDownload className="h-3.5 w-3.5" />

        </Button>

      </WithHoverTooltip>

    </div>

  );

}

