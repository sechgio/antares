import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ThemedSelect from './components/ui/ThemedSelect';
import { DialogSurface } from './components/ui/Dialog';
function Harness() {
 const [open, setOpen] = useState(false);
 const [value, setValue] = useState('10');
 return <main className="p-8"><h1>Verificación aislada de controles — Antares</h1><p>Datos de prueba; no es una sesión de escritorio.</p><button onClick={() => setOpen(true)}>Abrir ajustes de prueba</button>{open && <DialogSurface onClose={() => setOpen(false)} labelledBy="title"><h2 id="title">Ajustes de prueba</h2><ThemedSelect aria-label="Cantidad" value={value} onChange={setValue} options={[{value:'10',label:'10 registros'},{value:'20',label:'20 registros'}]}/><button onClick={() => setOpen(false)}>Cerrar</button></DialogSurface>}</main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
