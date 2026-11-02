import TutorialOverlayBase, { type TutorialStep } from "../../ui/TutorialOverlay";
import {
  IconDownload,
  IconEdit,
  IconFolio,
  IconSliders,
  IconSplitLayout,
  IconTableRows,
  IconUpload,
} from "../../ui/tutorialIcons";

const steps: TutorialStep[] = [
  {
    title: "Paso 1: Importa tu Excel",
    description:
      "Haz clic en 'Excel' en la barra superior para abrir el importador. Arrastra o selecciona un archivo (.xlsx, .xls, .csv) con los datos del padron. Si hay varios registros, elige cual editar.",
    icon: <IconUpload />,
    selector: ".vpad-btn-excel",
  },
  {
    title: "Paso 2: Elige la plantilla",
    description:
      "Selecciona el formato de salida: Plantilla actual, volante lurigancho, volanteo lurigancho v2 o Aviso corte de agua. En plantillas de padron tambien puedes elegir orientacion Horizontal o Vertical.",
    icon: <IconSplitLayout />,
    selector: "#vpad-output-format",
  },
  {
    title: "Paso 3: Define el rango",
    description:
      "En el panel izquierdo, seccion 'Formato de salida', ajusta el total de items y el rango inicial/final que quieres incluir en el documento.",
    icon: <IconSliders />,
    selector: ".vpad-section-format",
  },
  {
    title: "Paso 4: Configura el foleado",
    description:
      "Usa el boton 'Foleado' para definir la numeracion de pagina (desde/hasta) e invertir el orden si lo necesitas. La vista previa muestra como quedara cada folio.",
    icon: <IconFolio />,
    selector: ".vpad-folio-wrapper",
  },
  {
    title: "Paso 5: Completa los datos",
    description:
      "Rellena o corrige los campos del encabezado: servicio, sector, fechas y demas datos. En 'Aviso corte de agua' veras campos especificos del aviso. Los cambios se reflejan al instante en la vista previa.",
    icon: <IconEdit />,
    selector: ".vpad-section-data",
  },
  {
    title: "Paso 6: Revisa la vista previa",
    description:
      "En el panel derecho revisa el padron paginado. Los badges muestran orientacion, cantidad de items y paginas. Usa la navegacion si hay mas de cinco paginas en pantalla.",
    icon: <IconTableRows />,
    selector: ".vpad-preview-pane",
  },
  {
    title: "Paso 7: Exporta el documento",
    description:
      "Cuando todo este correcto, usa 'Descargar PDF' para generar el archivo. Tambien puedes 'Imprimir' directamente o 'Limpiar' para empezar un padron nuevo.",
    icon: <IconDownload />,
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
