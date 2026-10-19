const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace('        await publishAcceptedPush(result);\r\n        clearPendingCanvasPush(item.id);\r\n {\r\n', '        await publishAcceptedPush(result);\r\n        clearPendingCanvasPush(item.id);\r\n      } catch (err) {\r\n');
fs.writeFileSync(p,s);
console.log('done');
