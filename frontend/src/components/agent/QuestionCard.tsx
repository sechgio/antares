import { useState } from 'react';
import { Check, MessageCircleQuestion } from 'lucide-react';
import { agentApi, type AgentQuestion } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';

export default function QuestionCard({ question, onAnswered }: { question: AgentQuestion; onAnswered: () => void }) {
  const { addToast } = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const setAnswer = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));
  const submit = async () => {
    setBusy(true);
    try {
      await agentApi.agentQuestionAnswer(question.session_id, question.id, answers);
      onAnswered();
    } catch (err) { addToast({ message: errorMessage(err, 'No se pudo guardar tu respuesta'), type: 'error' }); }
    finally { setBusy(false); }
  };
  return <form className="max-w-2xl overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
      <MessageCircleQuestion size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
      <p className="text-[12px] font-medium text-[var(--text-primary)]">Faltan datos para continuar</p>
    </div>
    <div className="space-y-3 px-3 py-2.5">
      {question.questions.map((item) => {
        const answer = answers[item.id] || '';
        const options = item.options ?? [];
        const custom = options.includes(answer) ? '' : answer;
        return <div key={item.id} className="space-y-1.5">
          <label htmlFor={`question-${question.id}-${item.id}`} className="block text-[12px] leading-5 text-[var(--text-primary)]">{item.prompt}</label>
          {options.length ? <div className="space-y-0.5">{options.map((option, index) => {
            const selected = answer === option;
            return <button key={option} type="button" aria-pressed={selected} disabled={busy}
              onClick={() => setAnswer(item.id, option)}
              className={`flex w-full items-center gap-2.5 rounded-md border px-2 py-1 text-left text-[12px] transition-colors disabled:opacity-50 ${selected
                ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}>
              <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] tabular-nums ${selected
                ? 'bg-[var(--accent-primary)] text-[var(--bg-base)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>
                {selected ? <Check size={10} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">{option}</span>
            </button>;
          })}</div> : null}
          <input id={`question-${question.id}-${item.id}`} value={custom} disabled={busy}
            placeholder={options.length ? 'Otra respuesta…' : 'Escribe tu respuesta…'}
            onChange={(event) => setAnswer(item.id, event.target.value)}
            className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] disabled:opacity-50" />
        </div>;
      })}
    </div>
    <div className="flex justify-end border-t border-[var(--border-subtle)] px-3 py-2">
      <Button type="submit" size="sm" disabled={busy || question.questions.some((item) => !answers[item.id]?.trim())}>Responder y continuar</Button>
    </div>
  </form>;
}
