import { memo, useMemo, type ComponentProps, type MutableRefObject } from 'react';
import type { CanvasLayer } from '../types';
import LayerNode from './LayerNode';

export type ArtboardLayerCallbacks = Pick<
  ComponentProps<typeof LayerNode>,
  | 'onSelect'
  | 'onLayerPointerDown'
  | 'onContextMenu'
  | 'onStartEdit'
  | 'onEditValue'
  | 'onFitTextHeight'
  | 'onEditStyle'
  | 'onCommitEdit'
  | 'onStartPathEdit'
>;

type ArtboardLayersProps = Pick<
  ComponentProps<typeof LayerNode>,
  'editingSelectAll' | 'editingRange'
> & {
  layers: CanvasLayer[];
  documentLayers: CanvasLayer[];
  masterById: Map<string, CanvasLayer>;
  selectedIdSet: Set<string>;
  movingActive: boolean;
  panning: boolean;
  interactive: boolean;
  editingLayerId: string | null;
  pathEditingLayerId: string | null;
  callbacksRef: MutableRefObject<ArtboardLayerCallbacks>;
};

export default memo(function ArtboardLayers({
  layers,
  documentLayers,
  masterById,
  selectedIdSet,
  movingActive,
  panning,
  interactive,
  editingLayerId,
  pathEditingLayerId,
  editingSelectAll,
  editingRange,
  callbacksRef,
}: ArtboardLayersProps) {
  const callbacks = useMemo<ArtboardLayerCallbacks>(() => ({
    onSelect: (...args) => callbacksRef.current.onSelect(...args),
    onLayerPointerDown: (...args) => callbacksRef.current.onLayerPointerDown?.(...args),
    onContextMenu: (...args) => callbacksRef.current.onContextMenu?.(...args),
    onStartEdit: (...args) => callbacksRef.current.onStartEdit?.(...args),
    onEditValue: (...args) => callbacksRef.current.onEditValue?.(...args),
    onFitTextHeight: (...args) => callbacksRef.current.onFitTextHeight?.(...args),
    onEditStyle: (...args) => callbacksRef.current.onEditStyle?.(...args),
    onCommitEdit: () => callbacksRef.current.onCommitEdit?.(),
    onStartPathEdit: (...args) => callbacksRef.current.onStartPathEdit?.(...args),
  }), [callbacksRef]);

  return layers.map((layer) => (
    <LayerNode
      key={layer.id}
      layer={layer}
      masterLayer={layer.meta?.instanceOf ? masterById.get(layer.meta.instanceOf) ?? null : null}
      documentLayers={documentLayers}
      selected={selectedIdSet.has(layer.id)}
      moving={movingActive && selectedIdSet.has(layer.id)}
      panning={panning}
      interactive={interactive}
      editing={editingLayerId === layer.id}
      pathEditing={pathEditingLayerId === layer.id}
      editingSelectAll={editingSelectAll}
      editingRange={editingRange}
      scale={1}
      {...callbacks}
    />
  ));
});
