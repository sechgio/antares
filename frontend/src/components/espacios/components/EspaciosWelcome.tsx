import { motion } from 'framer-motion';
import { Plus, Sparkles, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import {
  MOTION_EASE,
  PreviewMockup,
  VIEWS,
  type PreviewView,
} from './espaciosWelcomePreviews';

interface EspaciosWelcomeProps {
  onCreateEspacio: () => void;
}

const STEPS = [
  {
    step: '01',
    title: 'Crea un espacio',
    description: 'Agrupa el trabajo de tu equipo por área, cliente o departamento.',
    color: 'var(--accent-primary)',
  },
  {
    step: '02',
    title: 'Añade proyectos',
    description: 'Dentro de cada espacio organiza iniciativas con objetivos claros.',
    color: 'var(--accent-secondary)',
  },
  {
    step: '03',
    title: 'Gestiona tareas',
    description: 'Asigna responsables, fechas y estados en la vista que prefieras.',
    color: 'var(--accent-blue)',
  },
] as const;

const PREVIEW_ROTATION: PreviewView[] = ['list', 'board', 'table', 'calendar', 'gantt'];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event: MediaQueryList | MediaQueryListEvent) => setReduced(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function fadeUp(delay: number, reducedMotion: boolean) {
  if (reducedMotion) return { initial: false as const };
  return {
    initial: { y: 12 },
    animate: { y: 0 },
    transition: { duration: 0.45, delay, ease: MOTION_EASE },
  };
}

export default function EspaciosWelcome({ onCreateEspacio }: EspaciosWelcomeProps) {
  const reducedMotion = useReducedMotion();
  const [activeView, setActiveView] = useState<PreviewView>('board');
  const [autoRotate, setAutoRotate] = useState(true);

  const handleViewChange = useCallback((view: PreviewView) => {
    setActiveView(view);
    setAutoRotate(false);
  }, []);

  useEffect(() => {
    if (reducedMotion || !autoRotate) return;
    const id = window.setInterval(() => {
      setActiveView((current) => {
        const idx = PREVIEW_ROTATION.indexOf(current);
        return PREVIEW_ROTATION[(idx + 1) % PREVIEW_ROTATION.length];
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [autoRotate, reducedMotion]);

  return (
    <div
      data-testid="espacios-welcome"
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="lg-aurora-blob lg-aurora-blob--indigo opacity-60" />
        <div className="lg-aurora-blob lg-aurora-blob--teal opacity-40" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(color-mix(in srgb, var(--border-medium) 40%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border-medium) 40%, transparent) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent)',
          }}
        />
      </div>

      <section className="relative border-b border-[var(--border-subtle)] px-6 py-10 lg:px-10 lg:py-16">
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <motion.div {...fadeUp(0, reducedMotion)} className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] px-3.5 py-1.5 text-xs font-medium text-[var(--accent-primary-hover)]">
              <Sparkles className="h-3.5 w-3.5" />
              Gestión de proyectos
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl font-semibold leading-[1.15] tracking-tight text-[var(--text-primary)] lg:text-4xl">
                Organiza tu trabajo
                <br />
                <span className="lg-shimmer-text">en espacios</span>
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[15px]">
                Los espacios agrupan proyectos y tareas de tu equipo. Crea el primero para empezar
                a planificar con listas, tableros, calendario y Gantt.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                onClick={onCreateEspacio}
                className="gap-2 shadow-[0_8px_32px_color-mix(in_srgb,var(--accent-primary)_40%,transparent)]"
              >
                <Plus className="h-4 w-4" />
                Crear primer espacio
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Zap className="h-3.5 w-3.5 text-[var(--accent-yellow)]" />
                Toma menos de 1 minuto
              </span>
            </div>
          </motion.div>

          <PreviewMockup
            activeView={activeView}
            onViewChange={handleViewChange}
            reducedMotion={reducedMotion}
          />
        </div>
      </section>

      <section className="relative px-6 py-10 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_1fr]">
          <motion.div {...fadeUp(0.2, reducedMotion)}>
            <h2 className="mb-6 text-sm font-semibold text-[var(--text-primary)]">Empieza en 3 pasos</h2>
            <div className="relative space-y-3">
              <div className="absolute bottom-4 left-[18px] top-4 hidden w-px bg-gradient-to-b from-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] via-[color:color-mix(in_srgb,var(--accent-secondary)_30%,transparent)] to-[color:color-mix(in_srgb,var(--accent-blue)_40%,transparent)] sm:block" />
              {STEPS.map((item, index) => (
                <motion.div
                  key={item.step}
                  {...fadeUp(0.25 + index * 0.08, reducedMotion)}
                  className="group relative flex gap-4 rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_80%,transparent)] p-4 backdrop-blur-sm transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]"
                >
                  <span
                    className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ring-1 ring-[var(--border-subtle)] transition-transform group-hover:scale-105"
                    style={{
                      background: `color-mix(in srgb, ${item.color} 18%, var(--bg-base))`,
                      color: item.color,
                    }}
                  >
                    {item.step}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h3 className="mb-1 text-sm font-medium text-[var(--text-primary)]">{item.title}</h3>
                    <p className="text-xs leading-relaxed text-[var(--text-muted)]">{item.description}</p>
                  </div>
                  {index === 0 && (
                    <Button variant="none" size="none"
                      onClick={onCreateEspacio}
                      className="shrink-0 self-center rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--accent-primary)] opacity-0 transition-opacity hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] group-hover:opacity-100"
                    >
                      Empezar →
                    </Button>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp(0.3, reducedMotion)}>
            <h2 className="mb-6 text-sm font-semibold text-[var(--text-primary)]">Vistas disponibles</h2>
            <div className="grid grid-cols-2 gap-3">
              {VIEWS.map((view) => {
                const isActive = activeView === view.id;
                return (
                  <Button variant="none" size="none"
                    key={view.id}
                    onClick={() => handleViewChange(view.id)}
                    className={`group flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                      isActive
                        ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                      style={{
                        background: `color-mix(in srgb, ${view.color} ${isActive ? 20 : 12}%, transparent)`,
                        color: view.color,
                      }}
                    >
                      <view.icon className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{view.label}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{view.description}</p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-medium text-[var(--accent-primary-hover)]">Vista activa en preview</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
