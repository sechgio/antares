/**
 * Renombre de evidencias: NIS (7 dig) → SGIO (8 dig) + secuencia.
 * Carpeta destino: columna DESTINO de BD_IMG (subcarpeta bajo un parent raíz).
 * Origen: 6553447_1.jpg  →  Destino: {DESTINO}/70942759_1.jpg
 */

const SGIO_RE = /^(\d{8})$/;
const SGIO_IN_TEXT_RE = /(?:^|[^\d])(\d{8})(?=[^\d]|$)/;

function extensionOf(filename) {
  const m = String(filename || '').match(/(\.[A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : '.jpg';
}

/** SGIO válido: exactamente 8 dígitos (extrae de celdas con basura alrededor). */
function normalizeSgio(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (SGIO_RE.test(raw)) return raw;
  const m = raw.match(SGIO_IN_TEXT_RE);
  return m ? m[1] : null;
}

/** Nombre de carpeta desde columna DESTINO (trim; vacío → null). */
function normalizeDestino(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  // Drive folder names cannot contain / or \
  const cleaned = raw.replace(/[\\/]/g, '-').slice(0, 200);
  return cleaned || null;
}

function buildSgioFilename(sgio, slot, originalName) {
  const safeSgio = normalizeSgio(sgio);
  const n = Number(slot);
  if (!safeSgio || !Number.isFinite(n) || n < 1) {
    throw new Error(`Nombre SGIO inválido: sgio=${sgio} slot=${slot}`);
  }
  const name = `${safeSgio}_${Math.floor(n)}${extensionOf(originalName)}`;
  if (!/^\d{8}_\d+\.[a-z0-9]+$/i.test(name)) {
    throw new Error(`Nombre de archivo rechazado: ${name}`);
  }
  return name;
}

/**
 * Map NIS → { sgio, destino } desde filas BD_IMG
 * (A=NIS, B=SGIO, C=DESTINO).
 */
function buildNisMetaMap(rows) {
  const map = new Map();
  if (!rows?.length) return map;
  const start =
    String(rows[0]?.[0] || '')
      .trim()
      .toUpperCase() === 'NIS'
      ? 1
      : 0;
  for (let i = start; i < rows.length; i++) {
    const nis = String(rows[i]?.[0] || '').trim();
    if (!nis) continue;
    const sgio = normalizeSgio(rows[i]?.[1]);
    const destino = normalizeDestino(rows[i]?.[2]);
    map.set(nis, { sgio, destino });
  }
  return map;
}

/** @deprecated use buildNisMetaMap */
function buildNisToSgioMap(rows) {
  const meta = buildNisMetaMap(rows);
  const map = new Map();
  for (const [nis, { sgio }] of meta) {
    if (sgio) map.set(nis, sgio);
  }
  return map;
}

function _fileMeta(file) {
  if (!file) return null;
  if (typeof file === 'string') return { id: '', name: file, slot: null };
  return {
    id: file.id || '',
    name: file.name || '',
    slot: file.slot != null && file.slot !== '' ? Number(file.slot) : null,
  };
}

/**
 * Plan de copias renombradas: SGIO + subcarpeta DESTINO.
 * @param {Array<{nis:string,count:number,files?:unknown[]}>} nisResults
 * @param {Map<string,{sgio?:string|null,destino?:string|null}>|Map<string,string>} nisMeta
 * @param {{ onlyCompletos?: boolean }} [opts]
 */
function buildRenameJobs(nisResults, nisMeta, opts = {}) {
  const onlyCompletos = Boolean(opts.onlyCompletos);

  // Accept legacy Map<nis, sgioString> or Map<nis, {sgio, destino}>
  const lookup = new Map();
  if (nisMeta instanceof Map) {
    for (const [k, v] of nisMeta) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        lookup.set(k, {
          sgio: v.sgio || null,
          destino: v.destino || null,
        });
      } else {
        lookup.set(k, { sgio: v || null, destino: null });
      }
    }
  } else if (nisMeta && typeof nisMeta === 'object') {
    for (const [k, v] of Object.entries(nisMeta)) {
      if (v && typeof v === 'object') {
        lookup.set(k, { sgio: v.sgio || null, destino: v.destino || null });
      } else {
        lookup.set(k, { sgio: v || null, destino: null });
      }
    }
  }

  const jobs = [];
  const skipped = [];
  // Dedupe per destino folder: same SGIO_n.ext in different DESTINO is allowed
  const usedNames = new Set();

  for (const result of nisResults || []) {
    const nis = String(result.nis || '').trim();
    if (!nis) continue;

    const meta = lookup.get(nis) || { sgio: null, destino: null };
    const sgio = meta.sgio || null;
    const destino = meta.destino || null;

    if (!sgio) {
      skipped.push({ nis, reason: 'sin_sgio', detail: 'Sin SGIO en BD_IMG' });
      continue;
    }
    if (!destino) {
      skipped.push({
        nis,
        sgio,
        reason: 'sin_destino',
        detail: 'Sin DESTINO en BD_IMG (columna C)',
      });
      continue;
    }

    if (onlyCompletos && Number(result.count) !== 3) {
      skipped.push({
        nis,
        sgio,
        destino,
        reason: 'no_completo',
        detail: `Tiene ${result.count} imagen(es), se requieren 3`,
      });
      continue;
    }

    const files = (result.files || [])
      .map(_fileMeta)
      .filter((f) => f && f.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    if (!files.length) {
      skipped.push({
        nis,
        sgio,
        destino,
        reason: 'sin_archivos',
        detail: 'Sin archivos en el escaneo',
      });
      continue;
    }

    const assigned = new Set();
    let cursor = 1;

    for (const file of files) {
      if (!file.id) {
        skipped.push({
          nis,
          sgio,
          destino,
          reason: 'sin_file_id',
          detail: `Sin id de Drive: ${file.name}`,
        });
        continue;
      }

      let slot =
        file.slot != null && Number.isFinite(file.slot) && file.slot >= 1
          ? Math.floor(file.slot)
          : null;

      if (slot == null || assigned.has(slot)) {
        while (assigned.has(cursor)) cursor += 1;
        slot = cursor;
      }
      assigned.add(slot);
      cursor = Math.max(cursor, slot + 1);

      let toName;
      try {
        toName = buildSgioFilename(sgio, slot, file.name);
      } catch (err) {
        skipped.push({
          nis,
          sgio,
          destino,
          reason: 'nombre_invalido',
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const dedupeKey = `${destino}\0${toName}`;
      if (usedNames.has(dedupeKey)) {
        skipped.push({
          nis,
          sgio,
          destino,
          reason: 'nombre_duplicado',
          detail: `Ya planificado en ${destino}: ${toName}`,
        });
        continue;
      }
      usedNames.add(dedupeKey);

      jobs.push({
        fileId: file.id,
        fromName: file.name,
        toName,
        nis,
        sgio,
        destino,
        slot,
      });
    }
  }

  return { jobs, skipped };
}

/** Unique DESTINO folder names from a job list (stable order). */
function uniqueDestinos(jobs) {
  const seen = new Set();
  const list = [];
  for (const job of jobs || []) {
    const d = job.destino;
    if (!d || seen.has(d)) continue;
    seen.add(d);
    list.push(d);
  }
  return list;
}

module.exports = {
  normalizeSgio,
  normalizeDestino,
  buildSgioFilename,
  buildNisMetaMap,
  buildNisToSgioMap,
  buildRenameJobs,
  uniqueDestinos,
  extensionOf,
};
