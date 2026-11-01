import { useState } from 'react';
import { ChevronDown, CircleArrowRight, CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import type { AgentPlan } from '../../api/agentApi';

const STATUS_LABEL: Record<AgentPlan['steps'][number]['status'], string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Hecho',
  failed: 'Fallido',
};

function PlanStepIcon({ status }: { status: AgentPlan['steps'][number]['status'] }) {
  if (status === 'done') return <CircleCheck size={14} className="text-[var(--text-muted)]" aria-hidden="true" />;
  if (status === 'failed') return <CircleX size={14} className="text-[var(--accent-red)]" aria-hidden="true" />;
  if (status === 'in_progress') return <CircleArrowRight size={14} className="text-[var(--text-primary)]" aria-hidden="true" />;
  return <CircleDashed size={14} className="text-[var(--text-muted)] opacity-70" aria-hidden="true" />;
}

function PlanProgress({ done, total }: { done: number; total: number }) {
  if (total > 0 && done === total) return <CircleCheck size={14} className="agent-plan-icon shrink-0 text-[var(--accent-green)]" data-animate aria-hidden="true" />;
  const length = 2 * Math.PI * 5;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="1.5" className="stroke-[var(--border-medium)]" />
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={length}
        strokeDashoffset={length * (1 - (total ? done / total : 0))} className="agent-plan-progress stroke-[var(--accent-green)]" />
    </svg>
  );
}

export function PlanCard({ plan, running }: { plan: AgentPlan; running: boolean }) {
  const [open, setOpen] = useState(true);
  const done = plan.steps.filter((step) => step.status === 'done').length;
  const failed = plan.steps.filter((step) => step.status === 'failed').length;
  const complete = plan.steps.length > 0 && done === plan.steps.length;
  return (
    <section aria-label="Plan del agente" className="agent-trace-in w-full rounded-xl bg-[color:color-mix(in_srgb,var(--text-primary)_4%,transparent)] text-[13px] leading-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <PlanProgress done={done} total={plan.steps.length} />
        <span className="shrink-0 font-medium text-[var(--text-primary)]">{complete ? 'Plan completado' : 'Plan'}</span>
        <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]" title={plan.goal}>{plan.goal}</span>
        {failed > 0 && <span className="shrink-0 text-[12px] text-[var(--accent-red)]">{failed} fallido{failed === 1 ? '' : 's'}</span>}
        <span className="shrink-0 tabular-nums text-[12px] text-[var(--text-muted)]" aria-label={`${done} de ${plan.steps.length} hechos${failed ? `, ${failed} fallidos` : ''}`}>{done}/{plan.steps.length}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="agent-subagent-body overflow-hidden" inert={!open} aria-hidden={!open}>
          <ol className="space-y-1 px-3 pb-2.5">
            {plan.steps.map((step, index) => (
              <li key={`${index}-${step.title}`} className="flex items-start gap-2">
                <span key={step.status} data-animate={running || undefined} className="agent-plan-icon flex h-5 shrink-0 items-center"><PlanStepIcon status={step.status} /></span>
                <span className="min-w-0">
                  <span className="sr-only">{STATUS_LABEL[step.status]}. </span>
                  <span data-done={step.status === 'done' || undefined} className={`agent-plan-title ${
                    step.status === 'in_progress' ? (running ? 'agent-shimmer' : 'text-[var(--text-primary)]')
                      : step.status === 'pending' ? 'text-[var(--text-muted)]'
                        : step.status === 'failed' ? 'text-[var(--accent-red)]'
                          : 'text-[var(--text-muted)]'
                  }`}>{step.title}</span>
                  {step.evidence && <span className="block text-[11.5px] leading-4 text-[var(--text-muted)]">{step.evidence}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
