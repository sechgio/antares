const assert = require('node:assert/strict');
const {
  mergeResources,
  parseArgs,
  summarize,
  summarizeSamples,
  summarizeStartupPairs,
  resourceDelta,
  resourcesByName,
} = require('../scripts/benchmark-desktop-performance');

assert.deepEqual(summarize([7, 3, 1, 5, 9]), {
  n: 5,
  min_ms: 1,
  p50_ms: 5,
  p95_ms: 9,
  max_ms: 9,
  mean_ms: 5,
});
assert.deepEqual(summarize([]), { n: 0, min_ms: null, p50_ms: null, p95_ms: null, max_ms: null, mean_ms: null });
assert.deepEqual(
  resourceDelta([{ name: 'shell.js' }, { name: 'react.js' }], [{ name: 'react.js' }, { name: 'canvas.js' }]),
  [{ name: 'canvas.js' }],
);
assert.deepEqual(
  mergeResources([{ name: 'canvas.js', bytes: null }], [{ name: 'canvas.js', bytes: 512 }]),
  [{ name: 'canvas.js', bytes: 512 }],
);
assert.deepEqual(
  resourcesByName([{ name: 'canvas.js' }, { name: 'shell.js' }], new Set(['canvas.js'])),
  [{ name: 'canvas.js' }],
);
assert.deepEqual(summarize([1024], 'bytes'), {
  n: 1,
  min_bytes: 1024,
  p50_bytes: 1024,
  p95_bytes: 1024,
  max_bytes: 1024,
  mean_bytes: 1024,
});
const pairedSummary = summarizeSamples([20, -3, 26].map((timeSaved, index) => ({
  startup: {
    first_paint_after_process_start_ms: 500,
    electron_process_to_ready_to_show_ms: 300,
    backend_spawn_to_ready_ms: 200,
  },
  canvas: {
    on_demand: {
      canvas_open_ms: 100,
      first_paint_after_reload_ms: 80,
      renderer_js_heap_before_canvas_bytes: 1000,
    },
    idle_prefetched: {
      canvas_open_ms: 100 - timeSaved,
      first_paint_after_reload_ms: 80,
      renderer_js_heap_before_canvas_bytes: 1100 + index * 100,
    },
  },
})));
assert.equal(pairedSummary.idle_prefetch_canvas_open_time_saved_ms.p50_ms, 20);
assert.equal(pairedSummary.idle_prefetch_first_paint_time_saved_ms.p50_ms, 0);
assert.equal(pairedSummary.idle_prefetch_heap_delta_before_canvas_bytes.p50_bytes, 200);
assert.equal(parseArgs(['--startup-pairs', '30']).startupPairs, 30);
assert.equal(parseArgs(['--startup-pairs', '1', '--canvas-flow']).canvasFlow, true);
assert.throws(() => parseArgs(['--startup-pairs', '51']), /entre 1 y 50/);
assert.throws(() => parseArgs(['--canvas-flow']), /requiere --startup-pairs/);
const startupSummary = summarizeStartupPairs([
  { fresh_profile: { first_paint_after_process_start_ms: 500 }, reused_profile: { first_paint_after_process_start_ms: 450 } },
  { fresh_profile: { first_paint_after_process_start_ms: 600 }, reused_profile: { first_paint_after_process_start_ms: 540 } },
]);
assert.equal(startupSummary.first_paint_after_process_start_ms.paired_reused_minus_fresh.p50_ms, -60);
assert.equal(startupSummary.backend_spawn_to_ready_ms.paired_reused_minus_fresh.n, 0);
console.log('Desktop performance benchmark statistics OK.');
