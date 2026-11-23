const THINKING_PHRASES = ['Pensándolo bien', 'Dándole vueltas', 'Juntando las piezas'] as const;
const WORKING_PHRASES = [
  'Sacándolo adelante',
  'Avanzando',
  'Trabajando en ello',
  'Encargándose',
  'Avanzando poco a poco',
] as const;

export function heldPhrase(bank: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (Math.imul(hash, 33) + seed.charCodeAt(i)) >>> 0;
  return bank[hash % bank.length];
}

export function thinkingPhrase(seed: string): string {
  return heldPhrase(THINKING_PHRASES, seed);
}

export function workingPhrase(seed: string): string {
  return heldPhrase(WORKING_PHRASES, seed);
}

export function toolStatus(name: string): string | null {
  if (name === 'shell_output') return 'Esperando resultados';
  if (name === 'shell_run' || name.startsWith('shell_job')) return 'Ejecutando algunos comandos';
  if (name === 'fs_search' || name === 'sessions_search') return 'Investigando';
  if (name === 'fs_read' || name === 'fs_list' || name === 'skills_read' || name === 'skills_list')
    return 'Leyendo el archivo';
  if (name === 'fs_write' || name === 'fs_edit' || name === 'skill_create') return 'Tomando nota';
  if (name === 'web_read' || name === 'web_text' || name === 'web_screenshot') return 'Leyendo un poco';
  if (name.startsWith('web_')) return 'Navegando por páginas';
  if (
    name.startsWith('cua_') ||
    name === 'desktop_click' ||
    name === 'desktop_type' ||
    name === 'desktop_key' ||
    name === 'desktop_scroll'
  )
    return 'Haciendo clics';
  if (name.startsWith('desktop_')) return 'Trabajando en tu computadora';
  if (name === 'agent_message') return 'Enviando un mensaje';
  if (name === 'subagent_run' || name.startsWith('agent_')) return 'Consultando con otro agente';
  if (name === 'ask_user') return 'Necesita tu respuesta';
  return null;
}

export function activityText(tool?: string): string {
  if (tool) return toolStatus(tool) ?? 'Trabajando en ello';
  return 'Trabajando en ello';
}
