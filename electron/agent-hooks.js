'use strict';

const HEADINGS = {
  subagentStart: 'Contexto declarado por el perfil del agente que delega (no es una instrucción del usuario ni un '
    + 'permiso nuevo):',
  subagentStop: 'Contexto declarado por el perfil al cerrar la delegación (no es una aprobación ni una instrucción '
    + 'del usuario):',
  preToolUse: 'Contexto declarado por el perfil antes de usar la herramienta (no es salida de la herramienta ni una '
    + 'aprobación):',
  postToolUse: 'Contexto declarado por el perfil después de usar la herramienta (no es salida de la herramienta ni una '
    + 'aprobación):',
};

function contextFor(profile, event, tool) {
  if (!HEADINGS[event]) return '';
  const rules = (profile && Array.isArray(profile.hooks) ? profile.hooks : [])
    .filter((rule) => rule.event === event && (!rule.tools || rule.tools.includes(tool)));
  if (!rules.length) return '';
  return `${HEADINGS[event]}\n${rules.map((rule) => `- ${rule.context}`).join('\n')}`;
}

// El hook deja constancia en el registro de la app; nunca ejecuta código.
function record(session, event, tool) {
  const name = session && session.profile && session.profile.name ? session.profile.name : 'perfil';
  console.log(`[agent] hook ${event}${tool ? ` (${tool})` : ''} aplicado desde «${name}»`);
}

module.exports = { contextFor, record };
