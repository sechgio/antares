const fs=require('fs');
const l=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.test.ts','utf8').split('\n');
for(let i=0;i<l.length;i++){ if(/beforeEach|_resetCanvasPushQueueForTests|localStorage\.clear/.test(l[i])) console.log(i+1, l[i].trim());}
