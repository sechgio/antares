import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createLayer } from './components/canvas/constants';
import Artboard from './components/canvas/editor/Artboard';
import { createEmptyDocument, type CanvasGuide, type CanvasLayer } from './components/canvas/types';
import './index.css';
import './components/canvas/canvas.css';

const MM_PX = 96 / 25.4;

export interface PerfConfig {
  layers: number;
  selected: number;
  guides: number;
  snapToGrid: boolean;
  zoom: number;
  frames: number;
  tool: 'select' | 'hand';
}

const DEFAULT_CONFIG: PerfConfig = {
  layers: 600,
  selected: 20,
  guides: 30,
  snapToGrid: true,
  zoom: 1,
  frames: 90,
  tool: 'select',
};

function makeLayers(n: number, cols = 20): CanvasLayer[] {
  return Array.from({ length: n }, (_, i) =>
    createLayer('rect', {
      id: `l${i}`,
      cssVars: {
        '--translate-x': `${(i % cols) * 10}mm`,
        '--translate-y': `${Math.floor(i / cols) * 10}mm`,
        '--width': '8mm',
        '--height': '8mm',
      },
    }),
  );
}

function makeGuides(n: number): CanvasGuide[] {
  const guides: CanvasGuide[] = [];
  for (let i = 0; i < n; i++) {
    guides.push({ id: `gx${i}`, axis: 'x', posMm: (i + 1) * 5 });
    guides.push({ id: `gy${i}`, axis: 'y', posMm: (i + 1) * 7 });
  }
  return guides;
}

interface StageProps {
  doc: CanvasDocumentLike;
  selectedIds: string[];
  initialZoom: number;
  snapToGrid: boolean;
  tool: 'select' | 'hand';
}

type CanvasDocumentLike = ReturnType<typeof createEmptyDocument>;

let stageApi: { setZoom: (z: number) => void } | null = null;

function Stage({ doc, selectedIds, initialZoom, snapToGrid, tool }: StageProps) {
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  stageApi = { setZoom };
  return (
    <Artboard
      document={doc}
      selectedIds={selectedIds}
      zoom={zoom}
      tool={tool}
      pan={pan}
      onPan={setPan}
      onZoom={setZoom}
      onSelect={() => {}}
      onSelectIds={() => {}}
      onChangeLayers={() => {}}
      snapToGrid={snapToGrid}
    />
  );
}

let currentConfig: PerfConfig = { ...DEFAULT_CONFIG };
let currentUnmount: (() => void) | null = null;

function mount(cfg: PerfConfig): void {
  currentUnmount?.();
  const doc = createEmptyDocument('Perf');
  doc.layers.push(...makeLayers(cfg.layers));
  if (cfg.guides > 0) doc.guides = makeGuides(cfg.guides);
  const selectedIds = Array.from({ length: Math.min(cfg.selected, cfg.layers) }, (_, i) => `l${i}`);
  const rootEl = document.getElementById('root')!;
  const root = createRoot(rootEl);
  root.render(
    <Stage
      doc={doc}
      selectedIds={selectedIds}
      initialZoom={cfg.zoom}
      snapToGrid={cfg.snapToGrid}
      tool={cfg.tool}
    />,
  );
  currentUnmount = () => root.unmount();
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await nextFrame();
}

function frameDeltas(n: number): Promise<number[]> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let prev = performance.now();
    let count = 0;
    const loop = () => {
      const now = performance.now();
      deltas.push(now - prev);
      prev = now;
      count += 1;
      if (count < n) requestAnimationFrame(loop);
      else resolve(deltas);
    };
    requestAnimationFrame(loop);
  });
}

function stats(deltas: number[]) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    n: deltas.length,
    mean: Number((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)),
    p95: Number(p(0.95).toFixed(2)),
    p99: Number(p(0.99).toFixed(2)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    over20: deltas.filter((d) => d > 20).length,
    over33: deltas.filter((d) => d > 33).length,
  };
}

function actualZoom(): number {
  const el = document.querySelector<HTMLElement>('[data-testid="canvas-artboard"]');
  if (!el) return 1;
  const match = /scale\(([^)]+)\)/.exec(el.style.transform);
  return match ? Number.parseFloat(match[1]) || 1 : 1;
}

function layerNode(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  if (!node) throw new Error(`layer node ${id} not mounted`);
  return node;
}

const pe = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...init });

interface DragResult {
  deltas: number[];
  applied: boolean;
}

async function runDrag(frames: number): Promise<DragResult> {
  const node = layerNode('l0');
  const r = node.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const before = node.style.transform;
  node.dispatchEvent(pe('pointerdown', { button: 0, clientX: cx, clientY: cy }));
  await settle();
  const deltas: number[] = [];
  let prev = performance.now();
  let applied = false;
  for (let i = 1; i <= frames; i++) {
    window.dispatchEvent(
      pe('pointermove', { clientX: cx + i * MM_PX, clientY: cy + i * 0.4 * MM_PX }),
    );
    await nextFrame();
    if (!applied && node.style.transform !== before) applied = true;
    const now = performance.now();
    deltas.push(now - prev);
    prev = now;
  }
  window.dispatchEvent(
    pe('pointerup', { clientX: cx + frames * MM_PX, clientY: cy + frames * 0.4 * MM_PX }),
  );
  return { deltas, applied };
}

async function runPinch(frames: number): Promise<{ deltas: number[]; zoomed: boolean }> {
  const viewport = document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]')!;
  const vr = viewport.getBoundingClientRect();
  const cx = vr.x + vr.width / 2;
  const cy = vr.y + vr.height / 2;
  const zoomBefore = actualZoom();
  const touch = (type: string, id: number, x: number, y: number) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: id,
        isPrimary: id === 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
      }),
    );
  touch('pointerdown', 1, cx - 40, cy);
  touch('pointerdown', 2, cx + 40, cy);
  await settle();
  const deltas: number[] = [];
  let prev = performance.now();
  for (let i = 1; i <= frames; i++) {
    const spread = 40 + i * 0.6;
    touch('pointermove', 1, cx - spread, cy);
    touch('pointermove', 2, cx + spread, cy);
    await nextFrame();
    const now = performance.now();
    deltas.push(now - prev);
    prev = now;
  }
  touch('pointerup', 1, cx - 40 - frames * 0.6, cy);
  touch('pointerup', 2, cx + 40 + frames * 0.6, cy);
  await nextFrame();
  return { deltas, zoomed: actualZoom() !== zoomBefore };
}

async function runPan(frames: number): Promise<{ deltas: number[] }> {
  const viewport = document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]')!;
  const r = viewport.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  viewport.dispatchEvent(pe('pointerdown', { button: 0, clientX: cx, clientY: cy }));
  await settle();
  const deltas: number[] = [];
  let prev = performance.now();
  for (let i = 1; i <= frames; i++) {
    window.dispatchEvent(pe('pointermove', { clientX: cx + i * MM_PX, clientY: cy + i * 0.4 * MM_PX }));
    await nextFrame();
    const now = performance.now();
    deltas.push(now - prev);
    prev = now;
  }
  window.dispatchEvent(pe('pointerup', { clientX: cx + frames * MM_PX, clientY: cy + frames * 0.4 * MM_PX }));
  return { deltas };
}

async function runResize(frames: number): Promise<{ deltas: number[]; applied: boolean }> {
  const handle = document.querySelector<HTMLElement>('[data-testid="canvas-resize-handle-se"]');
  if (!handle) return { deltas: [], applied: false };
  const r = handle.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  handle.dispatchEvent(pe('pointerdown', { button: 0, clientX: cx, clientY: cy }));
  await settle();
  const deltas: number[] = [];
  let prev = performance.now();
  for (let i = 1; i <= frames; i++) {
    window.dispatchEvent(pe('pointermove', { clientX: cx + i * MM_PX, clientY: cy + i * 0.4 * MM_PX }));
    await nextFrame();
    const now = performance.now();
    deltas.push(now - prev);
    prev = now;
  }
  window.dispatchEvent(pe('pointerup', { clientX: cx + frames * MM_PX, clientY: cy + frames * 0.4 * MM_PX }));
  return { deltas, applied: true };
}

interface RunResult {
  config: PerfConfig;
  actualZoom: number;
  baseline: ReturnType<typeof stats>;
  drag: ReturnType<typeof stats>;
  pinch: ReturnType<typeof stats>;
  pan: ReturnType<typeof stats>;
  resize: ReturnType<typeof stats>;
  dragApplied: boolean;
  pinchZoomed: boolean;
}

async function run(overrides: Partial<PerfConfig> = {}): Promise<RunResult> {
  const cfg: PerfConfig = { ...DEFAULT_CONFIG, ...overrides };
  currentConfig = cfg;
  mount(cfg);
  await settle();
  if (stageApi && Math.abs(actualZoom() - cfg.zoom) > 0.01) {
    stageApi.setZoom(cfg.zoom);
    await settle();
  }
  const baselineDeltas = await frameDeltas(Math.min(60, cfg.frames));
  const drag = cfg.tool === 'hand' ? { deltas: [], applied: false } : await runDrag(cfg.frames);
  const resize = cfg.tool === 'hand' ? { deltas: [], applied: false } : await runResize(Math.min(60, cfg.frames));
  const pan = cfg.tool === 'hand' ? await runPan(cfg.frames) : { deltas: [] };
  const pinch = await runPinch(Math.min(60, cfg.frames));
  return {
    config: cfg,
    actualZoom: actualZoom(),
    baseline: stats(baselineDeltas),
    drag: stats(drag.deltas),
    pinch: stats(pinch.deltas),
    pan: stats(pan.deltas),
    resize: stats(resize.deltas),
    dragApplied: drag.applied,
    pinchZoomed: pinch.zoomed,
  };
}

(window as unknown as { __perfHarness: { run: typeof run; setConfig: (c: Partial<PerfConfig>) => void } }).__perfHarness = {
  run,
  setConfig: (c) => {
    currentConfig = { ...currentConfig, ...c };
    mount(currentConfig);
  },
};

mount(currentConfig);
