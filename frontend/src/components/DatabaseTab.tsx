import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api';
import type { DBField, DBRecord } from '../types';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { useToast } from '../hooks/useToast';
import { useDialog } from '../hooks/useDialog';
import EmptyState from './ui/EmptyState';

function useDbError(addToast: (t: { message: string; type: 'error' }) => void) {
  return (action: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    addToast({ message: `Error ${action}: ${msg}`, type: 'error' });
  };
}

export default function DatabaseTab() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [records, setRecords] = useState<DBRecord[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [allFields, setAllFields] = useState<DBField[]>([]);
  const [newField, setNewField] = useState({ name: '', type: 'TEXT', required: false, unique: false });
  const [activeSection, setActiveSection] = useState<'records' | 'schema'>('records');
  const [searchQuery, setSearchQuery] = useState('');

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
      addToast({ message: 'Nombre inválido. Use solo letras minúsculas, números y guiones bajos. Debe empezar con letra o guion bajo.', type: 'warning' });
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
    const ok = await confirm({ title: 'Limpiar base de datos', description: '¿Eliminar TODOS los registros de la base de datos? Esta acción no se puede deshacer.', type: 'destructive', confirmLabel: 'Eliminar todo' });
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
    <div className="flex flex-col h-full w-full bg-dark-base">
      {/* Top tab bar with action buttons */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-bdr-subtle bg-dark-surface shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection('records')}
            className={`px-4 py-2 rounded-btn text-sm font-semibold transition-all duration-200 ${
              activeSection === 'records'
                ? 'bg-accent text-white'
                : 'bg-dark-elevated text-txt-secondary hover:text-txt-primary'
            }`}
          >
            Registros
          </button>
          <button
            onClick={() => setActiveSection('schema')}
            className={`px-4 py-2 rounded-btn text-sm font-semibold transition-all duration-200 ${
              activeSection === 'schema'
                ? 'bg-accent text-white'
                : 'bg-dark-elevated text-txt-secondary hover:text-txt-primary'
            }`}
          >
            Esquema
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-txt-secondary hover:text-txt-primary" onClick={refresh}>Refrescar</Button>
          <Button variant="ghost" className="text-txt-secondary hover:text-txt-primary" onClick={template}>Plantilla</Button>
          <Button variant="secondary" onClick={importExcel}>Importar</Button>
          <Button variant="secondary" onClick={exportExcel}>Exportar</Button>
          <Button variant="danger" onClick={clearDatabase}>Limpiar</Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 p-6 overflow-hidden">
        {activeSection === 'records' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-txt-muted text-xs uppercase tracking-wider mb-1">Visor de datos</p>
                <h3 className="text-xl font-semibold text-txt-primary">
                  {filteredRecords.length}{searchQuery ? ' de ' + records.length : ''} registros
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar en todos los campos..."
                    className="w-64 pl-9 pr-3 py-2 bg-dark-input border border-bdr-medium rounded-btn text-sm text-txt-primary placeholder:text-txt-muted focus:border-accent focus:outline-none"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-txt-muted hover:text-txt-primary">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 bg-dark-surface rounded-lg border border-bdr-subtle flex flex-col overflow-hidden">
              {records.length === 0 ? (
                <EmptyState
                  icon={
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-txt-muted">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  }
                  title="Sin registros"
                  description="Importa un archivo Excel para comenzar"
                  action={{ label: 'Importar Excel', onClick: importExcel }}
                />
              ) : filteredRecords.length === 0 ? (
                <EmptyState
                  title="Sin coincidencias"
                  description={`No se encontraron resultados para "${searchQuery}"`}
                  action={{ label: 'Limpiar búsqueda', onClick: () => setSearchQuery('') }}
                />
              ) : (
                <div className="flex-1 flex flex-col">
                  <div className="px-4 py-2.5 bg-dark-elevated border-b border-bdr-subtle flex items-center gap-3 shrink-0">
                    {fields.map((f) => (
                      <span key={f} className="text-[11px] font-bold uppercase tracking-wider text-txt-muted flex-1 min-w-0 truncate">{f}</span>
                    ))}
                  </div>
                  <div className="flex-1 p-2 overflow-y-auto">
                    <div className="grid gap-1">
                      {filteredRecords.map((r, i) => (
                        <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] transition-colors border ${i % 2 === 0 ? 'bg-dark-elevated/50 border-bdr-subtle/50' : 'bg-transparent border-transparent hover:border-bdr-subtle/50 hover:bg-dark-elevated/30'}`}>
                          {fields.map((f) => (
                            <span key={f} className="flex-1 min-w-0 truncate text-txt-secondary">{String(r[f] ?? '')}</span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'schema' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-txt-muted text-xs uppercase tracking-wider mb-1">Esquema</p>
                <h3 className="text-xl font-semibold text-txt-primary">Configurar campos</h3>
              </div>
              <Button variant="ghost" className="text-txt-secondary hover:text-txt-primary border border-bdr-subtle" onClick={resetFields}>Restaurar defaults</Button>
            </div>

            {/* New field form */}
            <div className="bg-dark-surface rounded-lg border border-bdr-subtle p-4 mb-4 flex items-end gap-4 shrink-0">
              <div className="flex-1">
                <label className="block text-xs font-medium text-txt-secondary mb-1.5">Nombre del campo</label>
                <input className="w-full bg-dark-input border border-bdr-medium rounded-btn px-3 py-2 text-sm text-txt-primary placeholder-txt-muted focus:outline-none focus:border-accent" value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} placeholder="ej. sku_producto" />
              </div>
              <div className="w-36">
                <label className="block text-xs font-medium text-txt-secondary mb-1.5">Tipo de dato</label>
                <select className="w-full bg-dark-input border border-bdr-medium rounded-btn px-3 py-2 text-sm text-txt-primary appearance-none cursor-pointer focus:outline-none focus:border-accent" value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value })}>
                  <option className="bg-dark-input">TEXT</option>
                  <option className="bg-dark-input">INTEGER</option>
                  <option className="bg-dark-input">REAL</option>
                  <option className="bg-dark-input">BLOB</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-txt-secondary cursor-pointer select-none pb-2">
                <input type="checkbox" className="w-4 h-4 rounded border-bdr-medium bg-dark-input accent-accent" checked={newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} />
                Requerido
              </label>
              <label className="flex items-center gap-2 text-sm text-txt-secondary cursor-pointer select-none pb-2">
                <input type="checkbox" className="w-4 h-4 rounded border-bdr-medium bg-dark-input accent-accent" checked={newField.unique} onChange={(e) => setNewField({ ...newField, unique: e.target.checked })} />
                Único
              </label>
              <Button variant="primary" className="mb-0.5" onClick={addField}>Agregar Campo</Button>
            </div>

            {/* Fields list */}
            <div className="flex-1 bg-dark-surface rounded-lg border border-bdr-subtle flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 bg-dark-elevated border-b border-bdr-subtle flex items-center gap-3 shrink-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-txt-muted flex-1">Campo</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-txt-muted w-28">Tipo</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-txt-muted w-24 text-center">Requerido</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-txt-muted w-24 text-center">Único</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-txt-muted w-20 text-center">Acción</span>
              </div>
              <div className="flex-1 p-2 overflow-y-auto">
                <div className="space-y-1">
                  {allFields.map((f, i) => (
                    <div key={f.name} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-[14px] transition-colors border ${i % 2 === 0 ? 'bg-dark-elevated/50 border-bdr-subtle/50' : 'bg-transparent border-transparent hover:border-bdr-subtle/50 hover:bg-dark-elevated/30'}`}>
                      <span className="flex-1 text-txt-primary font-medium">{f.name}</span>
                      <span className="w-28 text-txt-muted font-mono bg-dark-input px-2 py-1 rounded text-xs text-center">{f.type}</span>
                      <span className="w-24 flex justify-center"><Badge variant={f.required ? 'success' : 'default'}>{f.required ? 'Sí' : 'No'}</Badge></span>
                      <span className="w-24 flex justify-center"><Badge variant={f.unique ? 'success' : 'default'}>{f.unique ? 'Sí' : 'No'}</Badge></span>
                      <span className="w-20 flex justify-center">
                        <button className="text-txt-muted hover:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors" onClick={() => removeField(f.name)}>Eliminar</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
