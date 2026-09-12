export type ReportStatus = 'draft' | 'completed';
export type ReservoirType = 'ELEVADO' | 'ENTERRADO' | 'SEMIENTERRADO' | 'APOYADO' | 'CISTERNA';

export const RESERVOIR_TYPES: readonly ReservoirType[] = [
  'ELEVADO',
  'ENTERRADO',
  'SEMIENTERRADO',
  'APOYADO',
  'CISTERNA',
];
