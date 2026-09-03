import type { CanvasLayer } from '../../types';
import { isShapeLayer } from '../../ops/layerStyle';
import type { PanelSection } from './types';
import TextSection from './tails/TextSection';
import FieldSection from './tails/FieldSection';
import LogoSection from './tails/LogoSection';
import ImageSection from './tails/ImageSection';
import ImageSlotSection from './tails/ImageSlotSection';
import GridSection from './tails/GridSection';
import CheckboxSection from './tails/CheckboxSection';
import SignatureSection from './tails/SignatureSection';
import TableSection from './tails/TableSection';
import AutoLayoutSection, { ConstraintsSection } from './common/AutoLayoutSection';
import InstanceSection from './common/InstanceSection';
import BooleanMaskSection, { showBooleanMaskSection } from './common/BooleanMaskSection';

export const LAYOUT_SECTIONS: PanelSection[] = [
  { test: (l) => l.type === 'frame' || l.type === 'group' || l.type === 'component', Component: AutoLayoutSection },
  {
    test: (l) => Boolean(l.parentId),
    Component: ConstraintsSection,
  },
  {
    test: (l) =>
      Boolean(l.meta?.instanceOf) ||
      l.type === 'frame' ||
      l.type === 'component' ||
      l.type === 'group' ||
      l.type === 'rect',
    Component: InstanceSection,
  },
  { test: showBooleanMaskSection, Component: BooleanMaskSection },
];

export const TAIL_SECTIONS: PanelSection[] = [
  { test: (l) => l.type === 'text' || l.type === 'field', Component: TextSection },
  { test: (l) => l.type === 'field', Component: FieldSection },
  { test: (l) => l.type === 'logo', Component: LogoSection },
  { test: (l) => l.type === 'image', Component: ImageSection },
  { test: (l) => l.type === 'imageSlot', Component: ImageSlotSection },
  { test: (l) => l.type === 'grid', Component: GridSection },
  { test: (l) => l.type === 'checkbox', Component: CheckboxSection },
  { test: (l) => l.type === 'signature', Component: SignatureSection },
  { test: (l) => l.type === 'table', Component: TableSection },
];

export function isShapeTail(layer: CanvasLayer): boolean {
  return isShapeLayer(layer);
}
