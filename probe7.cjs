const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8').split('\n');
console.log(l.slice(908,932).map((x,i)=>i+909+' '+x).join('\n'));
