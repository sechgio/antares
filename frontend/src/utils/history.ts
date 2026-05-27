import { api } from '../api';

export async function saveFeatureHistory(
  runType: string,
  label: string,
  details: Record<string, unknown>,
  count = 1,
): Promise<void> {
  try {
    await api.historySave({
      run_type: runType,
      files: [label],
      options: details,
      formato: label,
      patron: '',
      calidad: 0,
      resize: null,
      ok_count: count,
      err_count: 0,
    });
  } catch {
  }
}
