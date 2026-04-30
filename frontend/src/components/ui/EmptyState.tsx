

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full py-12 animate-fade-in">
      {icon ? (
        <div className="w-16 h-16 rounded-2xl bg-dark-elevated flex items-center justify-center mb-5 border border-bdr-subtle">
          {icon}
        </div>
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-dark-elevated flex items-center justify-center mb-5 border border-bdr-subtle">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-txt-muted">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
      )}
      <p className="text-txt-primary font-semibold text-lg">{title}</p>
      {description && <p className="text-txt-muted text-sm mt-1.5 max-w-xs">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-5 py-2 rounded-btn text-sm font-medium bg-accent-orange text-white hover:bg-accent-orange-hover transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
