const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(
"  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  return flushPendingPushes();",
"  hydratePendingCanvasPushes();\n  pendingPushById.set(doc.id, { id: doc.id, doc, options });\n  recordPendingCanvasPush({ id: doc.id, doc, options });\n  return flushPendingPushes();"
);
s=s.replace(
"export function _resetCanvasPushQueueForTests(): void {\n  pendingPushById.clear();\n  pushRetry.cancel();\n}",
"export function _resetCanvasPushQueueForTests(): void {\n  pendingPushById.clear();\n  pushRetry.cancel();\n  for (const pending of pendingCanvasPushes()) clearPendingCanvasPush(pending.id);\n}"
);
fs.writeFileSync(p,s);
console.log('done');
