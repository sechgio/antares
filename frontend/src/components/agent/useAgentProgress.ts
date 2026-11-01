import { useEffect, useState } from 'react';
import { agentApi } from '../../api/agentApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { mergeAgentProgress, parseAgentProgress, type AgentProgressItem } from './AgentProgress';

function terminal(item: AgentProgressItem, status: string, detail: string): AgentProgressItem {
  return { ...item, event: 'finish', status, detail, cancellable: false };
}

export function useAgentProgress(
  sessionId: string,
  reload: (id: string) => Promise<void>,
  onError: (message: string) => void,
) {
  const [items, setItems] = useState<AgentProgressItem[]>([]);
  const [cancelling, setCancelling] = useState('');

  useEffect(() => {
    setItems([]);
    setCancelling('');
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return onNotify((method, params) => {
      if (method !== 'agent.progress') return;
      const item = parseAgentProgress(sessionId, params);
      if (item) setItems((current) => mergeAgentProgress(current, item));
    });
  }, [sessionId]);

  const finish = (key: string, status: string, detail: string) => {
    setItems((current) => current.map((item) => item.key === key ? terminal(item, status, detail) : item));
  };

  const cancel = async (item: AgentProgressItem) => {
    if (!sessionId) return;
    setCancelling(item.key);
    try {
      if (item.source === 'shell_job') {
        const result = await agentApi.agentShellJobCancel(sessionId, item.id);
        if (result.cancelled) finish(item.key, 'cancelled', 'Cancelado');
        else finish(item.key, result.status || 'finalizado', 'La ejecución ya había terminado');
      } else {
        const result = await agentApi.agentDispatchCancel(sessionId, item.id);
        if (result.cancelled) finish(item.key, 'cancelled', 'Cancelado');
        else finish(item.key, 'finalizado', 'La ejecución ya había terminado');
      }
      await reload(sessionId);
    } catch (err) {
      onError(errorMessage(err, 'No se pudo cancelar el progreso'));
    } finally {
      setCancelling('');
    }
  };

  return { items, cancelling, cancel };
}
