import { useBackendStatus } from '../../hooks/useBackendStatus';

const STATE_LABELS: Record<string, string> = {
  unknown: 'Conectando...',
  idle: 'Iniciando...',
  starting: 'Iniciando...',
  exited: 'Reconectando...',
  fatal: 'Reconectando...',
};

export default function BackendStatusBar() {
  const { backendState, isRestarting } = useBackendStatus();

  if (backendState === 'ready') return null;

  const label = isRestarting ? 'Reconectando...' : (STATE_LABELS[backendState] ?? 'Conectando...');

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        color: '#fff',
        padding: '6px 14px',
        borderRadius: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        fontWeight: 500,
        backdropFilter: 'blur(4px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        transition: 'opacity 0.3s ease',
      }}
      title="El backend se está recuperando automáticamente"
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#fbbf24',
          animation: 'pulse 1.5s infinite',
        }}
      />
      <span>{label}</span>
    </div>
  );
}
