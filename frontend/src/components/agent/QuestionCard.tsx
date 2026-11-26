import { useState } from 'react';
import { Check } from 'lucide-react';
import { z } from 'zod';
import { agentApi, type AgentQuestion, type AgentToolCall } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';

const questionItems = z.array(z.object({ id: z.string(), prompt: z.string() })).min(1).max(3);
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

type DraftAnswer = { kind: 'option' | 'text'; value: string };

export default function QuestionCard({ question, onAnswered }: { question: AgentQuestion; onAnswered: () => void }) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<Record<string, DraftAnswer>>({});
  const [busy, setBusy] = useState(false);
  const single = question.questions.length === 1;
  const answers = Object.fromEntries(Object.entries(draft).map(([id, answer]) => [id, answer.value]));
  const complete = (values: Record<string, string>) => question.questions.every(({ id }) => Object.prototype.hasOwnProperty.call(values, id) && values[id].trim());
  const setAnswer = (id: string, answer: DraftAnswer) => setDraft((current) => ({ ...current, [id]: answer }));
  const submit = async (values: Record<string, string>) => {
    if (busy || !complete(values)) return;
    setBusy(true);
    try {
      await agentApi.agentQuestionAnswer(question.session_id, question.id, values);
      onAnswered();
    } catch (err) {
      setBusy(false);
      addToast({ message: errorMessage(err, 'No se pudo guardar tu respuesta'), type: 'error' });
    }
  };
  return <form id={`agent-question-${question.id}`} aria-label="Pregunta del agente" aria-busy={busy}
    className="agent-question space-y-3.5" onSubmit={(event) => { event.preventDefault(); void submit(answers); }}>
      {question.questions.map((item) => {
        const answer = Object.prototype.hasOwnProperty.call(draft, item.id) ? draft[item.id] : undefined;
        const options = [...new Set(item.options?.filter((option) => option.trim()))];
        return <div key={item.id} className="space-y-2">
          <label htmlFor={`question-${question.id}-${item.id}`} className="block font-medium text-[var(--text-primary)]">{item.prompt}</label>
          {options.map((option) => <Button key={option} variant="none" size="none" disabled={busy}
            aria-pressed={single ? undefined : answer?.kind === 'option' && answer.value === option}
            onClick={() => single ? void submit({ [item.id]: option }) : setAnswer(item.id, { kind: 'option', value: option })}
            className="agent-question-option">{option}</Button>)}
          <input id={`question-${question.id}-${item.id}`} value={answer?.kind === 'text' ? answer.value : ''} disabled={busy} maxLength={12000}
            placeholder={options.length ? 'Otra respuesta…' : 'Escribe tu respuesta…'}
            onChange={(event) => setAnswer(item.id, { kind: 'text', value: event.target.value })}
            className="agent-panel__input" />
        </div>;
      })}
    <div className="flex justify-end">
      <Button type="submit" size="sm" disabled={busy || !complete(answers)}>{busy ? 'Enviando…' : 'Responder'}</Button>
    </div>
  </form>;
}
