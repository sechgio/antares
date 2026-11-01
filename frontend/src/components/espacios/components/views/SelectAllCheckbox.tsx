/**
 * Checkbox maestro de selección de tareas, compartido por las cabeceras tabla y
 * virtualizadas de ListView y TableView.
 */
export default function SelectAllCheckbox({
  allSelected,
  someSelected,
  onToggleSelectAll,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll?: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected && !allSelected;
      }}
      onChange={() => onToggleSelectAll?.()}
      aria-label="Seleccionar todas las tareas"
      className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
    />
  );
}
