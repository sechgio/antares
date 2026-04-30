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
      <svg
        aria-label="COSMO logo"
        role="img"
        viewBox="0 0 40 40"
        className={`${activeSize.mark} shrink-0`}
        fill="none"
      >
        <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#hcMarkBg)" />
        <rect x="4" y="4" width="32" height="32" rx="9" fill="none" stroke="url(#hcMarkStroke)" strokeWidth="0.5" opacity="0.4" />
        {/* Water drop */}
        <path
          d="M20 7C20 7 11 19 11 24.5C11 29 15 33 20 33C25 33 29 29 29 24.5C29 19 20 7 20 7Z"
          fill="url(#hcDropGrad)"
          opacity="0.9"
        />
        {/* Drop highlight */}
        <path
          d="M17 22C17 18.5 20 12 20 12C20 12 18.5 18.5 18.5 22C18.5 24 16.5 24.5 17 22Z"
          fill="white"
          opacity="0.3"
        />
        {/* Arrow right */}
        <path d="M23.5 16.5L30 16.5L28.5 15M30 16.5L28.5 18" stroke="url(#hcArrowGrad)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Arrow left */}
        <path d="M16.5 23.5L10 23.5L11.5 25M10 23.5L11.5 22" stroke="url(#hcArrowGrad)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <defs>
          <linearGradient id="hcMarkBg" x1="4" y1="3" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5E6AD2" />
            <stop offset="1" stopColor="#1A1F3D" />
          </linearGradient>
          <linearGradient id="hcMarkStroke" x1="3" y1="2" x2="37" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8B93FF" />
            <stop offset="1" stopColor="#6EE7D8" />
          </linearGradient>
          <linearGradient id="hcDropGrad" x1="15" y1="8" x2="25" y2="33" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6EE7D8" />
            <stop offset="1" stopColor="#3BA8D8" />
          </linearGradient>
          <linearGradient id="hcArrowGrad" x1="10" y1="20" x2="30" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8B93FF" />
            <stop offset="1" stopColor="#6EE7D8" />
          </linearGradient>
        </defs>
      </svg>

      {showText && (
        <span className="min-w-0 leading-none">
          <span className={`block font-bold tracking-[0] text-white ${activeSize.word}`}>COSMO</span>
          {tagline && <span className={`mt-1 block truncate text-[#7C8494] ${activeSize.tagline}`}>{tagline}</span>}
        </span>
      )}
    </div>
  );
}
