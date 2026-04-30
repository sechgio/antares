# Reportes Campo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the `reportes-campo` frontend tool into HidroConvert Desktop without adding backend endpoints or regressing existing tools.

**Architecture:** Copy the feature into `frontend/src/components/reportes-campo`, adapt notifications to the app `useToast` provider, and generate PDFs entirely client-side from the report model. Register the view as a lazy tab in `App.tsx` and `Sidebar.tsx`.

**Tech Stack:** React 18, TypeScript, Vite/Vitest, lucide-react, framer-motion, html-to-image, jsPDF.

---

### Task 1: Navigation Contract

**Files:**
- Modify: `frontend/src/__tests__/App.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('opens Reportes de Campo from the sidebar', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Reportes de Campo/i }));
  expect(await screen.findByRole('heading', { name: /Paneles/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: FAIL because the sidebar tab does not exist.

- [ ] **Step 3: Write minimal implementation**

Add a lazy `ReportesCampoView`, `reportesCampo` tab id, title, `Ctrl+8` shortcut, command palette item, sidebar tab, and render branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: PASS.

### Task 2: Client-Side PDF Export

**Files:**
- Create: `frontend/src/components/reportes-campo/utils/export.ts`
- Create: `frontend/src/components/reportes-campo/utils/export.test.ts`
- Create: `frontend/src/components/reportes-campo/types.ts`
- Create: `frontend/src/components/reportes-campo/constants.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('builds one export page per chunk of photos', () => {
  expect(chunkArray([1, 2, 3, 4, 5], 4)).toEqual([[1, 2, 3, 4], [5]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/reportes-campo/utils/export.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write minimal implementation**

Port constants/types from `FEATURES(no hacer cambios)` and implement `exportReportPdf(config, header, photos, logoLeft, logoRight)` with hidden DOM rendering, `html-to-image`, and `jsPDF` in portrait A4.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/reportes-campo/utils/export.test.ts`
Expected: PASS.

### Task 3: Reportes Campo UI Adaptation

**Files:**
- Create: `frontend/src/components/reportes-campo/index.ts`
- Create: `frontend/src/components/reportes-campo/ReportesCampoView.tsx`
- Create: `frontend/src/components/reportes-campo/components/HeaderForm.tsx`
- Create: `frontend/src/components/reportes-campo/components/PhotoManager.tsx`
- Create: `frontend/src/components/reportes-campo/components/SheetPreview.tsx`
- Create: `frontend/src/components/reportes-campo/rcampo-styles.css`

- [ ] **Step 1: Write the failing test**

Use the navigation test from Task 1 as the integration guard.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: FAIL until the UI files exist and the tab renders.

- [ ] **Step 3: Write minimal implementation**

Port the UI from `FEATURES(no hacer cambios)`, replace `sonner` with `useToast`, remove HTTP export assumptions, and keep all CSS scoped under `.rcampo-app`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx`
Expected: PASS.

### Task 4: Regression Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused frontend tests**

Run: `cd frontend && npx vitest run src/__tests__/App.test.tsx src/components/reportes-campo/utils/export.test.ts`
Expected: PASS.

- [ ] **Step 2: Run frontend typecheck/build**

Run: `npm run typecheck:frontend`
Expected: exit 0.

Run: `npm run build:frontend`
Expected: exit 0.

- [ ] **Step 3: Run backend regression tests if frontend is clean**

Run: `npm test`
Expected: exit 0 or report unrelated pre-existing failures with evidence.
