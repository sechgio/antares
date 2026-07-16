import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Placement = 'right' | 'bottom' | 'top' | 'left';

const PLACEMENT_CLASS: Record<Placement, string> = {
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  bottom: 'left-1/2 top-full mt-1.5 -translate-x-1/2',
  top: 'left-1/2 bottom-full mb-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
};

const TOOLTIP_SURFACE =
  'pointer-events-none z-[11000] flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] shadow-sm';

export function HoverTooltip({
  label,
  groupHoverClass,
  placement = 'right',
}: {
  label: ReactNode;
  groupHoverClass: string;
  placement?: Placement;
}) {
  return (
    <div
      role="tooltip"
      className={cn(
        'absolute opacity-0',
        TOOLTIP_SURFACE,
        'transition-opacity duration-100 ease-[var(--ease-out)]',
        PLACEMENT_CLASS[placement],
        groupHoverClass,
        'motion-reduce:transition-none',
      )}
    >
      <span>{label}</span>
    </div>
  );
}

function hasTooltipLabel(label: ReactNode): boolean {
  if (label == null || label === false) return false;
  if (typeof label === 'string') return label.trim().length > 0;
  return true;
}

function coordsForPlacement(rect: DOMRect, placement: Placement): CSSProperties {
  const gap = 6;
  switch (placement) {
    case 'top':
      return {
        top: rect.top - gap,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
      };
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - gap,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + gap,
        transform: 'translateY(-50%)',
      };
    case 'bottom':
    default:
      return {
        top: rect.bottom + gap,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      };
  }
}

export function WithHoverTooltip({
  label,
  placement = 'bottom',
  className,
  style,
  children,
}: {
  label: ReactNode;
  placement?: Placement;
  className?: string;
  style?: CSSProperties;
  children: ReactElement;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<CSSProperties | null>(null);

  const child = Children.only(children);
  const cleaned = isValidElement(child)
    ? cloneElement(child as ReactElement<{ title?: string }>, { title: undefined })
    : child;

  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setCoords(coordsForPlacement(el.getBoundingClientRect(), placement));
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const onLayout = () => updateCoords();
    window.addEventListener('scroll', onLayout, true);
    window.addEventListener('resize', onLayout);
    return () => {
      window.removeEventListener('scroll', onLayout, true);
      window.removeEventListener('resize', onLayout);
    };
  }, [open, updateCoords]);

  const show = () => {
    if (!hasTooltipLabel(label)) return;
    updateCoords();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {cleaned}
      {open &&
        coords &&
        createPortal(
          <div role="tooltip" className={cn('fixed', TOOLTIP_SURFACE)} style={coords}>
            <span>{label}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
