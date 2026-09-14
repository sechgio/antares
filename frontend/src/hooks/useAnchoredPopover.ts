import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const CLOSE_EVENT = "antares-close-popovers";
const DEFAULT_GAP = 6;
const VIEWPORT_EDGE = 8;
const DEFAULT_MIN_HEIGHT = 80;

export interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight?: number;
}

interface UseAnchoredPopoverOptions {
  /** Fallback popup height before the real element can be measured. */
  estimatedHeight?: number;
  /** Minimum popup width before measuring; ignored with `matchTriggerWidth`. */
  estimatedWidth?: number;
  /** Horizontal alignment of the popup relative to the trigger. */
  align?: "start" | "end" | "center";
  /** "auto" flips upward when space below is tight; "up"/"down" pin the direction. */
  direction?: "auto" | "up" | "down";
  /** Trigger-to-popup gap in px (default 6). */
  gap?: number;
  /** Popup width equals the trigger width instead of a minimum. */
  matchTriggerWidth?: boolean;
  /** When set, `position.maxHeight` is fitted to the space in the open direction. */
  maxHeightCap?: number;
  /** Floor for the fitted `maxHeight` (default 80). */
  minHeight?: number;
  /** Freeze the computed width/maxHeight after the first placement of an open session. */
  lockSize?: boolean;
  /** Close on Escape during the capture phase and swallow the event (keeps parent overlays open). */
  stopEscapePropagation?: boolean;
  /** false → lifecycle only (open/close/outside-click/Escape), no position tracking. */
  floating?: boolean;
  /** Custom geometry; replaces the default anchored computation. */
  positioner?: (trigger: DOMRect, popup: HTMLElement | null) => PopoverPosition;
}

export function useAnchoredPopover<
  T extends HTMLElement = HTMLButtonElement,
  P extends HTMLElement = HTMLDivElement,
>({
  estimatedHeight = 240,
  estimatedWidth = 200,
  align = "start",
  direction = "auto",
  gap = DEFAULT_GAP,
  matchTriggerWidth = false,
  maxHeightCap,
  minHeight = DEFAULT_MIN_HEIGHT,
  lockSize = false,
  stopEscapePropagation = false,
  floating = true,
  positioner,
}: UseAnchoredPopoverOptions = {}) {
  const pickerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<T>(null);
  const popupRef = useRef<P>(null);
  const lockedSizeRef = useRef<{ width: number; maxHeight?: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const popup = popupRef.current;

    let next: PopoverPosition;
    if (positioner) {
      next = positioner(rect, popup);
    } else {
      const height = popup?.offsetHeight ?? estimatedHeight;
      const width = Math.min(
        matchTriggerWidth ? rect.width : Math.max(estimatedWidth, rect.width),
        window.innerWidth - VIEWPORT_EDGE * 2,
      );

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp =
        direction === "up" ||
        (direction !== "down" && spaceBelow < height + gap && spaceAbove > spaceBelow);

      let left = rect.left;
      if (align === "end") left = rect.right - width;
      if (align === "center") left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(VIEWPORT_EDGE, Math.min(left, window.innerWidth - width - VIEWPORT_EDGE));

      let maxHeight: number | undefined;
      if (maxHeightCap != null) {
        const available = (openUp ? spaceAbove : spaceBelow) - gap;
        maxHeight = Math.min(maxHeightCap, Math.max(minHeight, available));
      }

      const effectiveHeight = Math.min(height, maxHeight ?? height);
      const top = openUp
        ? Math.max(VIEWPORT_EDGE, rect.top - effectiveHeight - gap)
        : Math.min(rect.bottom + gap, window.innerHeight - effectiveHeight - VIEWPORT_EDGE);

      next = { top, left, width, ...(maxHeight !== undefined ? { maxHeight } : {}) };
    }

    if (lockSize) {
      lockedSizeRef.current ??= { width: next.width, maxHeight: next.maxHeight };
      next = {
        ...next,
        width: lockedSizeRef.current.width,
        ...(lockedSizeRef.current.maxHeight !== undefined
          ? { maxHeight: lockedSizeRef.current.maxHeight }
          : {}),
      };
    }

    setPosition(next);
  }, [
    align,
    direction,
    estimatedHeight,
    estimatedWidth,
    gap,
    lockSize,
    matchTriggerWidth,
    maxHeightCap,
    minHeight,
    positioner,
  ]);

  const open = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(CLOSE_EVENT, { detail: { except: pickerId } }),
    );
    setIsOpen(true);
  }, [pickerId]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [close, isOpen, open]);

  useEffect(() => {
    const onCloseOthers = (event: Event) => {
      const detail = (event as CustomEvent<{ except?: string }>).detail;
      if (detail?.except !== pickerId) setIsOpen(false);
    };
    window.addEventListener(CLOSE_EVENT, onCloseOthers);
    return () => window.removeEventListener(CLOSE_EVENT, onCloseOthers);
  }, [pickerId]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      lockedSizeRef.current = null;
      return;
    }
    if (floating) updatePosition();
  }, [floating, isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stopEscapePropagation) event.stopPropagation();
      close();
    };
    const onLayout = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      updatePosition();
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey, stopEscapePropagation);
    if (floating) {
      window.addEventListener("resize", onLayout);
      window.addEventListener("scroll", onLayout, true);
    }

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey, stopEscapePropagation);
      if (floating) {
        window.removeEventListener("resize", onLayout);
        window.removeEventListener("scroll", onLayout, true);
      }
    };
  }, [close, floating, isOpen, stopEscapePropagation, updatePosition]);

  return {
    isOpen,
    position,
    triggerRef,
    popupRef,
    open,
    close,
    toggle,
    updatePosition,
  };
}
