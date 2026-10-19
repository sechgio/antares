const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8').split('\n');
console.log(l.slice(868,892).map((x,i)=>i+869+' '+x).join('\n'));
