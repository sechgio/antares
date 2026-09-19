const catalog = require('../shared/ipc-method-catalog');

const BACKEND_METHODS = catalog.BACKEND_METHODS;
const NATIVE_METHODS = catalog.NATIVE_METHODS;
const ALLOWED_RENDERER_METHODS = catalog.METHOD_NAMES;

module.exports = {
  BACKEND_METHODS,
  NATIVE_METHODS,
  ALLOWED_RENDERER_METHODS,
};
