# Volante Lurigancho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar la nueva salida `volante lurigancho` a `Generar Padrones` sin alterar el comportamiento actual de las otras plantillas.

**Architecture:** La nueva plantilla reutiliza el flujo de datos del padron actual y agrega una variante explicita de render en `PreviewPage`. `PadronView` decide la variante activa, `data.ts` registra la opcion nueva y `vpad-styles.css` encapsula los cambios visuales propios del nuevo formato.

**Tech Stack:** React, TypeScript, Vitest, CSS, Vite.

---

### Task 1: Registrar el nuevo formato de salida

**Files:**
- Modify: `frontend/src/components/padron/data.test.ts`
- Modify: `frontend/src/components/padron/data.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('defines the volante lurigancho output format without changing the default', () => {
  expect(OUTPUT_FORMAT_OPTIONS[0]).toMatchObject({
    value: 'service-interruption',
    label: 'Plantilla actual',
  });
  expect(OUTPUT_FORMAT_OPTIONS).toContainEqual({
    value: 'volante-lurigancho',
    label: 'volante lurigancho',
    rowsPerPage: 18,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/padron/data.test.ts`

Expected: FAIL because `volante-lurigancho` is not defined yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type OutputFormat = 'service-interruption' | 'volante-lurigancho' | 'water-cut-notice';

export const OUTPUT_FORMAT_OPTIONS = [
  { value: 'service-interruption' as OutputFormat, label: 'Plantilla actual', rowsPerPage: 18 },
  { value: 'volante-lurigancho' as OutputFormat, label: 'volante lurigancho', rowsPerPage: 18 },
  { value: 'water-cut-notice' as OutputFormat, label: 'Aviso corte de agua', rowsPerPage: 36 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/padron/data.test.ts`

Expected: PASS.

### Task 2: Fijar el contrato visual de la nueva variante

**Files:**
- Create: `frontend/src/components/padron/PreviewPage.test.tsx`
- Modify: `frontend/src/components/padron/PreviewPage.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultHeaderData, createInitialItems } from './data';
import PreviewPage from './PreviewPage';

const commonProps = {
  headerData: createDefaultHeaderData(),
  items: createInitialItems(18),
  orientation: 'landscape' as const,
  accionaLogo: 'acciona.png',
  sedapalLogo: 'sedapal.png',
  totalPages: 3,
};

describe('PreviewPage volante lurigancho variant', () => {
  it('renders the full upper layout on the first page', () => {
    render(
      <PreviewPage
        {...commonProps}
        variant="volante-lurigancho"
        pageNumber={1}
        isFirstPage
        isLastPage={false}
      />,
    );

    expect(screen.getByRole('heading', {
      name: 'NOTIFICACIÓN A TRAVÉS DE VOLANTES POR INTERRUPCIÓN DEL SERVICIO DE AGUA POTABLE',
    })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.queryByText('Página 1 de 3')).not.toBeInTheDocument();
    expect(screen.getByText('Responsable del volanteo :')).toBeInTheDocument();
  });

  it('keeps the table but omits the upper layout on later pages', () => {
    render(
      <PreviewPage
        {...commonProps}
        variant="volante-lurigancho"
        pageNumber={2}
        isFirstPage={false}
        isLastPage={false}
      />,
    );

    expect(screen.queryByRole('heading', {
      name: 'NOTIFICACIÓN A TRAVÉS DE VOLANTES POR INTERRUPCIÓN DEL SERVICIO DE AGUA POTABLE',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByText('Responsable del volanteo :')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/padron/PreviewPage.test.tsx`

Expected: FAIL because `PreviewPage` does not accept `variant` or `isFirstPage`, repeats the upper layout, and still renders `Página X de Y`.

- [ ] **Step 3: Write minimal implementation**

```tsx
interface PreviewPageProps {
  headerData: HeaderData;
  items: PadronItem[];
  orientation: Orientation;
  accionaLogo: string;
  sedapalLogo: string;
  pageNumber: number;
  totalPages: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  variant?: 'service-interruption' | 'volante-lurigancho';
}
```

```tsx
const isLurigancho = variant === 'volante-lurigancho';
const showUpperLayout = !isLurigancho || isFirstPage;
const showCurrentVolanteo = !isLurigancho && isLastPage;
const showLuriganchoVolanteo = isLurigancho;
```

```tsx
{showUpperLayout && (
  <>
    {/* existing header, meta, areas and notes blocks */}
  </>
)}

{showCurrentVolanteo && (
  <div className="vpad-volanteo-section">
    {/* existing current-template footer content */}
  </div>
)}

{showLuriganchoVolanteo && (
  <div className="vpad-volanteo-section vpad-volanteo-section-lurigancho">
    <div className="vpad-volanteo-line">
      <span className="vpad-volanteo-label">Responsable del volanteo :</span>
      <span className="vpad-volanteo-value">{'\u00A0'}</span>
    </div>
  </div>
)}

<div className={isLurigancho ? 'vpad-sheet-folio-top' : 'vpad-sheet-foot'}>
  {isLurigancho ? `${pageNumber} de ${totalPages}` : `Página ${pageNumber} de ${totalPages}`}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/padron/PreviewPage.test.tsx`

Expected: PASS.

### Task 3: Integrar la variante en la vista principal

**Files:**
- Modify: `frontend/src/components/padron/PadronView.test.tsx`
- Modify: `frontend/src/components/padron/PadronView.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('switches to the volante lurigancho layout while keeping padron controls', async () => {
  render(<PadronView />);

  const formatSelect = screen.getByLabelText('Formato de salida');
  fireEvent.change(formatSelect, { target: { value: 'volante-lurigancho' } });

  expect(formatSelect).toHaveValue('volante-lurigancho');
  expect(screen.getByText('Datos del Padrón')).toBeInTheDocument();
  expect(screen.getByText('Orientación')).toBeInTheDocument();
  expect(screen.getByText('1 de 2')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/padron/PadronView.test.tsx`

Expected: FAIL because the format is not recognized by the page renderer yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
const isWaterCutNotice = outputFormat === 'water-cut-notice';
const previewVariant = outputFormat === 'volante-lurigancho'
  ? 'volante-lurigancho'
  : 'service-interruption';
```

```tsx
<PreviewPage
  headerData={headerData}
  items={pageItems as PadronItem[]}
  orientation={orientation}
  accionaLogo={logosBase64.acciona || ACCIONA_LOGO}
  sedapalLogo={logosBase64.sedapal || SEDAPAL_LOGO}
  pageNumber={batchStart + j + 1}
  totalPages={exportPages.length}
  isFirstPage={batchStart + j === 0}
  isLastPage={batchStart + j === exportPages.length - 1}
  variant={previewVariant}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/padron/PadronView.test.tsx`

Expected: PASS.

### Task 4: Encapsular los estilos de la plantilla nueva

**Files:**
- Modify: `frontend/src/components/padron/vpad-styles.css`
- Modify: `frontend/src/components/padron/vpad-styles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('defines isolated volante lurigancho layout hooks', () => {
  const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

  expect(css).toContain('.vpad-sheet.volante-lurigancho');
  expect(css).toContain('.vpad-sheet-folio-top');
  expect(css).toContain('.vpad-volanteo-section-lurigancho');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/padron/vpad-styles.test.ts`

Expected: FAIL because the new variant-specific selectors do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```css
.vpad-sheet.volante-lurigancho .vpad-tbl {
    margin-top: 0;
}

.vpad-sheet.volante-lurigancho.is-followup {
    padding-top: 12mm;
}

.vpad-sheet-folio-top {
    position: absolute;
    top: 4mm;
    right: 8mm;
    font-size: 10px;
    font-weight: 700;
    color: #000;
}

.vpad-sheet.portrait .vpad-sheet-folio-top {
    right: 10mm;
    font-size: 9px;
}

.vpad-volanteo-section-lurigancho {
    margin-top: 8px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/padron/vpad-styles.test.ts`

Expected: PASS.

### Task 5: Verificacion enfocada y visual

**Files:**
- No new files.

- [ ] **Step 1: Run the focused padron test suite**

Run: `cd frontend && npx vitest run src/components/padron/data.test.ts src/components/padron/PreviewPage.test.tsx src/components/padron/PadronView.test.tsx src/components/padron/vpad-styles.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the frontend typecheck**

Run: `npm run typecheck:frontend`

Expected: PASS.

- [ ] **Step 3: Open the local app and verify the template visually**

Run the frontend dev server if needed, open `Generar Padrones`, select `volante lurigancho`, and confirm:

- page 1 keeps the full upper layout;
- page 2 keeps the full table but omits the upper layout;
- page numbers read `1 de N`, `2 de N` in the upper-right corner;
- each page shows only `Responsable del volanteo :`.

