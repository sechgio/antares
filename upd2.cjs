const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
const s=fs.readFileSync(p,'utf8');
const old='let pushFlushPromise: Promise<void> | null = null;';
const neu='let pushFlushPromise: Promise<void> | null = null;\n\nfunction hydratePendingCanvasPushes(): void {\n  for (const pending of pendingCanvasPushes()) {\n    if (!pendingPushById.has(pending.id)) {\n      pendingPushById.set(pending.id, { id: pending.id, doc: pending.doc, options: pending.options });\n    }\n  }\n}';
if(!s.includes(old)){ console.error('anchor not found'); process.exit(1);}
fs.writeFileSync(p, s.replace(old,neu));
console.log('done');
