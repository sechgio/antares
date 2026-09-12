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
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Placement = 'right' | 'bottom' | 'top' | 'left';
type TooltipVariant = 'default' | 'dark';

type TooltipBox = { width: number; height: number };
type ViewportBox = { width: number; height: number };
type TooltipPosition = {
  top: number;
  left: number;
  caretOffset: number;
  placement: Placement;
};

const GAP = 8;
const MARGIN = 8;
const CARET_INSET = 10;

const CARET_CLASS: Record<Placement, string> = {
  top: 'pointer-events-none absolute top-full h-0 w-0 border-[5px] border-transparent border-t-[#1e1e1e]',
  bottom:
    'pointer-events-none absolute bottom-full h-0 w-0 border-[5px] border-transparent border-b-[#1e1e1e]',
  left: 'pointer-events-none absolute left-full h-0 w-0 border-[5px] border-transparent border-l-[#1e1e1e]',
  right:
    'pointer-events-none absolute right-full h-0 w-0 border-[5px] border-transparent border-r-[#1e1e1e]',
};

const TOOLTIP_SURFACE =
  'pointer-events-none z-[11000] flex w-max max-w-[calc(100vw-16px)] items-center gap-2 rounded-[6px] bg-[#1e1e1e] px-2 py-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_2px_10px_rgba(0,0,0,0.28)]';

const SURFACE: Record<TooltipVariant, string> = {
  default: TOOLTIP_SURFACE,
  dark: TOOLTIP_SURFACE,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeTooltipPosition(
  trigger: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>,
  tip: TooltipBox,
  placement: Placement,
  viewport: ViewportBox,
): TooltipPosition {
  const tw = Math.max(0, tip.width);
  const th = Math.max(0, tip.height);
  const vw = viewport.width;
  const vh = viewport.height;

  const fitsBottom = trigger.bottom + GAP + th <= vh - MARGIN;
  const fitsTop = trigger.top - GAP - th >= MARGIN;
  const fitsRight = trigger.right + GAP + tw <= vw - MARGIN;
  const fitsLeft = trigger.left - GAP - tw >= MARGIN;

  let resolved = placement;
  if (placement === 'bottom' && !fitsBottom && fitsTop) resolved = 'top';
  else if (placement === 'top' && !fitsTop && fitsBottom) resolved = 'bottom';
  else if (placement === 'right' && !fitsRight && fitsLeft) resolved = 'left';
  else if (placement === 'left' && !fitsLeft && fitsRight) resolved = 'right';

  let top = 0;
  let left = 0;
  switch (resolved) {
    case 'top':
      top = trigger.top - GAP - th;
      left = trigger.left + trigger.width / 2 - tw / 2;
      break;
    case 'bottom':
      top = trigger.bottom + GAP;
      left = trigger.left + trigger.width / 2 - tw / 2;
      break;
    case 'left':
      top = trigger.top + trigger.height / 2 - th / 2;
      left = trigger.left - GAP - tw;
      break;
    case 'right':
      top = trigger.top + trigger.height / 2 - th / 2;
      left = trigger.right + GAP;
      break;
  }

  const maxLeft = Math.max(MARGIN, vw - tw - MARGIN);
  const maxTop = Math.max(MARGIN, vh - th - MARGIN);
  left = clamp(left, MARGIN, maxLeft);
  top = clamp(top, MARGIN, maxTop);

  const alongStart = resolved === 'top' || resolved === 'bottom';
  const triggerCenter = alongStart
    ? trigger.left + trigger.width / 2
    : trigger.top + trigger.height / 2;
  const origin = alongStart ? left : top;
  const size = alongStart ? tw : th;
  const caretMax = Math.max(CARET_INSET, size - CARET_INSET);
  const caretOffset = size <= CARET_INSET * 2 ? size / 2 : clamp(triggerCenter - origin, CARET_INSET, caretMax);

  return { top, left, caretOffset, placement: resolved };
}

function hasTooltipLabel(label: ReactNode): boolean {
  if (label == null || label === false) return false;
  if (typeof label === 'string') return label.trim().length > 0;
  return true;
}

function useTooltipPosition(
  active: boolean,
  placement: Placement,
  getTrigger: () => HTMLElement | null,
  tipRef: RefObject<HTMLDivElement | null>,
) {
  const [pos, setPos] = useState<TooltipPosition | null>(null);

  const update = useCallback(() => {
    const trigger = getTrigger();
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const next = computeTooltipPosition(
      trigger.getBoundingClientRect(),
      { width: tip.offsetWidth, height: tip.offsetHeight },
      placement,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.placement === next.placement &&
      prev.caretOffset === next.caretOffset
        ? prev
        : next,
    );
  }, [getTrigger, placement, tipRef]);

  useLayoutEffect(() => {
    if (!active) return;
    update();
    const tip = tipRef.current;
    const observer = tip && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (tip && observer) observer.observe(tip);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [active, update]);

  return {
    coords: pos ? { top: pos.top, left: pos.left } : null,
    resolvedPlacement: pos?.placement ?? placement,
    caretOffset: pos?.caretOffset ?? 0,
  };
}

function TooltipBubble({
  label,
  shortcut,
  variant = 'dark',
  placement,
  caretOffset,
  coords,
  visible,
  tipRef,
}: {
  label: ReactNode;
  shortcut?: string;
  variant?: TooltipVariant;
  placement: Placement;
  caretOffset: number;
  coords: CSSProperties | null;
  visible: boolean;
  tipRef: RefObject<HTMLDivElement | null>;
}) {
  const caretStyle: CSSProperties =
    placement === 'top' || placement === 'bottom'
      ? { left: caretOffset, transform: 'translateX(-50%)' }
      : { top: caretOffset, transform: 'translateY(-50%)' };

  return (
    <div
      ref={tipRef}
      role="tooltip"
      className={cn(
        'fixed',
        SURFACE[variant],
        'transition-opacity duration-100 ease-[var(--ease-out)] motion-reduce:transition-none',
        visible && coords ? 'opacity-100' : 'opacity-0',
      )}
      style={coords ?? { top: 0, left: 0 }}
    >
      <span className="min-w-0 break-words">{label}</span>
      {shortcut ? (
        <span className="shrink-0 font-normal text-white/55">
          {shortcut}
        </span>
      ) : null}
      <span aria-hidden className={CARET_CLASS[placement]} style={caretStyle} />
    </div>
  );
}

export function HoverTooltip({
  label,
  placement = 'right',
  shortcut,
  variant = 'dark',
}: {
  label: ReactNode;
  placement?: Placement;
  shortcut?: string;
  variant?: TooltipVariant;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const getTrigger = useCallback(() => markerRef.current?.parentElement ?? null, []);
  const canShow = hasTooltipLabel(label);
  const active = open && canShow;
  const { coords, resolvedPlacement, caretOffset } = useTooltipPosition(active, placement, getTrigger, tipRef);

  useLayoutEffect(() => {
    const parent = markerRef.current?.parentElement;
    if (!parent) return;
    const show = () => {
      if (!hasTooltipLabel(label)) return;
      setOpen(true);
    };
    const hide = () => setOpen(false);
    parent.addEventListener('mouseenter', show);
    parent.addEventListener('mouseleave', hide);
    parent.addEventListener('focusin', show);
    parent.addEventListener('focusout', hide);
    return () => {
      parent.removeEventListener('mouseenter', show);
      parent.removeEventListener('mouseleave', hide);
      parent.removeEventListener('focusin', show);
      parent.removeEventListener('focusout', hide);
    };
  }, [label]);

  return (
    <>
      <span ref={markerRef} aria-hidden className="pointer-events-none absolute size-0" />
      {active
        ? createPortal(
            <TooltipBubble
              label={label}
              shortcut={shortcut}
              variant={variant}
              placement={resolvedPlacement}
              caretOffset={caretOffset}
              coords={coords}
              visible={open}
              tipRef={tipRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}

export function WithHoverTooltip({
  label,
  shortcut,
  placement = 'bottom',
  variant = 'dark',
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
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const getTrigger = useCallback(() => triggerRef.current, []);
  const canShow = hasTooltipLabel(label);
  const active = open && canShow;
  const { coords, resolvedPlacement, caretOffset } = useTooltipPosition(active, placement, getTrigger, tipRef);

  const child = Children.only(children);
  const cleaned = isValidElement(child)
    ? cloneElement(child as ReactElement<{ title?: string }>, { title: undefined })
    : child;

  const show = () => {
    if (!canShow) return;
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
      {active
        ? createPortal(
            <TooltipBubble
              label={label}
              shortcut={shortcut}
              variant={variant}
              placement={resolvedPlacement}
              caretOffset={caretOffset}
              coords={coords}
              visible={open}
              tipRef={tipRef}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
