import { useState } from 'react';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';

/**
 * Popover whose titlebar trigger keeps its rendered width while the panel is
 * open (radio and spotify bars measure the chip and pin it on toggle).
 */
export function useBrowseWidthPopover({ width, height }: { width: number; height: number }) {
  const popover = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    direction: 'down',
    align: 'end',
    estimatedWidth: width,
    estimatedHeight: height,
    gap: 6,
  });
  const [browseWidth, setBrowseWidth] = useState<number | null>(null);

  const onTriggerClick = () => {
    if (!popover.isOpen && popover.triggerRef.current) {
      setBrowseWidth(popover.triggerRef.current.getBoundingClientRect().width);
    }
    popover.toggle();
  };

  return { popover, browseWidth, onTriggerClick };
}
