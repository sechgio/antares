# Image Optimizer UI — Preview-first redesign

**Date:** 2026-07-15  
**Status:** Approved  
**Scope:** Visual / UX polish only — no pipeline or business-logic changes

## Goal

Reorganize visual hierarchy so the preview is the protagonist, side panels feel like light glass materials, and the top toolbar is calmer — while keeping every existing behavior and data flow intact.

Guided by Apple fluid-interface principles (response, materials, interruptible feedback) and make-interfaces-feel-better details (concentric radii, scale on press, tabular nums, specific transitions).

## Constraints

- Preserve all functionality: presets, output folder, process scopes, download menu (ZIP / individual), clear, drag-drop add, queue (select, reorder, crop, download, exclude), settings operations, preview tabs, item overrides, crop editor.
- Do not change `pipeline.ts`, `utils.ts`, `presets.ts`, `types.ts`, `zip.ts`, or CropEditor behavior/API.
- Prefer className / markup-only changes in UI components. Props and handlers stay the same unless a pure visual wrapper requires no API change.
- Existing tests (`ui.test`, `downloadMenu`, App smoke for Optimizador) must remain green.
- No new animation libraries.

## Approach

**Preview-first “stage”** (chosen over floating command-bar or filmstrip queue):

- Keep the three-column mental model: Settings | Preview | Queue.
- Soften surfaces: glass laterals, stage-like preview center, calm translucent toolbar.
- Re-weight the toolbar into secondary vs primary action groups.

## Layout

```
┌─ Toolbar (glass) ──────────────────────────────────────────┐
│  [Presets…]     [Folder] [Add]  │  [Process] [Download▾] [Clear] │
└────────────────────────────────────────────────────────────┘
┌─ Settings glass ─┐  ┌──── Preview stage ────────────────┐  ┌─ Queue glass ─┐
│  operation       │  │  image dominant; floating chrome  │  │  list + bulk  │
│  sections        │  │  (tabs / stats / view mode)       │  │  actions      │
└──────────────────┘  └───────────────────────────────────┘  └───────────────┘
```

- Grid remains `xl:grid-cols-[…_minmax(0,1fr)_…]` (exact column widths may be tuned slightly for breathing room; structure unchanged).
- Preview: no heavy card competing with the image; soft edge or none; workspace background shows through.
- Empty state: same upload affordance, more whitespace, readable (non-mono) title; mono reserved for metadata.

## Toolbar

- Glass strip: semi-transparent background + `backdrop-blur` / saturate.
- Left: preset pills — quieter inactive state; active = typographic/weight contrast, no heavy glow.
- Right, two clusters:
  - Secondary: destination folder, add images.
  - Primary: process, download split-button (+ portal menu unchanged), clear.
- Labels: sentence case / normal tracking for chrome; `font-mono` only for sizes, KB, dimensions, progress counts.
- Controls: ≥40×40 hit area where dense desktop UI allows; `active:scale-[0.96]`; feedback on pointer-down; `transition-*` on specific properties only (never `transition-all`).

## Materials & surfaces

- Side panels: `backdrop-filter: blur() saturate()`, translucent fill, layered transparent shadows instead of hard 1px borders.
- Concentric border radius: outer ≈ inner + padding on nested controls/cards.
- Preview chrome (tabs, stats, view toggle): floats over the stage; does not steal vertical space with opaque bars.
- Progress bar / toasts: `tabular-nums` on counts and percentages; drop exaggerated purple glow on progress fill.
- Respect `prefers-reduced-motion: reduce` — short opacity cross-fades; no elastic scale/overshoot.

## Micro-interactions (feel)

- Buttons/pills: scale on press (`0.96`), interruptible CSS transitions.
- Segmented controls / switches: keep behavior; polish visuals for consistency with glass chrome.
- Before/after compare: keep range control API; visual polish only (labels, handle, no glow noise) unless a pointer-driven 1:1 drag can be added without changing parent contracts — prefer polish first, optional gesture polish if low risk.
- Drag-reorder in queue: keep existing HTML5 DnD; visual drop-target feedback may be clarified (highlight), not reimplemented.

## Files in scope

| File | Change type |
| --- | --- |
| `frontend/src/components/image-optimizer/index.tsx` | Toolbar layout/grouping, shell spacing, glass wrapper classes |
| `frontend/src/components/image-optimizer/ui.tsx` | Shared primitives: toasts, progress, segmented, pills, operation sections, switches |
| `frontend/src/components/image-optimizer/PreviewWorkspace.tsx` | Stage layout, empty state, floating chrome, grid cards |
| `frontend/src/components/image-optimizer/QueuePanel.tsx` | Glass panel, list density, action hit areas |
| `frontend/src/components/image-optimizer/SettingsPanel.tsx` | Glass panel, form control visual consistency |

## Out of scope

- Pipeline / compression / naming logic
- New presets or settings fields
- CropEditor redesign
- Filmstrip queue or layout topology change
- New dependencies (Motion, etc.)
- Documentation beyond this spec (unless requested)

## Success criteria

1. Visual hierarchy: preview reads as primary; laterals and toolbar as supporting chrome.
2. Behavior parity: every current action works identically (including download portal menu and processing overlay).
3. Tests: `frontend` image-optimizer related Vitest suites and App Optimizador smoke pass.
4. Accessibility: hit targets, reduced motion, and existing aria on download menu preserved or improved.

## Implementation notes

- Prefer editing existing classNames over new CSS files.
- Reuse CSS variables already in the app (`--bg-*`, `--text-*`, `--border-*`, accents).
- After UI changes, run targeted Vitest for image-optimizer + typecheck as needed.
- Present a Before/After principle table in the PR/summary per make-interfaces-feel-better review format.
