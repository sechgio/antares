import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const CLOSE_EVENT = "vgen-close-pickers";
const GAP = 6;

export interface PopoverPosition {
  top: number;
  left: number;
  width: number;
}

interface UseAnchoredPopoverOptions {
  estimatedHeight: number;
  estimatedWidth: number;
  /** Prefer aligning popup to the right edge of the trigger when space is tight. */
  align?: "start" | "end" | "center";
}

export function useAnchoredPopover({
  estimatedHeight,
  estimatedWidth,
  align = "start",
}: UseAnchoredPopoverOptions) {
  const pickerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const popup = popupRef.current;
    const height = popup?.offsetHeight ?? estimatedHeight;
    const width = Math.min(
      Math.max(estimatedWidth, rect.width),
      window.innerWidth - 16,
    );

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < height + GAP && rect.top > spaceBelow;

    let left = rect.left;
    if (align === "end") left = rect.right - width;
    if (align === "center") left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

    const top = openUp
      ? Math.max(8, rect.top - height - GAP)
      : Math.min(rect.bottom + GAP, window.innerHeight - height - 8);

    setPosition({ top, left, width });
  }, [align, estimatedHeight, estimatedWidth]);

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
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onLayout = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [close, isOpen, updatePosition]);

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
