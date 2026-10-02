'use strict';

const { nativeMethods } = require('../shared/ipc-method-catalog');

const CONNECTIONS_METHODS = nativeMethods('connections');

module.exports = { CONNECTIONS_METHODS };
