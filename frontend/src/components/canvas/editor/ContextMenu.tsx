import { Fragment, type ComponentType } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Brush,
  ChevronUp,
  ChevronDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileOutput,
  Group,
  Layers,
  LayoutGrid,
  Lock,
  MousePointer2,
  Pipette,
  Pencil,
  SquareStack,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { Eye, EyeSlash } from './VisibilityIcon';
import { useContextMenuSurface } from '../hooks/useContextMenuSurface';

export type CanvasContextAction =
  | 'edit'
  | 'copy'
  | 'paste'
  | 'pasteInPlace'
  | 'copyProps'
  | 'pasteProps'
  | 'duplicate'
  | 'toggleLock'
  | 'toggleVisible'
  | 'bringFront'
  | 'bringForward'
  | 'sendBack'
  | 'sendBackward'
  | 'selectChildren'
  | 'selectParent'
  | 'selectUnderCursor'
  | 'selectSame'
  | 'eyedropper'
  | 'pasteToReplace'
  | 'moveToPage'
  | 'group'
  | 'ungroup'
  | 'matchGridSlotSize'
  | 'delete';

export interface CanvasContextMenuState {
  x: number;
  y: number;
  layerId: string | null;
  locked: boolean;
  visible: boolean;
  isContainer: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canPaste: boolean;
  editKind?: 'text' | 'field' | null;
  canMatchGridSlotSize?: boolean;
  hasParent?: boolean;
  canPasteProps?: boolean;
  underCursor?: Array<{ id: string; name: string }>;
  pageTargets?: Array<{ index: number; label: string }>;
  refIsText?: boolean;
}

interface ContextMenuProps {
  menu: CanvasContextMenuState;
  onAction: (action: CanvasContextAction, arg?: number | string) => void;
  onClose: () => void;
}

interface MenuChild {
  label: string;
  arg: number | string;
  disabled?: boolean;
}

interface MenuItem {
  id: CanvasContextAction;
  label: string;
  tip?: string;
  icon: ComponentType<{ className?: string; size?: string | number }>;
  danger?: boolean;
  disabled?: boolean;
  sepBefore?: boolean;
  children?: MenuChild[];
}

export default function ContextMenu({ menu, onAction, onClose }: ContextMenuProps) {
  const ref = useContextMenuSurface(menu.x, menu.y, onClose);

  const hasLayer = Boolean(menu.layerId);
  const items: MenuItem[] = [];
  if (menu.editKind === 'text') {
    items.push({ id: 'edit', label: 'Editar texto', tip: 'Enter', icon: Pencil, disabled: menu.locked });
  } else if (menu.editKind === 'field') {
    items.push({ id: 'edit', label: 'Editar campo', tip: 'Doble clic', icon: Pencil, disabled: menu.locked });
  }
  if (menu.hasParent) {
    items.push({
      id: 'selectParent',
      label: 'Seleccionar contenedor',
      tip: 'Esc',
      icon: Layers,
      disabled: !hasLayer,
    });
  }
  if (menu.underCursor && menu.underCursor.length > 1) {
    items.push({
      id: 'selectUnderCursor',
      label: 'Seleccionar bajo el cursor',
      icon: MousePointer2,
      children: menu.underCursor.map((l) => ({ label: l.name, arg: l.id })),
    });
  }
  items.push(
    {
      id: 'copy',
      label: 'Copiar',
      tip: 'Ctrl+C',
      icon: Copy,
      disabled: !hasLayer,
      sepBefore: Boolean(menu.editKind || menu.hasParent || menu.underCursor?.length),
    },
    { id: 'paste', label: 'Pegar', tip: 'Ctrl+V', icon: ClipboardPaste, disabled: !menu.canPaste },
    {
      id: 'pasteInPlace',
      label: 'Pegar en el sitio',
      tip: 'Ctrl+Shift+V',
      icon: ClipboardPaste,
      disabled: !menu.canPaste,
    },
    {
      id: 'pasteToReplace',
      label: 'Pegar para reemplazar',
      tip: 'Ctrl+Shift+R',
      icon: ClipboardPaste,
      disabled: !hasLayer || menu.locked || !menu.canPaste,
    },
    { id: 'duplicate', label: 'Duplicar', tip: 'Ctrl+D', icon: Copy, disabled: !hasLayer || menu.locked },
    {
      id: 'copyProps',
      label: 'Copiar propiedades',
      tip: 'Ctrl+Alt+C',
      icon: Brush,
      disabled: !hasLayer,
      sepBefore: true,
    },
    {
      id: 'pasteProps',
      label: 'Pegar propiedades',
      tip: 'Ctrl+Alt+V',
      icon: CopyPlus,
      disabled: !hasLayer || menu.locked || !menu.canPasteProps,
    },
    {
      id: 'eyedropper',
      label: 'Cuentagotas de color',
      tip: 'Alt+C',
      icon: Pipette,
      disabled: !hasLayer,
    },
    {
      id: 'selectSame',
      label: 'Seleccionar similar',
      icon: SquareStack,
      disabled: !hasLayer,
      children: [
        { label: 'Mismo relleno', arg: 'fill' },
        { label: 'Mismo borde', arg: 'stroke' },
        { label: 'Misma fuente', arg: 'font', disabled: !menu.refIsText },
      ],
    },
    {
      id: 'toggleLock',
      label: menu.locked ? 'Desbloquear' : 'Bloquear',
      icon: menu.locked ? Unlock : Lock,
      disabled: !hasLayer,
      sepBefore: true,
    },
    {
      id: 'toggleVisible',
      label: menu.visible ? 'Ocultar' : 'Mostrar',
      icon: menu.visible ? EyeSlash : Eye,
      disabled: !hasLayer,
    },
    {
      id: 'selectChildren',
      label: 'Seleccionar hijos',
      tip: 'Enter',
      icon: Layers,
      disabled: !hasLayer || !menu.isContainer,
    },
    {
      id: 'group',
      label: 'Agrupar',
      tip: 'Ctrl+G',
      icon: Group,
      disabled: !menu.canGroup || menu.locked,
      sepBefore: true,
    },
    {
      id: 'ungroup',
      label: 'Desagrupar',
      tip: 'Ctrl+Shift+G',
      icon: Ungroup,
      disabled: !menu.canUngroup || menu.locked,
    },
    ...(menu.canMatchGridSlotSize
      ? [
          {
            id: 'matchGridSlotSize' as const,
            label: 'Mismo tamaño para todos',
            icon: LayoutGrid,
            disabled: menu.locked,
            sepBefore: true,
          },
        ]
      : []),
    ...(menu.pageTargets?.length
      ? [
          {
            id: 'moveToPage' as const,
            label: 'Mover a página',
            icon: FileOutput,
            disabled: !hasLayer || menu.locked,
            sepBefore: true,
            children: menu.pageTargets.map((p) => ({ label: p.label, arg: p.index })),
          },
        ]
      : []),
    {
      id: 'bringFront',
      label: 'Traer al frente',
      tip: ']',
      icon: ArrowUpToLine,
      disabled: !hasLayer || menu.locked,
      sepBefore: true,
    },
    {
      id: 'bringForward',
      label: 'Adelante',
      tip: 'Ctrl+]',
      icon: ChevronUp,
      disabled: !hasLayer || menu.locked,
    },
    {
      id: 'sendBackward',
      label: 'Atrás',
      tip: 'Ctrl+[',
      icon: ChevronDown,
      disabled: !hasLayer || menu.locked,
    },
    { id: 'sendBack', label: 'Enviar al fondo', tip: '[', icon: ArrowDownToLine, disabled: !hasLayer || menu.locked },
    {
      id: 'delete',
      label: 'Eliminar',
      tip: 'Supr',
      icon: Trash2,
      danger: true,
      disabled: !hasLayer || menu.locked,
      sepBefore: true,
    },
  );

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      data-testid="canvas-context-menu"
    >
      {!hasLayer && (
        <div className="canvas-context-hint">Clic derecho sobre una capa para editarla</div>
      )}
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.sepBefore ? <div className="canvas-context-sep" role="separator" /> : null}
          {item.children?.length ? (
            <div className="canvas-context-subwrap" data-testid={`canvas-context-sub-${item.id}`}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                className="canvas-context-item"
                disabled={item.disabled}
                onClick={(e) => e.preventDefault()}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 text-left">{item.label}</span>
                <ChevronDown className="h-3 w-3 -rotate-90 opacity-70" aria-hidden />
              </button>
              <div className="canvas-context-sub" role="menu">
                {item.children.map((child) => (
                  <button
                    key={`${item.id}:${String(child.arg)}`}
                    type="button"
                    role="menuitem"
                    className="canvas-context-item"
                    disabled={child.disabled}
                    onClick={() => {
                      if (child.disabled) return;
                      onAction(item.id, child.arg);
                      onClose();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{child.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="canvas-context-item"
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.id);
                onClose();
              }}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 text-left">{item.label}</span>
              {item.tip && <kbd className="canvas-kbd">{item.tip}</kbd>}
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
