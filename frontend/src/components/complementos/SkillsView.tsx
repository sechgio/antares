import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Sparkles } from 'lucide-react';
import { agentApi, type AgentSkill } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';

export default function SkillsView() {
  const { addToast } = useToast();
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [library, setLibrary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await agentApi.agentSkillsList();
      setSkills(res.skills);
      setLibrary(res.library);
      setWarnings(res.warnings);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las habilidades'), type: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)) : skills;
  }, [skills, search]);

  return (
    <div className="custom-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-8 pb-12 pt-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">Habilidades</h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Instrucciones que el agente consulta para tareas especializadas. No otorgan permisos ni ejecutan scripts.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 focus-within:border-[var(--border-active)]">
              <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar habilidades"
                aria-label="Buscar habilidades"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="Actualizar habilidades"
              title="Actualizar"
              className="flex size-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : undefined} />
            </button>
          </div>
        </header>

        {loading ? (
          <p className="mt-12 text-center text-sm text-[var(--text-secondary)]">Cargando habilidades…</p>
        ) : (
          <>
            {visible.length > 0 && (
              <section aria-label="Habilidades disponibles" className="mt-8 grid grid-cols-1 gap-x-6 gap-y-0.5 lg:grid-cols-2">
                {visible.map((skill) => (
                  <div key={skill.id} className="flex items-start gap-3.5 rounded-xl px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-input)] text-[var(--text-secondary)]" aria-hidden>
                      <Sparkles size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium leading-5 text-[var(--text-primary)]">{skill.name}</span>
                      <span className="line-clamp-2 text-[12.5px] leading-5 text-[var(--text-secondary)]">{skill.description}</span>
                    </span>
                  </div>
                ))}
              </section>
            )}
            {!visible.length && (
              <div className="mt-12 text-center">
                <p className="text-sm text-[var(--text-secondary)]">
                  {skills.length ? `Sin resultados para «${search.trim()}».` : 'Todavía no hay habilidades instaladas.'}
                </p>
                {!skills.length && library && (
                  <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                    Añade una carpeta con un SKILL.md en <span className="font-mono">{library}</span>
                  </p>
                )}
              </div>
            )}
            {warnings.length > 0 && (
              <div role="note" aria-label="Habilidades omitidas" className="mt-10 border-t border-[var(--border-subtle)] px-3 pt-5">
                <p className="text-[12px] font-medium text-[var(--text-secondary)]">Omitidas por formato no válido</p>
                <ul className="mt-1.5 space-y-1">
                  {warnings.map((w) => (
                    <li key={w} className="truncate text-[12px] text-[var(--text-muted)]" title={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
