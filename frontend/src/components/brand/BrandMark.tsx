interface BrandMarkProps {
  showText?: boolean;
  tagline?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const sizes = {
  sm: {
    mark: 'h-7 w-7',
    word: 'text-[13px]',
    tagline: 'text-[10px]',
  },
  md: {
    mark: 'h-9 w-9',
    word: 'text-[15px]',
    tagline: 'text-[11px]',
  },
};

export default function BrandMark({
  showText = false,
  tagline,
  size = 'sm',
  className = '',
}: BrandMarkProps) {
  const activeSize = sizes[size];

  return (
    <div className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      <div className={`${activeSize.mark} shrink-0 relative flex items-center justify-center`}>
        <img
          src="/logo-light.svg"
          alt="ANTARES logo"
          className="absolute inset-0 w-full h-full object-contain"
          style={{ display: 'var(--display-light-logo, none)' }}
        />
        <img
          src="/logo-dark.svg"
          alt="ANTARES logo"
          className="absolute inset-0 w-full h-full object-contain"
          style={{ display: 'var(--display-dark-logo, block)' }}
        />
      </div>

      {showText && (
        <span className="min-w-0 leading-none">
          <span className={`block font-bold tracking-[0] text-[var(--text-primary)] ${activeSize.word}`}>ANTARES</span>
          {tagline && <span className={`mt-1 block truncate text-[var(--text-secondary)] ${activeSize.tagline}`}>{tagline}</span>}
        </span>
      )}
    </div>
  );
}
