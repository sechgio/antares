const fs=require('fs');
const s=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8');
const anchor='const batch = Array.from(pendingPushById.values());';
let i=s.indexOf(anchor);
console.log(s.slice(i, i+700));
