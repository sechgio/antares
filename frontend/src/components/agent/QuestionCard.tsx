import { useState } from 'react';
import { agentApi, type AgentQuestion } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function QuestionCard({ question, onAnswered }: { question: AgentQuestion; onAnswered: () => void }) {
  const { addToast } = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await agentApi.agentQuestionAnswer(question.session_id, question.id, answers);
      onAnswered();
    } catch (err) { addToast({ message: errorMessage(err, 'No se pudo guardar tu respuesta'), type: 'error' }); }
    finally { setBusy(false); }
  };
  return <form className="max-w-2xl space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="text-sm font-medium text-[var(--text-primary)]">Faltan datos para continuar</p>
    {question.questions.map((item) => <div key={item.id} className="space-y-2">
      <label htmlFor={`question-${question.id}-${item.id}`} className="text-xs text-[var(--text-primary)]">{item.prompt}</label>
      {item.options?.length ? <div className="flex flex-wrap gap-2">{item.options.map((option) => <Button key={option} type="button" size="sm"
        variant={answers[item.id] === option ? 'primary' : 'secondary'} disabled={busy}
        onClick={() => setAnswers((value) => ({ ...value, [item.id]: option }))}>{option}</Button>)}</div> : null}
      <Input id={`question-${question.id}-${item.id}`} value={answers[item.id] || ''} disabled={busy}
        onChange={(event) => setAnswers((value) => ({ ...value, [item.id]: event.target.value }))} />
    </div>)}
    <Button type="submit" size="sm" disabled={busy || question.questions.some((item) => !answers[item.id]?.trim())}>Responder y continuar</Button>
  </form>;
}
