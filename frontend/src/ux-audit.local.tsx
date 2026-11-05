import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import PreviewPanelView from './components/preview-panel/PreviewPanelView';
import { ToastProvider } from './hooks/useToast';
import Toast from './components/ui/Toast';
import { api } from './api';
let fileName = '';
Object.defineProperty(window, 'electronAPI', { value: {
 fileStagedCreate: async (name: string) => {fileName = name; return {token: 'fixture'};},
 fileStagedAppend: async () => ({}), fileStagedComplete: async () => ({file_token:'fixture'}),
 onNotify: () => () => {}, getBackendStatus: async () => ({state:'ready'}),
}, configurable: true });
Object.assign(api, {
 templatesList: async () => ({templates:[]}),
 spreadsheetParse: async () => {
  if (fileName === 'empty.csv') return {workbookName:fileName,sheets:[{name:'Vacía',rows:[['SGIO']]}],warnings:[]};
  return {workbookName:fileName,sheets:[],warnings:[],result_file_token:'fixture-spill',sheet_meta:[{name:'Original',rowCount:2},{name:'Fallida',rowCount:2}]};
 },
 spreadsheetGetRows: async ({sheet}: {sheet:string}) => {
  if (sheet === 'Fallida') {await new Promise(r => setTimeout(r, 500)); throw new Error('No se pudo cargar la hoja de prueba');}
  return {name:sheet,rows:[['SGIO'],['REGISTRO-DE-PRUEBA']],offset:0,limit:2000,total:2,has_more:false};
 },
 fileTokenCleanup: async () => ({cleaned:true}),
});
createRoot(document.getElementById('root')!).render(<ToastProvider><header style={{padding:8, background:'#fef3c7', color:'#111'}}>Verificación aislada — datos sintéticos; backend simulado, sin exportación real</header><PreviewPanelView/><Toast/></ToastProvider>);
