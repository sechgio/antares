// Fachada del bridge IPC: la maquinaria vive en api/core.ts y los wrappers por
// dominio en api/<dominio>Api.ts. Este archivo solo compone y re-exporta para
// que los consumidores sigan importando desde '../api'.
import { createAutoimgApi } from './api/autoimgApi';
import { resetCanvasHistoryTransportForTests } from './api/canvasHistoryTransport';
import { canvasApi } from './api/canvasApi';
import { catalogApi } from './api/catalogApi';
import { conversionApi } from './api/conversionApi';
import { _invoke } from './api/core';
import { evidenciaVolanteoApi } from './api/evidenciaVolanteoApi';
import { formatosApi } from './api/formatosApi';
import { historyApi } from './api/historyApi';
import { panelAvisoCorteApi } from './api/panelAvisoCorteApi';
import { reportsApi } from './api/reportsApi';
import { selladorApi } from './api/selladorApi';
import { spreadsheetApi } from './api/spreadsheetApi';
import { systemApi } from './api/systemApi';
import { toolsApi } from './api/toolsApi';
import { ubicacionesApi } from './api/ubicacionesApi';

export type { ProcessStatus, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, MappingResult } from './types';

export {
  AntaresAPIError,
  apiRetryAfterMs,
  getBackendStatus,
  invalidateApiCache,
  onNotify,
  restartBackend,
  _resetBackendReadyForTests,
} from './api/core';
export type { APIErrorCategory, BackendHealthStatus, BackendStatus } from './api/core';
export type { FileDialogResult } from './api/systemApi';
export type { PreviewBody, PreviewResult, ProcessBody, SequenceMode } from './api/conversionApi';
export type { FormatosGenerateResponse } from './api/formatosApi';
export type { CanvasExportCmykPdfBody } from './api/canvasApi';
export type {
  FichasTecnicasImportBody,
  FichasTecnicasListBody,
  FichasTecnicasRenderBody,
  InformesV2ImportBody,
  InformesV2ListBody,
  InformesV2RenderBody,
  TechnicalReportsImportBody,
  TechnicalReportsListBody,
  TechnicalReportsRenderBody,
} from './api/reportsApi';
export type {
  GenerarUbicacionesData,
  GenerarUbicacionesParams,
  GenerarUbicacionesResponse,
  PreviewUbicacionParams,
  PreviewUbicacionResponse,
} from './api/ubicacionesApi';
export type {
  HtmlToPdfBody,
  HtmlToPdfResponse,
  ImageOptimizerSaveFilesResponse,
} from './api/toolsApi';

export function _resetCanvasHistoryTransportForTests(): void {
  resetCanvasHistoryTransportForTests();
}

export const api = {
  ...systemApi,
  ...conversionApi,
  ...catalogApi,
  ...historyApi,
  ...formatosApi,
  ...canvasApi,
  ...toolsApi,
  ...reportsApi,
  ...selladorApi,
  ...spreadsheetApi,
  ...ubicacionesApi,
  ...panelAvisoCorteApi,
  ...evidenciaVolanteoApi,
  ...createAutoimgApi(_invoke),
};
