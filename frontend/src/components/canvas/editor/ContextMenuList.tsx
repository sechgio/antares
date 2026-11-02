import { Fragment, type ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import Button from '@/components/ui/Button';

export interface ContextMenuChild<TArg extends string | number> {
  label: string;
  arg: TArg;
  disabled?: boolean;
}

export interface ContextMenuItem<TId extends string, TArg extends string | number> {
  id: TId;
  label: string;
  tip?: string;
  icon: ComponentType<{ className?: string; size?: string | number }>;
  danger?: boolean;
  disabled?: boolean;
  sepBefore?: boolean;
  children?: ContextMenuChild<TArg>[];
}

interface ContextMenuListProps<TId extends string, TArg extends string | number> {
  items: Array<ContextMenuItem<TId, TArg>>;
  onAction: (id: TId, arg?: TArg) => void;
  onClose: () => void;
}

/** Renderiza la lista de items de los menús contextuales del canvas (capa y página).
 *  El contenedor raíz `.canvas-context-menu` con su testid/posición pertenece a
 *  cada menú concreto; este componente solo pinta separators, submenús, tips y
 *  la acción de cada item.
 */
export default function ContextMenuList<TId extends string, TArg extends string | number>({
  items,
  onAction,
  onClose,
}: ContextMenuListProps<TId, TArg>) {
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.sepBefore ? <div className="canvas-context-sep" role="separator" /> : null}
          {item.children?.length ? (
            <div className="canvas-context-subwrap" data-testid={`canvas-context-sub-${item.id}`}>
              <Button variant="none" size="none"
                role="menuitem"
                aria-haspopup="menu"
                className="canvas-context-item"
                disabled={item.disabled}
                onClick={(e) => e.preventDefault()}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 text-left">{item.label}</span>
                <ChevronDown className="h-3 w-3 -rotate-90 opacity-70" aria-hidden />
              </Button>
              <div className="canvas-context-sub" role="menu">
                {item.children.map((child) => (
                  <Button variant="none" size="none"
                    key={`${item.id}:${String(child.arg)}`}
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
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Button variant="none" size="none"
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
            </Button>
          )}
        </Fragment>
      ))}
    </>
  );
}
