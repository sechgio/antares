const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
const old = "        await publishAcceptedPush(result);\n      } catch (err) {";
const neu = "        await publishAcceptedPush(result);\n        clearPendingCanvasPush(item.id);\n      } catch (err) {";
if(!s.includes(old)){ console.error('publish anchor not found'); process.exit(1);}
s=s.replace(old,neu);
// accepted branch
const old2 = "        if (!result.accepted) {\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n          continue;\n        }\n";
const neu2 = "        if (!result.accepted) {\n          clearPendingCanvasPush(item.id);\n          firstError ??= new Error('El servidor conservó una versión más reciente del documento');\n          continue;\n        }\n";
if(!s.includes(old2)){ console.error('accepted anchor not found'); process.exit(1);}
s=s.replace(old2,neu2);
// hydrate replay
const old3 = "    try {\n      await replayPendingCanvasDeletes();\n";
const neu3 = "    try {\n      hydratePendingCanvasPushes();\n      await replayPendingCanvasDeletes();\n";
if(!s.includes(old3)){ console.error('replay anchor not found'); process.exit(1);}
s=s.replace(old3,neu3);
fs.writeFileSync(p,s);
console.log('done');
