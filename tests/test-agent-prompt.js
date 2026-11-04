'use strict';

const assert = require('node:assert/strict');
const {
  CONVERSATION_GUIDE, SAFETY_GUIDE, EXECUTION_GUIDE, LEGACY_GUIDES, SYSTEM_PROMPT, legacyNotes,
  migrateInstructions, splitMemorySnapshot,
} = require('../electron/agent-prompts');
const { MEMORY_SNAPSHOT_MARKER } = require('../electron/agent-shared').shared;

const OLD_PROMPT = [
  'Eres el agente de Antares. Conversación y preferencias: versión anterior sin la regla de estilo.',
  'Seguridad y autoridad: versión anterior sin la política de aprobaciones.',
  'Método de trabajo: versión anterior sin el modo 100 %.',
  'Modo 100 %: dentro de un encargo autorizado, encadena todos los pasos necesarios. El último tramo es obligatorio.',
  'Indicaciones propias: conserva el tono del perfil.',
].join('\n\n');

const cases = {
  'todas las guías presentes': () => {
    assert.deepEqual(legacyNotes(LEGACY_GUIDES.join('\n\n')), []);
    assert.deepEqual(legacyNotes(SYSTEM_PROMPT), [], 'el prompt base vigente ya contiene las guías');
  },
  'ninguna guía presente': () => {
    assert.deepEqual(legacyNotes('Instrucciones de una conversación anterior'), LEGACY_GUIDES);
  },
  'solo faltan las guías ausentes': () => {
    assert.deepEqual(legacyNotes(`Cabecera\n${SAFETY_GUIDE}\nCierre`), [CONVERSATION_GUIDE, EXECUTION_GUIDE]);
  },
  'una guía modificada no se duplica': () => {
    assert.deepEqual(legacyNotes('Seguridad y autoridad: versión anterior con otros detalles.'),
      [CONVERSATION_GUIDE, EXECUTION_GUIDE]);
  },
  'entrada vacía': () => {
    assert.deepEqual(legacyNotes(), LEGACY_GUIDES);
    assert.deepEqual(legacyNotes(null), LEGACY_GUIDES);
  },
  'migra un prompt base anterior a las guías vigentes': () => {
    const migrated = migrateInstructions(OLD_PROMPT);
    assert(!migrated.includes('versión anterior') && !migrated.includes('El último tramo es obligatorio'),
      'la migración retira las guías antiguas y la guía eliminada');
    assert(migrated.startsWith('Eres el agente de Antares. Conversación y preferencias:'),
      'la migración conserva el texto previo a la primera guía');
    assert.deepEqual(legacyNotes(migrated), [], 'tras migrar no se añade ninguna guía por contexto');
    for (const guide of [CONVERSATION_GUIDE, SAFETY_GUIDE, EXECUTION_GUIDE]) {
      assert.equal(migrated.split(guide).length, 2, 'la migración deja una sola copia de cada guía');
    }
    assert(migrated.endsWith('Indicaciones propias: conserva el tono del perfil.'), 'conserva instrucciones ajenas a las guías');
    assert.equal(migrateInstructions(migrated), migrated, 'la migración es idempotente');
  },
  'un prompt sin guías no cambia': () => {
    assert.equal(migrateInstructions('Indicaciones propias: conserva el tono.'), 'Indicaciones propias: conserva el tono.');
    assert.equal(migrateInstructions(''), '');
  },
  'el modo 100 % conserva el freno de las acciones irreversibles': () => {
    assert(EXECUTION_GUIDE.includes(
      'detente solo si falta un dato que solo el usuario pueda aportar (enviar, publicar, comprar, transferir, '
      + 'borrar o sobrescribir datos, cambiar permisos, tocar producción o aceptar términos) o al cerrar.'),
    'la guía de ejecución nombra las acciones que requieren al usuario');
  },
  'la guía de conversación conserva las reglas de estilo': () => {
    for (const rule of ['empieza por la conclusión', 'evita el relleno', 'listas cortas', 'pide solo lo necesario']) {
      assert(CONVERSATION_GUIDE.includes(rule), `la guía conserva la regla «${rule}»`);
    }
  },
  'el prompt base incluye cada guía una sola vez': () => {
    for (const guide of [CONVERSATION_GUIDE, SAFETY_GUIDE, EXECUTION_GUIDE]) {
      assert.equal(SYSTEM_PROMPT.split(guide).length, 2, 'el prompt base no duplica las guías');
    }
    assert(!SYSTEM_PROMPT.includes('El último tramo es obligatorio'), 'el prompt base no conserva la guía eliminada');
  },
  'el snapshot de memoria se separa y sobrevive a la migración': () => {
    const snapshot = `${MEMORY_SNAPSHOT_MARKER}\n- Preferencia: Informes — usa la B`;
    const withSnapshot = `${OLD_PROMPT}\n\n${snapshot}`;
    const { stable, snapshot: cut } = splitMemorySnapshot(withSnapshot);
    assert.equal(stable, OLD_PROMPT, 'separar conserva las instrucciones intactas');
    assert.equal(cut, snapshot, 'separar conserva el bloque completo');
    assert.deepEqual(splitMemorySnapshot(OLD_PROMPT), { stable: OLD_PROMPT, snapshot: '' }, 'sin marcador no se corta nada');
    const migrated = migrateInstructions(withSnapshot);
    assert(migrated.endsWith(snapshot), 'la migración recoloca el snapshot al final');
    assert(migrated.split('usa la B').length === 2, 'el bloque de memoria no se duplica');
    assert(!migrated.includes('versión anterior'), 'la parte estable sí se migra');
    assert.equal(migrateInstructions(migrated), migrated, 'la migración con snapshot es idempotente');
  },
  'un recuerdo con encabezado de guía no altera la migración': () => {
    const snapshot = `${MEMORY_SNAPSHOT_MARKER}\n- Nota: Seguridad y autoridad: versión anterior`;
    const migrated = migrateInstructions(`${OLD_PROMPT}\n\n${snapshot}`);
    assert(migrated.endsWith(snapshot), 'el bloque marcado se conserva íntegro aunque imite un encabezado de guía');
    assert.equal((migrated.match(/Seguridad y autoridad:/g) || []).length, 2,
      'la guía migra a su versión vigente y el recuerdo queda aparte');
  },
};

let failed = false;
for (const [name, run] of Object.entries(cases)) {
  try { run(); console.log(`[PASS] ${name}`); }
  catch (error) { failed = true; console.error(`[FAIL] ${name}`, error); }
}
if (failed) process.exitCode = 1;
