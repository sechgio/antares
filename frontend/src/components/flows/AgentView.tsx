import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Loader2, Plus, Send, ShieldCheck, Trash2, X, Wrench } from 'lucide-react';
import { agentApi, type AgentApproval, type AgentMessage, type AgentSession } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';

const POLL_MS = 1500;

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  pending: 'pendiente',
  done: 'ejecutada',
  denied: 'rechazada',
};

function ToolCallRow({ call }: { call: { id: string; name: string; gated: boolean; status: string; result?: string | null } }) {
  return (
    <div className="mt-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Wrench size={11} className="shrink-0 text-[var(--text-secondary)]" />
        <code className="truncate font-mono text-[var(--text-primary)]">{call.name}</code>
        {call.gated && <ShieldCheck size={11} className="shrink-0 text-amber-400" />}
        <span className="ml-auto shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
          {CALL_STATUS_LABEL[call.status] ?? call.status}
        </span>
      </div>
      {call.status === 'done' && call.result && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-[var(--text-secondary)]">
            resultado
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] text-[var(--text-secondary)]">
            {call.result}
          </pre>
        </details>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  if (msg.role === 'tool_result') return null; // ya se muestra dentro de la llamada
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
            : 'border border-[var(--border-medium)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
        }`}
      >
        {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
        {(msg.tool_calls ?? []).map((c) => (
          <ToolCallRow key={c.id} call={c} />
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: AgentApproval;
  busy: boolean;
  onDecide: (id: string, ok: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-amber-400/40 bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
        <ShieldCheck size={14} className="text-amber-400" />
        El agente quiere ejecutar una acción
      </div>
      <code className="mt-1.5 block truncate font-mono text-[11px] text-[var(--text-primary)]">
        {approval.method}
      </code>
      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg-base)] p-2 text-[10px] text-[var(--text-secondary)]">
        {JSON.stringify(approval.params, null, 2)}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>
          <Check size={13} className="mr-1" />
          Aprobar
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(approval.id, false)}>
          <X size={13} className="mr-1" />
          Rechazar
        </Button>
      </div>
    </div>
  );
}

export default function AgentView() {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<AgentApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [deciding, setDeciding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(
    async (id: string, silent = true) => {
      try {
        const res = await agentApi.agentMessagesList(id);
        setMessages(res.messages);
        setPending(res.pending_approvals);
        setRunning(res.running);
      } catch (err) {
        if (!silent) {
          addToast({ message: errorMessage(err, 'No se pudieron cargar los mensajes'), type: 'error' });
        }
      }
    },
    [addToast],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const res = await agentApi.agentSessionsList();
      setSessions(res.sessions);
      return res.sessions;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las conversaciones'), type: 'error' });
      return [];
    }
  }, [addToast]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await aiProvidersApi.aiProvidersList();
        setProviders(res.providers);
        const ready = res.providers.find((p) => p.configured && !p.needs_key) ?? res.providers.find((p) => p.has_key);
        if (ready) {
          setProvider(ready.id);
          setModel(ready.default_model);
        }
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudieron cargar los proveedores'), type: 'error' });
      }
      await refreshSessions();
    })();
  }, [addToast, refreshSessions]);

  useEffect(() => {
    if (sessionId) void loadMessages(sessionId, false);
    else {
      setMessages([]);
      setPending([]);
      setRunning(false);
    }
  }, [sessionId, loadMessages]);

  useEffect(() => {
    const active = Boolean(sessionId) && (running || pending.length > 0);
    if (active && timerRef.current == null) {
      timerRef.current = window.setInterval(() => {
        void loadMessages(sessionId);
      }, POLL_MS);
    }
    if (!active && timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId, running, pending.length, loadMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending.length]);

  const newSession = async () => {
    if (!provider) {
      addToast({ message: 'Elige un proveedor IA', type: 'error' });
      return;
    }
    try {
      const res = await agentApi.agentSessionCreate({ provider, model: model || undefined });
      await refreshSessions();
      setSessionId(res.session.id);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo crear la conversación'), type: 'error' });
    }
  };

  const removeSession = async (id: string) => {
    try {
      await agentApi.agentSessionDelete(id);
      if (sessionId === id) setSessionId('');
      await refreshSessions();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo eliminar la conversación'), type: 'error' });
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !sessionId || running) return;
    setDraft('');
    setRunning(true);
    try {
      await agentApi.agentMessageSend(sessionId, content);
      await loadMessages(sessionId);
    } catch (err) {
      setRunning(false);
      addToast({ message: errorMessage(err, 'No se pudo enviar el mensaje'), type: 'error' });
    }
  };

  const decide = async (id: string, ok: boolean) => {
    setDeciding(true);
    try {
      if (ok) await agentApi.agentApprove(id);
      else await agentApi.agentDeny(id);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo aplicar la decisión'), type: 'error' });
    } finally {
      setDeciding(false);
    }
  };

  const readyProviders = providers.filter((p) => p.configured && (!p.needs_key || p.has_key));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-medium)] px-5 py-3">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--text-secondary)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Agente</h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Conversa con la app. Las acciones con efectos piden tu aprobación.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <ThemedSelect
              value={provider}
              onChange={(v) => {
                setProvider(v);
                const p = providers.find((x) => x.id === v);
                if (p?.default_model) setModel(p.default_model);
              }}
              options={providers.map((p) => ({ value: p.id, label: p.label }))}
              aria-label="Proveedor IA"
              placeholder="Proveedor…"
            />
          </div>
          <div className="w-40">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="modelo"
              spellCheck={false}
              aria-label="Modelo"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => void newSession()}>
            <Plus size={13} className="mr-1" />
            Nueva
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-[var(--border-medium)] p-2">
          {sessions.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-[var(--text-secondary)]">
              Sin conversaciones. Crea una con «Nueva».
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-[12px] ${
                s.id === sessionId
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)]'
              }`}
            >
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => setSessionId(s.id)}>
                {s.title || s.id}
                <span className="block truncate text-[10px] opacity-70">
                  {s.provider} · {s.model}
                </span>
              </button>
              <button
                className="invisible shrink-0 text-[var(--text-secondary)] hover:text-[var(--accent-red,#ef4444)] group-hover:visible"
                onClick={() => void removeSession(s.id)}
                aria-label="Eliminar conversación"
                title="Eliminar"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {!sessionId ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Bot size={28} className="text-[var(--text-secondary)]" />
                <p className="max-w-sm text-sm text-[var(--text-secondary)]">
                  {readyProviders.length === 0
                    ? 'Configura un proveedor en «Proveedores IA» para empezar.'
                    : 'Elige proveedor y modelo, y pulsa «Nueva» para abrir una conversación.'}
                </p>
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-sm text-[var(--text-secondary)]">
                Escribe tu primer mensaje — el agente puede consultar el estado de la app.
              </p>
            ) : (
              messages.map((m, i) => <MessageBubble key={`${m.ts}-${i}`} msg={m} />)
            )}
            {running && (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <Loader2 size={12} className="animate-spin" />
                El agente está trabajando…
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border-medium)] p-3">
            {pending.length > 0 && (
              <div className="mb-3 space-y-2">
                {pending.map((a) => (
                  <ApprovalCard key={a.id} approval={a} busy={deciding} onDecide={(id, ok) => void decide(id, ok)} />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={sessionId ? 'Escribe un mensaje…' : 'Crea una conversación primero'}
                disabled={!sessionId || running}
                aria-label="Mensaje para el agente"
              />
              <Button
                size="sm"
                onClick={() => void send()}
                disabled={!sessionId || running || !draft.trim()}
                aria-label="Enviar"
              >
                <Send size={13} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
