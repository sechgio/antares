const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
s = s.replace(/await publishAcceptedPush\(result\);\r?\n(\s*\} catch \(err\))/, 'await publishAcceptedPush(result);\n        clearPendingCanvasPush(item.id);\n');
s = s.replace(/if \(!result\.accepted\) \{\r?\n\s*firstError \?\?= new Error\('El servidor conservó una versión más reciente del documento'\);\r?\n\s*continue;\r?\n\s*\}/, "if (!result.accepted) {\n          clearPendingCanvasPush(item.id);\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n          continue;\n        }");
s = s.replace(/try \{\r?\n(\s*)await replayPendingCanvasDeletes\(\);\r?\n/, 'try {\n      hydratePendingCanvasPushes();\n      await replayPendingCanvasDeletes();\n');
fs.writeFileSync(p,s);
console.log('done');
