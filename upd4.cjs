const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
s = s.replace('      await replayPendingCanvasDeletes();\n', '      hydratePendingCanvasPushes();\n      await replayPendingCanvasDeletes();\n');
s = s.replace('        await publishAcceptedPush(result);\n', '        await publishAcceptedPush(result);\n        clearPendingCanvasPush(item.id);\n');
s = s.replace("        if (!result.accepted) {\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n", "        if (!result.accepted) {\n          clearPendingCanvasPush(item.id);\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n");
fs.writeFileSync(p,s);
console.log('done');
