

interface SkeletonProps {
  className?: string;
  count?: number;
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-card bg-dark-elevated border border-bdr-subtle overflow-hidden ${className}`}>
      <div className="aspect-[16/10] bg-dark-input" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-dark-input rounded w-3/4" />
        <div className="h-2.5 bg-dark-input rounded w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse h-3 bg-dark-elevated rounded ${className}`} />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-dark-elevated rounded ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export default function Skeleton({ className = '', count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`animate-pulse rounded-lg bg-dark-elevated ${className}`} />
      ))}
    </>
  );
}
