const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.test.ts','utf8').split('\n');
// find test around in-flight
let i=l.findIndex(x=>/doc-in-flight/.test(x));
console.log(l.slice(Math.max(0,i-60), i+20).join('\n'));
