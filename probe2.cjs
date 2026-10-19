const fs=require('fs');
const s=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8');
let i=s.indexOf('await publishAcceptedPush(result);');
console.log(s.slice(Math.max(0,i-300), i+120));
