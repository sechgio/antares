const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
const old='export function queueCanvasCloudPush(\n  doc: CanvasDocument,\n  options?: { forceResurrect?: boolean },\n): Promise<void> {\n  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  return flushPendingPushes();\n}';
const neu='export function queueCanvasCloudPush(\n  doc: CanvasDocument,\n  options?: { forceResurrect?: boolean },\n): Promise<void> {\n  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  recordPendingCanvasPush({ id: doc.id, doc, options });\n  return flushPendingPushes();\n}';
if(!s.includes(old)){ console.error('queue anchor not found'); process.exit(1); }
s=s.replace(old,neu);
// hydrate in queue? queue already may be called before flush; call record enough. Ensure hydrate in queue before set:
s=s.replace('  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  recordPendingCanvasPush', '  hydratePendingCanvasPushes();\n  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  recordPendingCanvasPush');
// reset for tests also clear persisted pushes
const oldReset='export function _resetCanvasPushQueueForTests(): void {\n  pendingPushById.clear();\n  pushRetry.cancel();\n}';
const neuReset='export function _resetCanvasPushQueueForTests(): void {\n  pendingPushById.clear();\n  pushRetry.cancel();\n  for (const pending of pendingCanvasPushes()) {\n    clearPendingCanvasPush(pending.id);\n  }\n}';
if(s.includes(oldReset)) s=s.replace(oldReset,neuReset);
fs.writeFileSync(p,s);
console.log('done');
