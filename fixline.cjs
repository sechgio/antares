const fs=require('fs');
const p='frontend/src/components/canvas/sync/canvasCloudSync.ts';
const lines=fs.readFileSync(p,'utf8').split('\n');
// lines array 0-based; target line 906 => index 905
console.log('before', JSON.stringify(lines[905]));
lines[905]='      } catch (err) {';
fs.writeFileSync(p, lines.join('\n'));
console.log('after', JSON.stringify(lines[905]));
