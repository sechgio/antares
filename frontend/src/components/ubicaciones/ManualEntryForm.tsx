import React from 'react';
import type { ManualData } from './ubicacionesTypes';

const inputClass =
  'bg-[var(--bg-input)] border border-[var(--border-medium)] rounded text-[11px] px-2 py-1 text-[var(--text-primary)] w-full outline-none focus:border-[var(--accent-primary)] transition-colors';
const labelClass = 'text-[9px] font-semibold text-[var(--text-muted)] uppercase';

interface ManualEntryFormProps {
  manualData: ManualData;
  onChange: (field: keyof ManualData, value: string) => void;
  lonInputRef: React.RefObject<HTMLInputElement | null>;
  geocodeEnabled: boolean;
}

export const ManualEntryForm: React.FC<ManualEntryFormProps> = ({ manualData, onChange, lonInputRef, geocodeEnabled }) => (
  <div className="flex flex-col gap-2 mt-1 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-1">
        <label className={labelClass}>{geocodeEnabled ? 'Latitud' : 'Latitud*'}</label>
        <input
          type="text"
          value={manualData.lat}
          onChange={(e) => onChange('lat', e.target.value)}
          className={inputClass}
          placeholder="-12.3456"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[9px] text-[var(--text-muted)] uppercase">
          {geocodeEnabled ? 'Longitud' : 'Longitud*'}
        </label>
        <input
          ref={lonInputRef}
          type="text"
          value={manualData.lon}
          onChange={(e) => onChange('lon', e.target.value)}
          className={inputClass}
          placeholder="-77.1234"
        />
      </div>
    </div>
    <div className="flex flex-col gap-1">
      <label className={labelClass}>Código</label>
      <input
        type="text"
        value={manualData.cod_componente}
        onChange={(e) => onChange('cod_componente', e.target.value)}
        className={inputClass}
        placeholder="Ej. UBI-001"
      />
    </div>
    <div className="flex flex-col gap-1">
      <label className={labelClass}>Dirección</label>
      <input
        type="text"
        value={manualData.direccion}
        onChange={(e) => onChange('direccion', e.target.value)}
        className={inputClass}
        placeholder="Ej. Av. Principal 123"
      />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-1">
        <label className={labelClass}>Localidad</label>
        <input
          type="text"
          value={manualData.localidad}
          onChange={(e) => onChange('localidad', e.target.value)}
          className={inputClass}
          placeholder="Urb. Los Pinos"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelClass}>Distrito</label>
        <input
          type="text"
          value={manualData.distrito}
          onChange={(e) => onChange('distrito', e.target.value)}
          className={inputClass}
          placeholder="San Isidro"
        />
      </div>
    </div>
  </div>
);
