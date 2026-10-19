const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
const s=fs.readFileSync(p,'utf8');
const old="import { pendingCanvasDeletes, recordPendingCanvasDelete, clearPendingCanvasDelete } from './cloudQueue';";
const neu="import { pendingCanvasDeletes, recordPendingCanvasDelete, clearPendingCanvasDelete, pendingCanvasPushes, recordPendingCanvasPush, clearPendingCanvasPush } from './cloudQueue';";
if(!s.includes(old)){ console.error('import not found'); process.exit(1);}
fs.writeFileSync(p, s.replace(old,neu));
console.log('done');
