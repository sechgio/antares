import { useState } from 'react';
import { aiProvidersApi, type AiProviderSpec, type AiProviderStatus } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';

export function useProviderProbe() {
  const { addToast } = useToast();
  const [statuses, setStatuses] = useState<Record<string, AiProviderStatus | undefined>>({});
  const [probing, setProbing] = useState<string | null>(null);

  const probe = async (p: AiProviderSpec) => {
    setProbing(p.id);
    try {
      const res = await aiProvidersApi.aiProviderStatus(p.id);
      setStatuses((s) => ({ ...s, [p.id]: res.provider }));
      if (res.provider.reachable) {
        addToast({
          message: `${p.label} responde${res.provider.models_count != null ? ` · modelos: ${res.provider.models_count}` : ''}`,
          type: 'success',
        });
      } else {
        addToast({ message: `${p.label}: ${res.provider.error ?? 'sin respuesta'}`, type: 'error' });
      }
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo comprobar ${p.label}`), type: 'error' });
    } finally {
      setProbing(null);
    }
  };

  return { statuses, setStatuses, probing, probe };
}
