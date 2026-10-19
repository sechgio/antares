const fs=require('fs');
const s=fs.readFileSync('frontend/src/components/canvas/sync/canvasCloudSync.ts','utf8');
console.log('replay idx', s.indexOf('await replayPendingCanvasDeletes();'));
console.log('publish idx', s.indexOf('await publishAcceptedPush(result);'));
