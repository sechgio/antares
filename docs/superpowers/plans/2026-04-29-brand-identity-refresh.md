# Brand Identity Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh HidroConvert with the selected Precision Linear brand direction.

**Architecture:** Introduce a small reusable brand component for the app mark and wordmark, replace the inline sidebar mark with that component, and update global tokens/assets to the new indigo/teal system. Keep behavior unchanged and limit visual edits to brand identity surfaces.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest, SVG assets.

---

### File Structure

- Create `frontend/src/components/brand/BrandMark.tsx`: reusable SVG monogram plus optional wordmark/tagline.
- Create `frontend/src/components/brand/__tests__/BrandMark.test.tsx`: verifies accessible label and optional copy.
- Modify `frontend/src/components/layout/Sidebar.tsx`: replaces inline orange lightning logo with the new brand component.
- Modify `frontend/src/index.css`: updates design tokens from orange to Precision Linear indigo/teal.
- Modify `frontend/tailwind.config.js`: updates Tailwind aliases for accent and border colors.
- Modify `frontend/src/components/ui/Button.tsx`: makes primary button use CSS variables instead of hardcoded orange.
- Modify `assets/logo.svg`: replaces the warm overlapping-circle logo with the new HC monogram asset.
- Modify `README.md`: updates design description and palette docs.

### Task 1: Brand Component

**Files:**
- Create: `frontend/src/components/brand/BrandMark.tsx`
- Test: `frontend/src/components/brand/__tests__/BrandMark.test.tsx`

- [ ] **Step 1: Write the failing test**

Create a test that renders `BrandMark` with `showText` and expects the accessible label, product name, and tagline.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/brand/__tests__/BrandMark.test.tsx`
Expected: fail because `BrandMark.tsx` does not exist yet.

- [ ] **Step 3: Implement the minimal component**

Create `BrandMark.tsx` with an inline SVG mark, `showText`, `size`, and `className` props.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/brand/__tests__/BrandMark.test.tsx`
Expected: pass.

### Task 2: Apply Brand In App Shell

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/components/ui/Button.tsx`

- [ ] **Step 1: Use the brand component in the sidebar**

Replace the inline orange lightning brand block with `BrandMark`.

- [ ] **Step 2: Update global tokens**

Change accent variables to indigo/teal values and add focused shadow tokens.

- [ ] **Step 3: Remove hardcoded primary button orange**

Use `var(--accent-primary)` and `var(--accent-primary-hover)` for primary button hover behavior.

- [ ] **Step 4: Run the brand component test again**

Run: `cd frontend && npx vitest run src/components/brand/__tests__/BrandMark.test.tsx`
Expected: pass.

### Task 3: Asset And Documentation

**Files:**
- Modify: `assets/logo.svg`
- Modify: `README.md`

- [ ] **Step 1: Replace app logo SVG**

Create a clean HC monogram in the selected Precision Linear palette.

- [ ] **Step 2: Update README design section**

Replace Mastercard/orange language with Precision Linear identity details.

- [ ] **Step 3: Verify compile/build surface**

Run: `cd frontend && npm run build`
Expected: TypeScript and Vite build complete successfully.
