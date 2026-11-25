'use strict';

// Ranking FTS5 efímero para sessions_search: indexa en memoria los mensajes leídos en cada búsqueda,
// así nunca queda desincronizado del historial ni necesita migración. Sin node:sqlite o sin FTS5
// devuelve null y el llamador conserva la coincidencia por palabras.

const STOP = new Set([
  'los',
  'las',
  'del',
  'una',
  'uno',
  'unos',
  'unas',
  'para',
  'por',
  'con',
  'que',
  'como',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'sus',
  'mas',
  'muy',
  'sin',
  'sobre',
  'entre',
  'the',
  'and',
  'for',
]);
const SCHEMA = "CREATE VIRTUAL TABLE m USING fts5(body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3')";
let sqlite;
let usable;

function words(text) {
  return (
    String(text || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  );
}

function terms(query) {
  const found = new Set();
  for (let word of words(query)) {
    if (word.length < 3 || STOP.has(word)) continue;
    if (word.length > 5 && word.endsWith('es')) word = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith('s')) word = word.slice(0, -1);
    found.add(word);
  }
  return [...found].sort();
}

function open() {
  if (sqlite === undefined) {
    try {
      sqlite = require('node:sqlite');
    } catch {
      sqlite = null;
    }
  }
  if (!sqlite) return null;
  const db = new sqlite.DatabaseSync(':memory:');
  try {
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function available() {
  if (usable === undefined) {
    try {
      const db = open();
      usable = Boolean(db);
      db?.close();
    } catch {
      usable = false;
    }
  }
  return usable;
}

// docs: [{ text, ts }]. Devuelve [{ index, score, snippet }] de mayor a menor, o null si no puede rankear.
function rank(query, docs, now = Date.now()) {
  const list = terms(query);
  if (!list.length || !available()) return null;
  let db;
  try {
    db = open();
    const insert = db.prepare('INSERT INTO m (rowid, body) VALUES (?, ?)');
    db.exec('BEGIN');
    docs.forEach((doc, index) => insert.run(index + 1, doc.text));
    db.exec('COMMIT');
    const match = list.map((term) => (term.length >= 4 ? `"${term}"*` : `"${term}"`)).join(' OR ');
    const rows = db
      .prepare("SELECT rowid AS id, bm25(m) AS bm, snippet(m, 0, '**', '**', '…', 24) AS snip FROM m WHERE m MATCH ?")
      .all(match);
    const phrase = words(query).join(' ');
    return rows
      .map((row) => {
        const doc = docs[row.id - 1];
        const tokens = words(doc.text);
        const hits = list.filter((term) =>
          tokens.some((token) => (term.length >= 4 ? token.startsWith(term) : token === term)),
        );
        const relevance = Math.max(0, -row.bm);
        const bonus = phrase.includes(' ') && tokens.join(' ').includes(phrase) ? 0.5 : 0;
        const days = Math.max(0, now - (doc.ts || 0)) / 86400000;
        const score =
          (hits.length / list.length + bonus + (0.5 * relevance) / (relevance + 1)) * (0.6 + 0.4 / (1 + days / 30));
        return { index: row.id - 1, score, snippet: row.snip };
      })
      .sort((a, b) => b.score - a.score || (docs[b.index].ts || 0) - (docs[a.index].ts || 0));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

module.exports = { available, rank, terms };
