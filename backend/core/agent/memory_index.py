"""Índice FTS5 derivado de memory.json para la búsqueda híbrida de la memoria.

memory.json sigue siendo la fuente de verdad: el índice se reconstruye si falta o cambia de esquema y se
sincroniza por firma de contenido. Si SQLite no trae FTS5 o el índice falla, ``rank`` devuelve None y la
memoria vuelve a la búsqueda por palabras exactas. Los embeddings son opcionales y quedan apagados salvo
que ``ANTARES_MEMORY_EMBEDDINGS`` esté activo.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import sqlite3
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
SCHEMA = """
DROP TABLE IF EXISTS memory_fts;
DROP TABLE IF EXISTS memory_vec;
CREATE VIRTUAL TABLE memory_fts USING fts5(
    id UNINDEXED, sig UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
CREATE TABLE memory_vec (id TEXT PRIMARY KEY, sig TEXT NOT NULL, vec TEXT NOT NULL);
"""
KIND_WEIGHTS = {"fact": 1.5, "preference": 1.5, "procedure": 1.2, "journal": 1.0}
RRF_K = 60
SEMANTIC_MIN = 0.35
_STOP = frozenset({"los", "las", "del", "una", "uno", "unos", "unas", "para", "por", "con", "que", "como", "este",
                   "esta", "estos", "estas", "ese", "esa", "sus", "mas", "muy", "sin", "sobre", "entre", "the",
                   "and", "for"})

Embedder = Callable[[list[str]], list[list[float]]]
_embedder: Embedder | None = None


class Doc(NamedTuple):
    kind: str
    title: str
    body: str
    age_days: float
    key: str


def set_embedder(embedder: Embedder | None) -> None:
    """Registra el proveedor de embeddings; solo se usa con ANTARES_MEMORY_EMBEDDINGS activo."""
    global _embedder
    _embedder = embedder


def _http_embedder(url: str) -> Embedder:
    model = os.environ.get("ANTARES_MEMORY_EMBEDDINGS_MODEL", "")
    key = os.environ.get("ANTARES_MEMORY_EMBEDDINGS_KEY", "")

    def embed(texts: list[str]) -> list[list[float]]:
        request = urllib.request.Request(
            url, data=json.dumps({"model": model, "input": texts}).encode("utf-8"),
            headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})})
        with urllib.request.urlopen(request, timeout=5) as response:
            rows = json.loads(response.read())["data"]
        return [[float(x) for x in row["embedding"]] for row in sorted(rows, key=lambda r: int(r.get("index", 0)))]

    return embed


def active_embedder() -> Embedder | None:
    if os.environ.get("ANTARES_MEMORY_EMBEDDINGS", "").strip().lower() not in {"1", "true", "on"}:
        return None
    if _embedder is not None:
        return _embedder
    url = os.environ.get("ANTARES_MEMORY_EMBEDDINGS_URL", "").strip()
    return _http_embedder(url) if url.startswith(("http://", "https://")) else None


def _sig(doc: Doc) -> str:
    return hashlib.sha1(f"{doc.kind}\0{doc.title}\0{doc.body}".encode()).hexdigest()[:16]


def _terms(query_key: str) -> list[str]:
    terms: set[str] = set()
    for word in query_key.split():
        if len(word) < 3 or word in _STOP:
            continue
        if len(word) > 5 and word.endswith("es"):
            word = word[:-2]
        elif len(word) > 4 and word.endswith("s"):
            word = word[:-1]
        terms.add(word)
    return sorted(terms)


def _hit(term: str, tokens: list[str]) -> bool:
    return any(token.startswith(term) if len(term) >= 4 else token == term for token in tokens)


def _cosine(a: list[float], b: list[float]) -> float:
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b, strict=False)) / norm if norm else 0.0


class MemoryIndex:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None
        self._failed = False

    def _connect(self) -> sqlite3.Connection | None:
        if self._failed:
            return None
        if self._conn is None:
            try:
                conn = sqlite3.connect(self._path, check_same_thread=False)
                conn.execute("PRAGMA secure_delete = ON")
                if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
                    conn.executescript(SCHEMA)
                    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                    conn.commit()
                self._conn = conn
            except sqlite3.Error as err:
                logger.warning("Índice FTS5 de memoria no disponible; se usa la búsqueda por palabras: %s", err)
                self._failed = True
                return None
        return self._conn

    def sync(self, docs: dict[str, Doc]) -> bool:
        conn = self._connect()
        if conn is None:
            return False
        try:
            want = {item_id: _sig(doc) for item_id, doc in docs.items()}
            have = dict(conn.execute("SELECT id, sig FROM memory_fts").fetchall())
            stale = [(item_id,) for item_id, sig in have.items() if want.get(item_id) != sig]
            fresh = [item_id for item_id, sig in want.items() if have.get(item_id) != sig]
            if stale or fresh:
                with conn:
                    conn.executemany("DELETE FROM memory_fts WHERE id = ?", stale)
                    conn.executemany("DELETE FROM memory_vec WHERE id = ?", stale)
                    conn.executemany("INSERT INTO memory_fts (id, sig, title, body) VALUES (?, ?, ?, ?)",
                                     [(i, want[i], docs[i].title, docs[i].body) for i in fresh])
            return True
        except sqlite3.Error as err:
            logger.warning("No se pudo sincronizar el índice de memoria: %s", err)
            return False

    def rebuild(self, docs: dict[str, Doc]) -> bool:
        conn = self._connect()
        if conn is None:
            return False
        try:
            with conn:
                conn.execute("DELETE FROM memory_fts")
                conn.execute("DELETE FROM memory_vec")
        except sqlite3.Error as err:
            logger.warning("No se pudo reconstruir el índice de memoria: %s", err)
            return False
        return self.sync(docs)

    def rank(self, query: str, query_key: str, docs: dict[str, Doc],
             allowed: set[str]) -> dict[str, tuple[float, str]] | None:
        """Puntúa los recuerdos permitidos: BM25 + cobertura + tipo + recencia, fusionado por RRF con embeddings."""
        terms = _terms(query_key)
        if not terms or not self.sync(docs):
            return None
        conn = self._connect()
        if conn is None:
            return None
        match = " OR ".join(f'"{term}"*' if len(term) >= 4 else f'"{term}"' for term in terms)
        try:
            rows = conn.execute("SELECT id, bm25(memory_fts, 0, 0, 3.0, 1.0), "
                                "snippet(memory_fts, -1, '**', '**', '…', 12) FROM memory_fts "
                                "WHERE memory_fts MATCH ?", (match,)).fetchall()
        except sqlite3.Error as err:
            logger.warning("Falló la consulta FTS5 de memoria: %s", err)
            return None
        phrase = len(query_key.split()) > 1
        lexical: dict[str, tuple[float, str]] = {}
        for item_id, bm25, snippet in rows:
            doc = docs.get(item_id)
            if doc is None or item_id not in allowed:
                continue
            tokens = doc.key.split()
            coverage = sum(_hit(term, tokens) for term in terms) / len(terms)
            relevance = max(0.0, -float(bm25))
            score = coverage + (0.5 if phrase and query_key in doc.key else 0.0) + 0.5 * relevance / (relevance + 1)
            score *= KIND_WEIGHTS.get(doc.kind, 1.0) * (0.6 + 0.4 / (1 + doc.age_days / 30))
            lexical[item_id] = (score, str(snippet or ""))
        embed = active_embedder()
        if embed is None:
            return lexical
        try:
            semantic = self._semantic(conn, embed, query, docs, allowed)
        except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as err:
            logger.warning("Embeddings de memoria no disponibles; se usa solo FTS5: %s", err)
            return lexical
        fused: dict[str, float] = {}
        for order in (sorted(lexical, key=lambda i: -lexical[i][0]), semantic):
            for position, item_id in enumerate(order):
                fused[item_id] = fused.get(item_id, 0.0) + 1 / (RRF_K + position + 1)
        return {item_id: (score, lexical.get(item_id, (0.0, ""))[1]) for item_id, score in fused.items()}

    def _semantic(self, conn: sqlite3.Connection, embed: Embedder, query: str, docs: dict[str, Doc],
                  allowed: set[str]) -> list[str]:
        ids = sorted(i for i in allowed if i in docs)
        sigs = {i: _sig(docs[i]) for i in ids}
        vectors = {i: json.loads(vec) for i, sig, vec in conn.execute("SELECT id, sig, vec FROM memory_vec")
                   if sigs.get(i) == sig}
        missing = [i for i in ids if i not in vectors]
        if missing:
            fresh = embed([f"{docs[i].title}\n{docs[i].body}" for i in missing])
            with conn:
                conn.executemany("INSERT OR REPLACE INTO memory_vec (id, sig, vec) VALUES (?, ?, ?)",
                                 [(i, sigs[i], json.dumps(v)) for i, v in zip(missing, fresh, strict=True)])
            vectors.update(zip(missing, fresh, strict=True))
        target = embed([query])[0]
        scored = [(_cosine(target, vectors[i]), i) for i in ids]
        return [i for similarity, i in sorted(scored, reverse=True) if similarity >= SEMANTIC_MIN]
