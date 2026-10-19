const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8').split('\n');
console.log(l.slice(933,948).join('\n'));
