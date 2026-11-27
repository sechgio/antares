import { useState } from 'react';
import { ArrowRight, Check, MessageCircleQuestion } from 'lucide-react';
import { z } from 'zod';
import { agentApi, type AgentQuestion, type AgentToolCall } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';

const questionItems = z.array(z.object({ id: z.string(), prompt: z.string() })).min(1).max(3);

export function optionLabel(option: import('../../api/agentApi').AgentQuestionOption): string {
  return typeof option === 'string' ? option : option.label;
}

function optionDescription(option: import('../../api/agentApi').AgentQuestionOption): string | undefined {
  return typeof option === 'string' ? undefined : option.description;
}
const questionResult = z.object({ answers: z.record(z.string(), z.string()) });

export function answeredQuestion(call: AgentToolCall) {
  if (call.name !== 'ask_user' || call.status !== 'done' || !call.result) return null;
  const items = questionItems.safeParse(call.params.questions);
  if (!items.success) return null;
  try {
    const result = questionResult.safeParse(JSON.parse(call.result));
    if (!result.success) return null;
    const { answers } = result.data;
    if (items.data.some(({ id }) => !Object.prototype.hasOwnProperty.call(answers, id) || !answers[id].trim())) return null;
    return items.data.map(({ id, prompt }) => ({ id, prompt, answer: answers[id] }));
  } catch {
    return null;
  }
}

export function AnsweredQuestion({ items }: { items: NonNullable<ReturnType<typeof answeredQuestion>> }) {
  return <section aria-label="Pregunta respondida" className="agent-question space-y-3">
    {items.map(({ id, prompt, answer }) => <div key={id}>
      <p className="font-medium text-[var(--text-primary)]">{prompt}</p>
      <p className="mt-1 flex items-baseline gap-2 whitespace-pre-wrap text-[var(--text-secondary)]">
        <Check size={14} className="shrink-0 self-start mt-1" aria-hidden="true" />{answer}
      </p>
    </div>)}
  </section>;
}

type DraftAnswer = { kind: 'option'; selected: string[] } | { kind: 'text'; value: string };
const OPTION_SHORTCUTS = 'ABCDEFGHIJ';

export default function QuestionCard({ question, onAnswered }: { question: AgentQuestion; onAnswered: () => void }) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<Record<string, DraftAnswer>>({});
  const [sending, setSending] = useState<Record<string, string> | null>(null);
  const busy = sending !== null;
  const single = question.questions.length === 1;
  const answers = Object.fromEntries(Object.entries(draft).map(([id, answer]) => [id, answer.kind === 'text' ? answer.value : answer.selected.join('; ')]));
  const complete = (values: Record<string, string>) => question.questions.every(({ id }) => Object.prototype.hasOwnProperty.call(values, id) && values[id].trim());
  const setAnswer = (id: string, answer: DraftAnswer) => setDraft((current) => ({ ...current, [id]: answer }));
  const submit = async (values: Record<string, string>) => {
    if (busy || !complete(values)) return;
    setSending(values);
    try {
      await agentApi.agentQuestionAnswer(question.session_id, question.id, values);
      onAnswered();
    } catch (err) {
      setSending(null);
      addToast({ message: errorMessage(err, 'No se pudo guardar tu respuesta'), type: 'error' });
    }
  };
  const submitButton = <Button type="submit" size="sm" disabled={busy || !complete(answers)}
    className="shrink-0 disabled:text-[var(--text-secondary)] disabled:opacity-70">
    {busy ? 'Enviando…' : 'Responder'}
  </Button>;
  return <form id={`agent-question-${question.id}`} aria-label="Pregunta del agente" aria-busy={busy}
    className="agent-question agent-question--open" onSubmit={(event) => { event.preventDefault(); void submit(answers); }}>
      <MessageCircleQuestion size={16} className="agent-question__icon" aria-hidden="true" />
      <div className="min-w-0 space-y-4">
        {question.questions.map((item) => {
          const answer = Object.prototype.hasOwnProperty.call(draft, item.id) ? draft[item.id] : undefined;
          const multi = item.multiSelect === true;
          const rawOptions = [...new Map((item.options ?? []).filter((option) => optionLabel(option).trim())
            .map((option) => [optionLabel(option), option])).values()];
          const inputId = `question-${question.id}-${item.id}`;
          const choose = (option: string) => {
            if (multi) {
              const current = answer?.kind === 'option' ? answer.selected : [];
              const toggled = current.includes(option) ? current.filter((value) => value !== option) : [...current, option];
              const order = rawOptions.map((raw) => optionLabel(raw));
              setAnswer(item.id, { kind: 'option', selected: [...toggled].sort((a, b) => order.indexOf(a) - order.indexOf(b)) });
            } else if (single) void submit({ [item.id]: option });
            else setAnswer(item.id, { kind: 'option', selected: [option] });
          };
          return <fieldset key={item.id} className="min-w-0">
            {item.header && <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{item.header}</p>}
            <legend className="mb-2 font-semibold text-[var(--text-primary)]">
              <label htmlFor={inputId}>{item.prompt}</label>
            </legend>
            {rawOptions.length > 0 && <div className="mb-2 flex flex-col gap-1" onKeyDown={(event) => {
              if (busy || event.repeat || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
              const option = rawOptions[OPTION_SHORTCUTS.indexOf(event.key.toUpperCase())];
              if (option === undefined) return;
              event.preventDefault();
              choose(optionLabel(option));
            }}>
              {rawOptions.map((raw, index) => {
                const label = optionLabel(raw);
                const description = optionDescription(raw);
                const selected = answer?.kind === 'option' && answer.selected.includes(label);
                const shortcut = OPTION_SHORTCUTS[index];
                return <Button key={label} variant="none" size="none" disabled={busy}
                  aria-pressed={single && !multi ? undefined : selected}
                  aria-keyshortcuts={shortcut}
                  data-selected={selected || (single && !multi && sending?.[item.id] === label)}
                  onClick={() => choose(label)} className="agent-question-option">
                  {shortcut && <kbd aria-hidden="true" className="agent-panel__key">{shortcut}</kbd>}
                  <span className="min-w-0 flex-1">
                    {label}
                    {description && <span className="block text-[11px] font-normal text-[var(--text-muted)]">{description}</span>}
                  </span>
                  {single && !multi && <ArrowRight size={14} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />}
                  {selected && <Check size={14} className="shrink-0" aria-hidden="true" />}
                </Button>;
              })}
            </div>}
            <div className="flex items-center gap-2">
              <input id={inputId} value={answer?.kind === 'text' ? answer.value : ''} disabled={busy} maxLength={12000}
                placeholder={rawOptions.length ? 'Otra respuesta…' : 'Escribe tu respuesta…'}
                onChange={(event) => setAnswer(item.id, { kind: 'text', value: event.target.value })}
                className="agent-panel__input min-w-0 flex-1" />
              {single && !multi && submitButton}
            </div>
          </fieldset>;
        })}
        {(!single || question.questions.some((item) => item.multiSelect)) && <div className="flex justify-end">{submitButton}</div>}
      </div>
  </form>;
}
