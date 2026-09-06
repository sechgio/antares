import { useCallback, useEffect, useRef, useState } from 'react';

interface Position {
  x: number;
  y: number;
}

interface UseFloatingPanelOptions {
  isOpen: boolean;
  panelWidth: number;
  storageKeyPosition: string;
  storageKeyPinned: string;
  ignoreSelector: string;
}

function defaultPosition(panelWidth: number): Position {
  const fabRight = 24;
  const fabWidth = 52;
  const gap = 16;
  const x = window.innerWidth - fabRight - fabWidth - gap - panelWidth;
  const y = Math.max(20, (window.innerHeight - 450) / 2);
  return {
    x: Math.max(10, x),
    y: Math.max(10, y),
  };
}

export function useFloatingPanel({
  isOpen,
  panelWidth,
  storageKeyPosition,
  storageKeyPinned,
  ignoreSelector,
}: UseFloatingPanelOptions) {
  const [position, setPosition] = useState<Position>(() => defaultPosition(panelWidth));
  const [isDragging, setIsDragging] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const savedPosition = localStorage.getItem(storageKeyPosition);
    if (savedPosition) {
      try {
        setPosition(JSON.parse(savedPosition));
      } catch {
        setPosition(defaultPosition(panelWidth));
      }
    } else {
      setPosition(defaultPosition(panelWidth));
    }

    setIsPinned(localStorage.getItem(storageKeyPinned) === 'true');
  }, [isOpen, panelWidth, storageKeyPinned, storageKeyPosition]);

  useEffect(() => {
    if (isOpen && isPinned) {
      localStorage.setItem(storageKeyPosition, JSON.stringify(position));
      localStorage.setItem(storageKeyPinned, 'true');
    }
  }, [position, isPinned, isOpen, storageKeyPinned, storageKeyPosition]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest(ignoreSelector)) return;

      e.preventDefault();
      setIsDragging(true);
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    [ignoreSelector],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = window.innerWidth - (panelWidth + 20);
      const maxY = window.innerHeight - 100;
      setPosition({
        x: Math.max(0, Math.min(e.clientX - dragOffset.x, maxX)),
        y: Math.max(0, Math.min(e.clientY - dragOffset.y, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, panelWidth]);

  const handlePinToggle = () => {
    setIsPinned((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem(storageKeyPosition, JSON.stringify(position));
        localStorage.setItem(storageKeyPinned, 'true');
      } else {
        localStorage.removeItem(storageKeyPosition);
        localStorage.removeItem(storageKeyPinned);
      }
      return next;
    });
  };

  const handleResetPosition = () => {
    setPosition(defaultPosition(panelWidth));
    localStorage.removeItem(storageKeyPosition);
  };

  return {
    panelRef,
    position,
    isDragging,
    isPinned,
    handleMouseDown,
    handlePinToggle,
    handleResetPosition,
  };
}
