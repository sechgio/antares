import { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, CheckCircle2, X, Download } from 'lucide-react';
import { api } from '../../../api';
import { MSG_ONLY_XLSX } from '../constants';
import type { ExcelSource } from '../types';
import { useToast } from '../../../hooks/useToast';

interface Props {
  source: ExcelSource | null;
  onSource: (src: ExcelSource | null) => void;
}

export default function ExcelImporter({ source, onSource }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError(MSG_ONLY_XLSX);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await api.panelAvisoCorteParseExcel({ xlsx_b64: b64, filename: file.name });
      onSource({
        filename: file.name,
        columns: resp.columns,
        normalizedColumns: resp.normalizedColumns,
        rows: resp.rows,
        warnings: resp.warnings,
      });
    } catch (e: any) {
      setError(e?.message || 'Error al importar Excel');
      onSource(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {source ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
          <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs font-medium text-[var(--text-primary)] truncate">{source.filename}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{source.rows.length} filas · {source.columns.length} columnas</span>
          </div>
          <button onClick={() => onSource(null)} className="p-1 rounded hover:bg-[var(--bg-elevated)] transition-colors">
            <X size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 hover:border-[var(--accent-primary)]/50 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={15} className="text-[var(--accent-primary)] animate-spin" />
          ) : (
            <FileSpreadsheet size={15} className="text-[var(--text-muted)]" />
          )}
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {loading ? 'Leyendo...' : 'Importar Excel (.xlsx)'}
          </span>
        </button>
      )}
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      {error && <span className="text-[11px] text-red-500 px-1">{error}</span>}
      {source && source.columns.length > 0 && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {source.columns.map((col) => (
            <span key={col} className="px-2 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">{col}</span>
          ))}
        </div>
      )}
      
      {!source && (
        <button
          onClick={async () => {
            try {
              const res = await api.dialogSave({
                title: 'Guardar plantilla Excel',
                defaultPath: 'AVISO_DE_CORTE_TEMPLATE.xlsx',
                filters: [{ name: 'Excel', extensions: ['xlsx'] }],
              });
              if (res.paths && res.paths.length > 0) {
                await api.panelAvisoCorteTemplate({ path: res.paths[0] });
                addToast({ message: 'Plantilla de Excel guardada', type: 'success' });
              }
            } catch (err: any) {
              setError(err?.message || 'Error al descargar la plantilla');
            }
          }}
          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 transition-colors"
        >
          <Download size={14} className="shrink-0" />
          <span>Descargar plantilla de ejemplo</span>
        </button>
      )}
    </div>
  );
}
