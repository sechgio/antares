const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8').split('\n');
for(let i=933;i<942;i++) console.log(i+1, JSON.stringify(l[i]));
