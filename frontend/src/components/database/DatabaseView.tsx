import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../../api';
import type { DBField, DBRecord } from '../../types';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Input from '../ui/Input';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';

function useDbError(addToast: (t: { message: string; type: 'error' }) => void) {
  return (action: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    addToast({ message: `Error ${action}: ${msg}`, type: 'error' });
  };
}

export default function DatabaseView() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [allFields, setAllFields] = useState<DBField[]>([]);
  const [newField, setNewField] = useState({ name: '', type: 'TEXT', required: false, unique: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSchema, setShowSchema] = useState(false);

  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) =>
      fields.some((f) => String(r[f] ?? '').toLowerCase().includes(q))
    );
  }, [records, fields, searchQuery]);

  const alertError = useDbError(addToast);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getRecords();
      setRecords(r.records);
      setFields(r.fields);
      const f = await api.getFields();
      setAllFields(f.fields);
    } catch (err) {
      alertError('refrescando datos', err);
    }
  }, [alertError]);

  useEffect(() => { refresh(); }, [refresh]);

  const importExcel = async () => {
    const d = await api.dialogFiles();
    if (!d.paths.length) return;
    try {
      await api.importExcel(d.paths[0]);
      await refresh();
    } catch (err) {
      alertError('importando Excel', err);
    }
  };

  const exportExcel = async () => {
    const d = await api.dialogSave();
    if (!d.paths.length) return;
    try {
      await api.exportExcel(d.paths[0]);
    } catch (err) {
      alertError('exportando Excel', err);
    }
  };

  const template = async () => {
    const d = await api.dialogSave();
    if (!d.paths.length) return;
    try {
      await api.generateTemplate(d.paths[0]);
    } catch (err) {
      alertError('generando plantilla', err);
    }
  };

  const addField = async () => {
    const name = newField.name.trim().toLowerCase();
    if (!name.match(/^[a-z_][a-z0-9_]*$/)) {
      addToast({ message: 'Nombre inválido. Use solo letras minúsculas, números y guiones bajos.', type: 'warning' });
      return;
    }
    if (allFields.some(f => f.name === name)) {
      addToast({ message: 'El campo ya existe', type: 'warning' });
      return;
    }
    try {
      const updated = [...allFields, { ...newField, name }];
      await api.updateFields(updated);
      setNewField({ name: '', type: 'TEXT', required: false, unique: false });
      await refresh();
      addToast({ message: 'Campo agregado correctamente', type: 'success' });
    } catch (err) {
      alertError('agregando campo', err);
    }
  };

  const removeField = async (name: string) => {
    if (allFields.length <= 1) {
      addToast({ message: 'Debe quedar al menos un campo', type: 'warning' });
      return;
    }
    const ok = await confirm({ title: 'Eliminar campo', description: `¿Eliminar campo '${name}'?`, type: 'destructive', confirmLabel: 'Eliminar' });
    if (!ok) return;
    try {
      const updated = allFields.filter((f) => f.name !== name);
      await api.updateFields(updated);
      await refresh();
      addToast({ message: 'Campo eliminado', type: 'success' });
    } catch (err) {
      alertError('eliminando campo', err);
    }
  };

  const resetFields = async () => {
    const ok = await confirm({ title: 'Restaurar campos', description: '¿Restaurar campos por defecto?' });
    if (!ok) return;
    try {
      await api.resetFields();
      await refresh();
      addToast({ message: 'Campos restaurados', type: 'success' });
    } catch (err) {
      alertError('restaurando campos', err);
    }
  };

  const clearDatabase = async () => {
    const ok = await confirm({ title: 'Limpiar base de datos', description: '¿Eliminar TODOS los registros? Esta acción no se puede deshacer.', type: 'destructive', confirmLabel: 'Eliminar todo' });
    if (!ok) return;
    try {
      const res = await api.clearDatabase();
      addToast({ message: `Se eliminaron ${res.cleared} registros.`, type: 'success' });
      await refresh();
    } catch (err) {
      alertError('limpiando base de datos', err);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="px-6 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Base de Datos</h2>
          <button
            onClick={() => setShowSchema(!showSchema)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${showSchema ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] border-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'}`}
          >
            {showSchema ? 'Ver registros' : 'Ver esquema'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh}>Refrescar</Button>
          <Button variant="ghost" size="sm" onClick={template}>Plantilla</Button>
          <Button variant="secondary" size="sm" onClick={importExcel}>Importar</Button>
          <Button variant="secondary" size="sm" onClick={exportExcel}>Exportar</Button>
          <Button variant="danger" size="sm" onClick={clearDatabase}>Limpiar</Button>
        </div>
      </div>

      {/* Search bar */}
      {!showSchema && (
        <div className="px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="relative max-w-md">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar registros..."
              className="w-full pl-9 pr-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-full text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {!showSchema ? (
          records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-sm text-[var(--text-muted)]">Sin registros. Importa un archivo Excel para comenzar.</p>
            </div>
          ) : (
            <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                    {fields.map((f) => (
                      <th key={f} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r, i) => (
                    <tr key={i} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors">
                      {fields.map((f) => (
                        <td key={f} className="px-4 py-3 text-sm text-[var(--text-primary)]">{String(r[f] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="space-y-6 max-w-4xl w-full">
            {/* Add field */}
            <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-4 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Nombre del campo</label>
                <Input value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} placeholder="ej. sku_producto" />
              </div>
              <div className="w-32">
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Tipo</label>
                <select
                  className="w-full bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm appearance-none cursor-pointer focus:border-[var(--accent-primary)] focus:outline-none"
                  value={newField.type}
                  onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                >
                  <option>TEXT</option>
                  <option>INTEGER</option>
                  <option>REAL</option>
                  <option>BLOB</option>
                </select>
              </div>
              <Button variant="primary" size="sm" onClick={addField}>Agregar</Button>
            </div>

            {/* Fields list */}
            <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Campo</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Tipo</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Requerido</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Único</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]"></th>
                  </tr>
                </thead>
                <tbody>
                  {allFields.map((f) => (
                    <tr key={f.name} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-3 text-sm text-[var(--text-primary)] font-medium">{f.name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)] font-mono">{f.type}</td>
                      <td className="px-4 py-3"><Badge variant={f.required ? 'success' : 'default'} className="text-[10px]">{f.required ? 'Sí' : 'No'}</Badge></td>
                      <td className="px-4 py-3"><Badge variant={f.unique ? 'success' : 'default'} className="text-[10px]">{f.unique ? 'Sí' : 'No'}</Badge></td>
                      <td className="px-4 py-3">
                        <button onClick={() => removeField(f.name)} className="text-[var(--text-muted)] hover:text-[var(--accent-red)] text-xs transition-colors">Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button variant="ghost" size="sm" onClick={resetFields}>Restaurar defaults</Button>
          </div>
        )}
      </div>
    </div>
  );
}
