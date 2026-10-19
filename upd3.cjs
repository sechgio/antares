const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
// hydrate in flush
s=s.replace("    try {\n      await replayPendingCanvasDeletes();\n", "    try {\n      hydratePendingCanvasPushes();\n      await replayPendingCanvasDeletes();\n");
// accepted push clear
s=s.replace("        await publishAcceptedPush(result);\n", "        await publishAcceptedPush(result);\n        clearPendingCanvasPush(item.id);\n");
// server kept newer
s=s.replace("        if (!result.accepted) {\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n          continue;\n        }", "        if (!result.accepted) {\n          clearPendingCanvasPush(item.id);\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n          continue;\n        }");
fs.writeFileSync(p,s);
console.log('done');
