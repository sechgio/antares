const { nativeMethods } = require('../shared/ipc-method-catalog');

const SPOTIFY_METHODS = nativeMethods('spotify');

module.exports = { SPOTIFY_METHODS };
