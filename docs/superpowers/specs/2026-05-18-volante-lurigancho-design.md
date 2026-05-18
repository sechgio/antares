# Volante Lurigancho Design

## Goal

Add a new padron output template named `volante lurigancho` without changing the behavior of the existing `Plantilla actual` or `Aviso corte de agua` templates.

The new template should visually follow the provided reference:

- Page 1 uses the full current padron layout with logos, title, metadata, affected-localities sections, notes, and the full table.
- Page 2 onward keep the full table columns but do not repeat the upper header/content block.
- Every page shows only `Responsable del volanteo :`.
- Page numbering is rendered as `X de Y`, positioned in the upper-right corner.
- Both horizontal and vertical orientations remain available.

## Recommended Approach

Extend the existing padron rendering flow with an explicit new output variant instead of creating a duplicated page component.

This keeps the new template close to the current padron behavior, reuses the same Excel import and row data model, and limits the change surface to variant-specific rendering rules and styles.

## User-Facing Behavior

### Output Selection

`GENERAR PADRONES` gains a new output option:

- `Plantilla actual`
- `volante lurigancho`
- `Aviso corte de agua`

`Plantilla actual` remains the default.

### Page Layout

For `volante lurigancho`:

- First page:
  - full upper layout identical in structure to the current padron template;
  - full table with normal columns;
  - page counter in the upper-right corner as `1 de N`;
  - `Responsable del volanteo :` shown near the lower content area.
- Following pages:
  - no repeated upper header/content block;
  - full table with the same columns as the current padron;
  - page counter in the upper-right corner as `X de N`;
  - `Responsable del volanteo :` shown on each page.

The current padron template continues to show its existing footer counter and its current last-page volanteo section.

## Technical Design

### Data Model

- Extend `OutputFormat` with `volante-lurigancho`.
- Add a matching output option labeled `volante lurigancho`.
- Reuse the current padron item structure and header data. No new Excel schema is needed.

### Rendering

- `PadronView` continues to use the existing padron import flow and page chunking for both `service-interruption` and `volante-lurigancho`.
- `PreviewPage` receives:
  - a `variant` indicating current template behavior;
  - enough page context to know whether it is the first page.
- `PreviewPage` applies variant-specific rules:
  - render the upper document block only on the first `volante-lurigancho` page;
  - render `Responsable del volanteo :` on every `volante-lurigancho` page;
  - render the page number as `X de Y` in the top-right only for `volante-lurigancho`;
  - preserve current behavior for `service-interruption`.

### Styling

- Add CSS classes scoped to the `volante-lurigancho` variant.
- Keep current shared table styles where possible.
- Add dedicated positioning for:
  - upper-right page numbering;
  - repeated volanteo line;
  - compact follow-up pages that omit the upper document block.

No existing generic styles should be changed in a way that alters the other templates.

## Error Handling and Compatibility

- Excel import should continue to behave like the current padron template because the field model is unchanged.
- Orientation switching should keep using the same current row-count logic for horizontal and vertical padron pages.
- PDF generation should keep using the same export pipeline and page batching already used by the current padron template.

## Testing

Add or extend tests to cover:

1. `volante lurigancho` is available as an output option while `Plantilla actual` remains the default.
2. The first `volante-lurigancho` page renders the full upper layout.
3. A later `volante-lurigancho` page omits that upper layout but keeps the full table headers.
4. `volante-lurigancho` shows `X de Y` and does not show `Página X de Y`.
5. `Responsable del volanteo :` appears on each `volante-lurigancho` page.
6. Existing service-interruption behavior remains unchanged.

## Out of Scope

- Changing the Excel schema.
- Redesigning `Aviso corte de agua`.
- Refactoring all templates into a generalized layout engine.
