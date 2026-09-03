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
type TooltipVariant = 'default' | 'dark';

const PLACEMENT_CLASS: Record<Placement, string> = {
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  bottom: 'left-1/2 top-full mt-1.5 -translate-x-1/2',
  top: 'left-1/2 bottom-full mb-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
};

const CARET_CLASS: Record<Placement, string> = {
  top: 'pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-[5px] border-transparent border-t-[#1e1e1e]',
  bottom:
    'pointer-events-none absolute left-1/2 bottom-full h-0 w-0 -translate-x-1/2 border-[5px] border-transparent border-b-[#1e1e1e]',
  left: 'pointer-events-none absolute left-full top-1/2 h-0 w-0 -translate-y-1/2 border-[5px] border-transparent border-l-[#1e1e1e]',
  right:
    'pointer-events-none absolute right-full top-1/2 h-0 w-0 -translate-y-1/2 border-[5px] border-transparent border-r-[#1e1e1e]',
};

const SURFACE: Record<TooltipVariant, string> = {
  default:
    'pointer-events-none z-[11000] flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] shadow-sm',
  dark:
    'pointer-events-none z-[11000] flex items-center gap-2 whitespace-nowrap rounded-[6px] bg-[#1e1e1e] px-2 py-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_2px_10px_rgba(0,0,0,0.28)]',
};

export function HoverTooltip({
  label,
  groupHoverClass,
  placement = 'right',
  shortcut,
  variant = 'default',
}: {
  label: ReactNode;
  groupHoverClass: string;
  placement?: Placement;
  shortcut?: string;
  variant?: TooltipVariant;
}) {
  return (
    <div
      role="tooltip"
      className={cn(
        'absolute opacity-0',
        SURFACE[variant],
        'transition-opacity duration-100 ease-[var(--ease-out)]',
        PLACEMENT_CLASS[placement],
        groupHoverClass,
        'group-focus-within:opacity-100',
        'motion-reduce:transition-none',
      )}
    >
      <span>{label}</span>
      {shortcut ? (
        <span className={cn(variant === 'dark' ? 'font-normal text-white/55' : 'opacity-60')}>{shortcut}</span>
      ) : null}
      {variant === 'dark' ? <span aria-hidden className={CARET_CLASS[placement]} /> : null}
    </div>
  );
}

function hasTooltipLabel(label: ReactNode): boolean {
  if (label == null || label === false) return false;
  if (typeof label === 'string') return label.trim().length > 0;
  return true;
}

function coordsForPlacement(rect: DOMRect, placement: Placement): CSSProperties {
  const gap = 8;
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
  shortcut,
  placement = 'bottom',
  variant = 'default',
  className,
  style,
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  placement?: Placement;
  variant?: TooltipVariant;
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
      onFocus={show}
      onBlur={hide}
    >
      {cleaned}
      {open &&
        coords &&
        createPortal(
          <div role="tooltip" className={cn('fixed', SURFACE[variant])} style={coords}>
            <span>{label}</span>
            {shortcut ? (
              <span className={cn(variant === 'dark' ? 'font-normal text-white/55' : 'opacity-60')}>
                {shortcut}
              </span>
            ) : null}
            {variant === 'dark' ? <span aria-hidden className={CARET_CLASS[placement]} /> : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
