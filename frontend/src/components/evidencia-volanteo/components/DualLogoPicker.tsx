import { useCallback, useRef } from 'react';
import { ImagePlus, X, Briefcase } from 'lucide-react';
import { ACCEPTED_IMAGE_EXTENSIONS, ACCEPTED_IMAGE_TYPES } from '../constants';
import type { LogoAsset } from '../types';

interface Props {
  logoLeft: LogoAsset | null;
  logoRight: LogoAsset | null;
  onLogoChange: (side: 'left' | 'right', file: File | null) => string | null;
  errorMessage?: string | null;
}

function LogoSlot({
  label,
  logo,
  onSelect,
  onRemove,
}: {
  label: string;
  logo: LogoAsset | null;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <span className="text-[10px] font-medium text-[var(--text-muted)] pl-1">{label}</span>
      <div
        role="button"
        tabIndex={0}
        aria-label={logo ? `Cambiar ${label}` : `Añadir ${label}`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`group cursor-pointer rounded-md border flex flex-col items-center justify-center transition-all overflow-hidden relative ${
          logo
            ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
            : 'border-transparent bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)]/30'
        }`}
        style={{ aspectRatio: '2/1' }}
      >
        {logo ? (
          <>
            <img src={logo.objectUrl} alt="" className="w-full h-full object-contain p-2" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 60%, transparent)' }}>
               <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="p-1.5 rounded-full bg-[var(--text-primary)]/10 text-[var(--text-primary)] hover:bg-[var(--accent-red)] hover:text-[var(--text-on-accent)] transition-colors"
                  aria-label={`Quitar ${label}`}
               >
                 <X size={14} />
               </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">
            <ImagePlus size={16} />
            <span className="text-[9px] font-medium">Añadir logo</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DualLogoPicker({ logoLeft, logoRight, onLogoChange, errorMessage }: Props) {
  const leftRef = useRef<HTMLInputElement>(null);
  const rightRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((side: 'left' | 'right', file: File | null) => {
    onLogoChange(side, file);
  }, [onLogoChange]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
        <Briefcase size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Logotipos Institucionales</span>
      </div>
      
      <div className="flex gap-3">
        <LogoSlot
          label="Izquierdo (Principal)"
          logo={logoLeft}
          onSelect={() => { leftRef.current!.value = ''; leftRef.current!.click(); }}
          onRemove={() => handleFile('left', null)}
        />
        <LogoSlot
          label="Derecho (Secundario)"
          logo={logoRight}
          onSelect={() => { rightRef.current!.value = ''; rightRef.current!.click(); }}
          onRemove={() => handleFile('right', null)}
        />
      </div>
      <input
        ref={leftRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(',')}
        className="hidden"
        onChange={(e) => handleFile('left', e.target.files?.[0] ?? null)}
      />
      <input
        ref={rightRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(',')}
        className="hidden"
        onChange={(e) => handleFile('right', e.target.files?.[0] ?? null)}
      />
      {errorMessage && (
        <div className="px-2 py-1.5 rounded-md bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20">
           <p role="alert" className="text-[10px] text-[var(--accent-red)] font-medium">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
