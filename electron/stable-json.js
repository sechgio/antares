'use strict';

function stableJson(value, omit) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, omit)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => !omit || !omit.has(key)).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key], omit)}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

module.exports = { stableJson };
