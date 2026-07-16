import TutorialOverlayBase, { type TutorialStep } from "../../ui/TutorialOverlay";

const steps: TutorialStep[] = [
  {
    title: "Paso 1: Importa tu Excel",
    description:
      "Haz clic en 'Excel' en la barra superior para abrir el importador. Arrastra o selecciona un archivo (.xlsx, .xls, .csv) con los datos del padron. Si hay varios registros, elige cual editar.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    selector: ".vpad-btn-excel",
  },
  {
    title: "Paso 2: Elige la plantilla",
    description:
      "Selecciona el formato de salida: Plantilla actual, volante lurigancho, volanteo lurigancho v2 o Aviso corte de agua. En plantillas de padron tambien puedes elegir orientacion Horizontal o Vertical.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 12h18" />
      </svg>
    ),
    selector: "#vpad-output-format",
  },
  {
    title: "Paso 3: Define el rango",
    description:
      "En el panel izquierdo, seccion 'Formato de salida', ajusta el total de items y el rango inicial/final que quieres incluir en el documento.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="9" x2="20" y2="9" />
        <line x1="4" y1="15" x2="20" y2="15" />
        <line x1="10" y1="3" x2="8" y2="21" />
        <line x1="16" y1="3" x2="14" y2="21" />
      </svg>
    ),
    selector: ".vpad-section-format",
  },
  {
    title: "Paso 4: Configura el foleado",
    description:
      "Usa el boton 'Foleado' para definir la numeracion de pagina (desde/hasta) e invertir el orden si lo necesitas. La vista previa muestra como quedara cada folio.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="9" x2="20" y2="9" />
        <line x1="4" y1="15" x2="14" y2="15" />
        <line x1="17" y1="13" x2="17" y2="17" />
        <line x1="15" y1="15" x2="19" y2="15" />
      </svg>
    ),
    selector: ".vpad-folio-wrapper",
  },
  {
    title: "Paso 5: Completa los datos",
    description:
      "Rellena o corrige los campos del encabezado: servicio, sector, fechas y demas datos. En 'Aviso corte de agua' veras campos especificos del aviso. Los cambios se reflejan al instante en la vista previa.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    selector: ".vpad-section-data",
  },
  {
    title: "Paso 6: Revisa la vista previa",
    description:
      "En el panel derecho revisa el padron paginado. Los badges muestran orientacion, cantidad de items y paginas. Usa la navegacion si hay mas de cinco paginas en pantalla.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    ),
    selector: ".vpad-preview-pane",
  },
  {
    title: "Paso 7: Exporta el documento",
    description:
      "Cuando todo este correcto, usa 'Descargar PDF' para generar el archivo. Tambien puedes 'Imprimir' directamente o 'Limpiar' para empezar un padron nuevo.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    selector: ".vpad-action-box",
  },
];

interface TutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TutorialOverlay({ isOpen, onClose }: TutorialOverlayProps) {
  return <TutorialOverlayBase isOpen={isOpen} onClose={onClose} steps={steps} />;
}