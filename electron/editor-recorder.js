const fs = require('fs');
const path = require('path');

const MAX_IN_FLIGHT_BYTES = 8 * 1024 * 1024;
const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

class RecordingQuotaExceededError extends Error {
  constructor(quotaBytes) {
    super(`la grabación superó la cuota de ${Math.round(quotaBytes / 1024 / 1024)} MB`);
    this.name = 'RecordingQuotaExceededError';
  }
}

class RecordingSequenceError extends Error {
  constructor(expected, received) {
    super(`bloque fuera de orden: se esperaba ${expected} y llegó ${received}`);
    this.name = 'RecordingSequenceError';
  }
}

class RecordingSession {
  constructor({ sessionId, directory, quotaBytes = DEFAULT_QUOTA_BYTES }) {
    if (!sessionId || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
      throw new Error('sessionId inválido');
    }
    this.sessionId = sessionId;
    this.directory = directory;
    this.quotaBytes = quotaBytes;
    this.path = path.join(directory, `${sessionId}.webm`);
    this.expectedSeq = 0;
    this.writtenBytes = 0;
    this.closed = false;
    this.fd = fs.openSync(this.path, 'w');
  }

  append(seq, chunk) {
    if (this.closed) {
      throw new Error('la sesión de grabación ya está cerrada');
    }
    if (seq !== this.expectedSeq) {
      throw new RecordingSequenceError(this.expectedSeq, seq);
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.writtenBytes + buffer.length > this.quotaBytes) {
      throw new RecordingQuotaExceededError(this.quotaBytes);
    }
    fs.writeSync(this.fd, buffer);
    this.writtenBytes += buffer.length;
    this.expectedSeq += 1;
    return { sessionId: this.sessionId, seq, writtenBytes: this.writtenBytes };
  }

  finish() {
    if (this.closed) {
      throw new Error('la sesión de grabación ya está cerrada');
    }
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
    this.closed = true;
    return { sessionId: this.sessionId, path: this.path, writtenBytes: this.writtenBytes };
  }

  abort() {
    if (!this.closed) {
      try {
        fs.closeSync(this.fd);
      } catch {
      }
      this.closed = true;
    }
    try {
      fs.unlinkSync(this.path);
    } catch {
    }
    return { sessionId: this.sessionId, aborted: true };
  }
}

class RecordingSessionManager {
  constructor({ directory, quotaBytes = DEFAULT_QUOTA_BYTES, maxInFlightBytes = MAX_IN_FLIGHT_BYTES }) {
    this.directory = directory;
    this.quotaBytes = quotaBytes;
    this.maxInFlightBytes = maxInFlightBytes;
    this.sessions = new Map();
    fs.mkdirSync(directory, { recursive: true });
  }

  create(sessionId) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`la sesión ${sessionId} ya existe`);
    }
    const session = new RecordingSession({
      sessionId,
      directory: this.directory,
      quotaBytes: this.quotaBytes,
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`sesión de grabación desconocida: ${sessionId}`);
    }
    return session;
  }

  finish(sessionId) {
    const result = this.get(sessionId).finish();
    this.sessions.delete(sessionId);
    return result;
  }

  abort(sessionId) {
    const result = this.get(sessionId).abort();
    this.sessions.delete(sessionId);
    return result;
  }

  shouldThrottle(sessionId) {
    return this.get(sessionId).writtenBytes >= this.maxInFlightBytes;
  }
}

module.exports = {
  RecordingSessionManager,
  RecordingQuotaExceededError,
  RecordingSequenceError,
  MAX_IN_FLIGHT_BYTES,
  DEFAULT_QUOTA_BYTES,
};
