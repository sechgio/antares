const XLSX = require('xlsx');
const wb = XLSX.readFile('../aviso-plantilla.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
console.log('Sheet:', wb.SheetNames[0]);
console.log('Range:', ws['!ref']);
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
data.forEach((r, i) => console.log('Row', i, ':', JSON.stringify(r)));
