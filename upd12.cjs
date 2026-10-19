const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
// when batch starts, clear persisted pending for those ids
s=s.replace(
"    const batch = Array.from(pendingPushById.values());\r\n    pendingPushById.clear();",
"    const batch = Array.from(pendingPushById.values());\r\n    pendingPushById.clear();\r\n    for (const item of batch) clearPendingCanvasPush(item.id);"
);
// on catch, persist retry metadata
s=s.replace(
"        firstError ??= err;\r\n        if (!pendingPushById.has(item.id)) {\r\n          pendingPushById.set(item.id, { id: item.id, options: item.options });\r\n        }",
"        firstError ??= err;\r\n        if (!pendingPushById.has(item.id)) {\r\n          pendingPushById.set(item.id, { id: item.id, options: item.options });\r\n          recordPendingCanvasPush({ id: item.id, options: item.options });\r\n        }"
);
fs.writeFileSync(p,s);
console.log('done');
