const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.test.ts','utf8').split('\n');
console.log(l.slice(78,92).join('\n'));
