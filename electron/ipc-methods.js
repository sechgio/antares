const catalog = require('../shared/ipc-method-catalog');

const BACKEND_METHODS = catalog.BACKEND_METHODS;
const NATIVE_METHODS = catalog.NATIVE_METHODS;
const LONG_RUNNING_METHODS = catalog.LONG_RUNNING_METHODS;
const ALLOWED_RENDERER_METHODS = catalog.METHOD_NAMES;

module.exports = {
  BACKEND_METHODS,
  NATIVE_METHODS,
  LONG_RUNNING_METHODS,
  ALLOWED_RENDERER_METHODS,
};
