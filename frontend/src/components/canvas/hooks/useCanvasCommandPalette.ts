import { useMemo } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { CanvasCommand } from '../editor/CommandPalette';
import type { ViewportNavApi } from '../editor/DesignStage';
import { expandWithDescendants } from '../ops/layerTree';
import {
  alignLayers,
  bringForward,
  bringToFront,
  deleteLayers,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  sendBackward,
  sendToBack,
  setLayersLocked,
  setLayersVisible,
  ungroupLayers,
} from '../ops/layerOps';
import { assignUniqueLogoSides } from '../ops/logoSide';
import { applyAppearanceVars, extractAppearanceVars } from '../ops/clipboardLayers';
import { getPageCount } from '../ops/pages';
import { nextZoomPreset } from '../ops/viewportNav';
import type {
  CanvasDocument,
  CanvasLayer,
  CanvasMode,
  CanvasTool,
  LayerCssVars,
} from '../types';

export interface CanvasPaletteInput {
  paletteOpen: boolean;
  document: CanvasDocument;
  canUndo: boolean;
  canRedo: boolean;
  setDocument: (doc: CanvasDocument) => void;
  selectedIds: string[];
  pageIndex: number;
  pageLayers: CanvasLayer[];
  uiLocked: boolean;
  runUndo: () => void;
  runRedo: () => void;
  pasteClipboard: (offsetMm?: number) => unknown;
  pasteReplaceClipboard: () => unknown;
  copyLayersToClipboard: (layers: CanvasLayer[]) => unknown;
  setAllLayers: (layers: CanvasLayer[]) => void;
  sealPanelAndAbortGesture: () => void;
  onAddPage: () => void;
  onDuplicatePage: (index: number) => void;
  onRemovePage: (index: number) => void;
  onRenamePage: (index: number, name: string) => void;
  zoomToFit: () => void;
  zoomToSelection: () => void;
  toggleBothPanels: () => void;
  togglePreview: () => void;
  handleSave: () => void;
  onNew: () => unknown;
  onDuplicate: () => unknown;
  onOpenTemplates: () => void;
  pdfImport: { pdfImporting: boolean; onImportPdf: () => void };
  setTool: (t: CanvasTool) => void;
  setSelectedIds: (ids: string[]) => void;
  setRenameRequest: Dispatch<SetStateAction<{ layerId: string; nonce: number } | null>>;
  setUiLocked: Dispatch<SetStateAction<boolean>>;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setEyedropperActive: Dispatch<SetStateAction<boolean>>;
  setMode: Dispatch<SetStateAction<CanvasMode>>;
  propsClipboardRef: MutableRefObject<Partial<LayerCssVars> | null>;
  viewportNavRef: RefObject<ViewportNavApi | null>;
}

export function useCanvasCommandPalette(
  input: CanvasPaletteInput,
): { commands: CanvasCommand[]; runners: Map<string, () => void> } | null {
  const {
    paletteOpen,
    document: paletteDoc,
    canUndo,
    canRedo,
    setDocument: setPaletteDocument,
    selectedIds,
    pageIndex,
    pageLayers,
    uiLocked,
    runUndo,
    runRedo,
    pasteClipboard,
    pasteReplaceClipboard,
    copyLayersToClipboard,
    setAllLayers,
    sealPanelAndAbortGesture,
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onRenamePage,
    zoomToFit,
    zoomToSelection,
    toggleBothPanels,
    togglePreview,
    handleSave,
    onNew,
    onDuplicate,
    onOpenTemplates,
    pdfImport,
    setTool,
    setSelectedIds,
    setRenameRequest,
    setUiLocked,
    setShowShortcuts,
    setEyedropperActive,
    setMode,
    propsClipboardRef,
    viewportNavRef,
  } = input;

  return useMemo(() => {
    if (!paletteOpen) return null;
    const doc = paletteDoc;
    const pageCount = getPageCount(doc);
    const editableIds = selectedIds.filter((id) => {
      const l = doc.layers.find((x) => x.id === id);
      return l && !l.locked && l.type !== 'frame';
    });
    const editableSel = editableIds.length > 0;
    const singleLayer =
      editableIds.length === 1 ? doc.layers.find((l) => l.id === editableIds[0]) : undefined;
    const canUngroupSel = Boolean(
      singleLayer && (singleLayer.type === 'group' || singleLayer.type === 'component'),
    );
    const copySelection = () => {
      const deepIds = expandWithDescendants(doc.layers, editableIds);
      const deepIdSet = new Set(deepIds);
      copyLayersToClipboard(doc.layers.filter((l) => deepIdSet.has(l.id)));
    };
    const nav = () => viewportNavRef.current;

    const items: Array<CanvasCommand & { run: () => void }> = [];
    const addTool = (t: CanvasTool, label: string, hint?: string, keywords?: string) =>
      items.push({ id: `tool:${t}`, label, hint, keywords, group: 'Herramientas', run: () => setTool(t) });
    addTool('select', 'Selección', 'V', 'mover puntero');
    addTool('hand', 'Mano', 'H', 'pan navegar');
    addTool('text', 'Texto', 'T');
    addTool('field', 'Campo de datos', 'F', 'excel binding');
    addTool('rect', 'Rectángulo', 'R');
    addTool('ellipse', 'Elipse', 'O', 'círculo');
    addTool('line', 'Línea', 'L');
    addTool('arrow', 'Flecha', 'Shift+L');
    addTool('polygon', 'Polígono', 'Shift+P');
    addTool('star', 'Estrella', 'Shift+S');
    addTool('diamond', 'Rombo', 'Shift+D');
    addTool('hexagon', 'Hexágono', 'Shift+H');
    addTool('pentagon', 'Pentágono', 'Shift+N');
    addTool('image', 'Imagen', 'Shift+K');
    addTool('imageSlot', 'Espacio de imagen', 'I', 'foto slot');
    addTool('logo', 'Logo', undefined, 'logotipo');
    addTool('grid', 'Grid de fotos', 'G', 'cuadrícula imágenes');
    addTool('table', 'Tabla', 'B');
    addTool('checkbox', 'Checkbox', undefined, 'casilla verificación');
    addTool('signature', 'Firma', undefined, 'sello firmar');
    addTool('lasso', 'Lazo', 'U', 'selección libre');
    addTool('bend', 'Curvar línea', 'P', 'editar curva');
    addTool('cut', 'Cortar línea', 'C', 'dividir');

    items.push(
      { id: 'undo', label: 'Deshacer', hint: 'Ctrl+Z', group: 'Editar', disabled: !canUndo, run: runUndo },
      { id: 'redo', label: 'Rehacer', hint: 'Ctrl+Shift+Z', group: 'Editar', disabled: !canRedo, run: runRedo },
      { id: 'copy', label: 'Copiar', hint: 'Ctrl+C', group: 'Editar', disabled: !editableSel, run: copySelection },
      { id: 'paste', label: 'Pegar', hint: 'Ctrl+V', group: 'Editar', run: () => void pasteClipboard() },
      { id: 'pasteInPlace', label: 'Pegar en el sitio', hint: 'Ctrl+Shift+V', group: 'Editar', run: () => void pasteClipboard(0) },
      {
        id: 'duplicate',
        label: 'Duplicar',
        hint: 'Ctrl+D',
        group: 'Editar',
        disabled: !editableSel,
        run: () => {
          const { layers, newIds } = duplicateLayers(doc.layers, editableIds);
          setAllLayers(assignUniqueLogoSides(layers, newIds));
          setSelectedIds(newIds);
        },
      },
      {
        id: 'copyProps',
        label: 'Copiar propiedades',
        hint: 'Ctrl+Alt+C',
        group: 'Editar',
        disabled: !singleLayer,
        run: () => {
          if (singleLayer) propsClipboardRef.current = extractAppearanceVars(singleLayer.cssVars);
        },
      },
      {
        id: 'pasteProps',
        label: 'Pegar propiedades',
        hint: 'Ctrl+Alt+V',
        group: 'Editar',
        disabled: !editableSel || !propsClipboardRef.current,
        run: () => {
          const props = propsClipboardRef.current;
          if (props) setAllLayers(applyAppearanceVars(doc.layers, props, editableIds));
        },
      },
      {
        id: 'eyedropper',
        label: 'Cuentagotas de color',
        hint: 'Alt+C',
        group: 'Editar',
        disabled: !editableSel,
        run: () => setEyedropperActive(true),
      },
      {
        id: 'pasteReplace',
        label: 'Pegar para reemplazar',
        hint: 'Ctrl+Shift+R',
        group: 'Editar',
        disabled: !editableSel,
        run: () => void pasteReplaceClipboard(),
      },
      {
        id: 'selectAll',
        label: 'Seleccionar todo',
        hint: 'Ctrl+A',
        group: 'Editar',
        run: () =>
          setSelectedIds(pageLayers.filter((l) => l.type !== 'frame' && !l.locked).map((l) => l.id)),
      },
      {
        id: 'delete',
        label: 'Eliminar selección',
        hint: 'Supr',
        group: 'Editar',
        disabled: !editableSel,
        run: () => {
          sealPanelAndAbortGesture();
          setAllLayers(deleteLayers(doc.layers, editableIds));
          setSelectedIds([]);
        },
      },
    );

    items.push(
      {
        id: 'group',
        label: 'Agrupar selección',
        hint: 'Ctrl+G',
        group: 'Capas',
        disabled: editableIds.length < 2,
        run: () => {
          const { layers, groupId } = groupLayers(doc.layers, editableIds);
          if (!groupId) return;
          setAllLayers(layers);
          setSelectedIds([groupId]);
        },
      },
      {
        id: 'ungroup',
        label: 'Desagrupar',
        hint: 'Ctrl+Shift+G',
        group: 'Capas',
        disabled: !canUngroupSel,
        run: () => {
          if (singleLayer) setAllLayers(ungroupLayers(doc.layers, singleLayer.id));
        },
      },
      {
        id: 'lock',
        label: 'Bloquear / desbloquear selección',
        hint: 'Ctrl+Shift+L',
        group: 'Capas',
        disabled: !selectedIds.length,
        run: () => {
          const ids = selectedIds.filter((id) => {
            const l = doc.layers.find((x) => x.id === id);
            return l && l.type !== 'frame';
          });
          if (!ids.length) return;
          const allLocked = ids.every((id) => doc.layers.find((l) => l.id === id)?.locked);
          setAllLayers(setLayersLocked(doc.layers, ids, !allLocked));
        },
      },
      {
        id: 'hide',
        label: 'Ocultar / mostrar selección',
        hint: 'Ctrl+Shift+H',
        group: 'Capas',
        disabled: !selectedIds.length,
        run: () => {
          const ids = selectedIds.filter((id) => {
            const l = doc.layers.find((x) => x.id === id);
            return l && l.type !== 'frame';
          });
          if (!ids.length) return;
          const allHidden = ids.every((id) => doc.layers.find((l) => l.id === id)?.visible === false);
          setAllLayers(setLayersVisible(doc.layers, ids, allHidden));
        },
      },
      {
        id: 'bringFront',
        label: 'Traer al frente',
        hint: ']',
        group: 'Capas',
        disabled: !editableSel,
        run: () => setAllLayers(bringToFront(doc.layers, editableIds)),
      },
      {
        id: 'bringForward',
        label: 'Adelante',
        hint: 'Ctrl+]',
        group: 'Capas',
        disabled: !editableSel,
        run: () => setAllLayers(bringForward(doc.layers, editableIds)),
      },
      {
        id: 'sendBackward',
        label: 'Atrás',
        hint: 'Ctrl+[',
        group: 'Capas',
        disabled: !editableSel,
        run: () => setAllLayers(sendBackward(doc.layers, editableIds)),
      },
      {
        id: 'sendBack',
        label: 'Enviar al fondo',
        hint: '[',
        group: 'Capas',
        disabled: !editableSel,
        run: () => setAllLayers(sendToBack(doc.layers, editableIds)),
      },
      {
        id: 'rename',
        label: 'Renombrar capa',
        hint: 'F2',
        group: 'Capas',
        disabled: editableIds.length !== 1,
        run: () => {
          if (editableIds.length === 1) {
            setRenameRequest((prev) => ({ layerId: editableIds[0]!, nonce: (prev?.nonce ?? 0) + 1 }));
          }
        },
      },
    );

    const align = (a: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => () =>
      setAllLayers(alignLayers(doc.layers, editableIds, a, { pageIndex }));
    items.push(
      { id: 'align:left', label: 'Alinear a la izquierda', hint: 'Alt+A', group: 'Alinear', disabled: editableIds.length < 2, run: align('left') },
      { id: 'align:center', label: 'Centrar horizontalmente', hint: 'Alt+H', group: 'Alinear', disabled: editableIds.length < 2, run: align('center') },
      { id: 'align:right', label: 'Alinear a la derecha', hint: 'Alt+D', group: 'Alinear', disabled: editableIds.length < 2, run: align('right') },
      { id: 'align:top', label: 'Alinear arriba', hint: 'Alt+W', group: 'Alinear', disabled: editableIds.length < 2, run: align('top') },
      { id: 'align:middle', label: 'Centrar verticalmente', hint: 'Alt+V', group: 'Alinear', disabled: editableIds.length < 2, run: align('middle') },
      { id: 'align:bottom', label: 'Alinear abajo', hint: 'Alt+S', group: 'Alinear', disabled: editableIds.length < 2, run: align('bottom') },
      {
        id: 'distribute:h',
        label: 'Espaciado uniforme horizontal',
        hint: 'Alt+X',
        group: 'Alinear',
        disabled: editableIds.length < 3,
        run: () => setAllLayers(distributeLayers(doc.layers, editableIds, 'horizontal', { mode: 'gaps' })),
      },
      {
        id: 'distribute:v',
        label: 'Espaciado uniforme vertical',
        hint: 'Alt+Y',
        group: 'Alinear',
        disabled: editableIds.length < 3,
        run: () => setAllLayers(distributeLayers(doc.layers, editableIds, 'vertical', { mode: 'gaps' })),
      },
    );

    items.push(
      { id: 'page:add', label: 'Añadir página', group: 'Páginas', run: onAddPage },
      {
        id: 'page:duplicate',
        label: 'Duplicar página actual',
        group: 'Páginas',
        run: () => onDuplicatePage(pageIndex),
      },
      {
        id: 'page:remove',
        label: 'Eliminar página actual',
        group: 'Páginas',
        disabled: pageCount <= 1,
        run: () => onRemovePage(pageIndex),
      },
      {
        id: 'page:rename',
        label: 'Renombrar página actual',
        group: 'Páginas',
        run: () => onRenamePage(pageIndex, `Página ${pageIndex + 1}`),
      },
    );

    items.push(
      {
        id: 'zoom:in',
        label: 'Acercar',
        hint: 'Ctrl++',
        group: 'Vista',
        run: () => {
          const n = nav();
          if (n) n.animateTo({ zoom: nextZoomPreset(n.getZoom(), 'in'), pan: n.getPan() });
        },
      },
      {
        id: 'zoom:out',
        label: 'Alejar',
        hint: 'Ctrl+-',
        group: 'Vista',
        run: () => {
          const n = nav();
          if (n) n.animateTo({ zoom: nextZoomPreset(n.getZoom(), 'out'), pan: n.getPan() });
        },
      },
      { id: 'zoom:fit', label: 'Ajustar a la vista', hint: 'Shift+1', group: 'Vista', run: zoomToFit },
      {
        id: 'zoom:selection',
        label: 'Zoom a la selección',
        hint: 'Shift+2',
        group: 'Vista',
        disabled: !selectedIds.length,
        run: zoomToSelection,
      },
      {
        id: 'zoom:100',
        label: 'Zoom al 100%',
        hint: 'Ctrl+0',
        group: 'Vista',
        run: () => {
          const n = nav();
          if (n) n.animateTo({ zoom: 1, pan: n.getPan() });
        },
      },
      {
        id: 'view:rulers',
        label: 'Mostrar / ocultar reglas',
        hint: 'Shift+R',
        group: 'Vista',
        run: () =>
          setPaletteDocument({
            ...doc,
            settings: { ...doc.settings, showRulers: doc.settings?.showRulers === false },
          }),
      },
      {
        id: 'view:grid',
        label: 'Snap a cuadrícula',
        hint: "Shift+'",
        group: 'Vista',
        run: () =>
          setPaletteDocument({
            ...doc,
            settings: { ...doc.settings, snapToGrid: !doc.settings?.snapToGrid },
          }),
      },
      {
        id: 'view:panels',
        label: 'Mostrar / ocultar paneles',
        hint: 'Ctrl+\\',
        group: 'Vista',
        run: toggleBothPanels,
      },
      {
        id: 'view:lockUi',
        label: uiLocked ? 'Desbloquear interfaz' : 'Bloquear interfaz',
        group: 'Vista',
        run: () => setUiLocked((v) => !v),
      },
      {
        id: 'view:shortcuts',
        label: 'Atajos de teclado',
        hint: '?',
        group: 'Vista',
        run: () => setShowShortcuts((v) => !v),
      },
      { id: 'view:preview', label: 'Vista previa', group: 'Vista', run: togglePreview },
    );

    items.push(
      { id: 'doc:save', label: 'Guardar documento', hint: 'Ctrl+S', group: 'Documento', run: handleSave },
      { id: 'doc:new', label: 'Nuevo documento', group: 'Documento', run: () => void onNew() },
      { id: 'doc:duplicate', label: 'Duplicar documento', group: 'Documento', run: () => void onDuplicate() },
      { id: 'doc:templates', label: 'Explorar plantillas', group: 'Documento', run: onOpenTemplates },
      {
        id: 'doc:importPdf',
        label: 'Importar PDF',
        group: 'Documento',
        disabled: pdfImport.pdfImporting,
        run: pdfImport.onImportPdf,
      },
      {
        id: 'doc:generate',
        label: 'Ir a Generación',
        group: 'Documento',
        run: () => setMode('generate'),
      },
    );

    const runners = new Map(items.map((c) => [c.id, c.run]));
    return { commands: items.map(({ run: _run, ...c }) => c), runners };
  }, [
    paletteOpen,
    paletteDoc,
    canUndo,
    canRedo,
    setPaletteDocument,
    selectedIds,
    pageIndex,
    pageLayers,
    uiLocked,
    runUndo,
    runRedo,
    pasteClipboard,
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onRenamePage,
    zoomToFit,
    zoomToSelection,
    toggleBothPanels,
    togglePreview,
    handleSave,
    onNew,
    onDuplicate,
    onOpenTemplates,
    pdfImport,
    sealPanelAndAbortGesture,
    copyLayersToClipboard,
    pasteReplaceClipboard,
    setAllLayers,
  ]);
}
