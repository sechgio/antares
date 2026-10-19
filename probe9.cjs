const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8').split('\n');
console.log(l.slice(896,913).map((x,i)=>i+897+' '+x).join('\n'));
