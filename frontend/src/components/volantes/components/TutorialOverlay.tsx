import TutorialOverlayBase, { type TutorialStep } from "../../ui/TutorialOverlay";
import {
  IconDownload,
  IconEdit,
  IconGear,
  IconSplitLayout,
  IconTableRows,
  IconUpload,
} from "../../ui/tutorialIcons";

const steps: TutorialStep[] = [
  {
    title: "Paso 1: Importa tu Excel",
    description:
      "Haz clic en 'Importar' para cargar tu archivo Excel con los datos de los volantes. Tambien puedes descargar la 'Plantilla' para empezar con un formato correcto.",
    icon: <IconUpload />,
    selector: ".vgen-btn-import",
  },
  {
    title: "Paso 2: Selecciona un registro",
    description:
      "Abre el panel de 'Lotes' con el boton de la esquina inferior derecha. Selecciona el registro que quieres editar o genera uno nuevo.",
    icon: <IconTableRows />,
    selector: ".vgen-fab-records",
  },
  {
    title: "Paso 3: Edita los datos",
    description:
      "En el panel izquierdo puedes modificar: logos, distrito, reservorio, fecha, hora, sector y zonas afectadas. Los cambios se reflejan en tiempo real en la vista previa.",
    icon: <IconEdit />,
    selector: ".vgen-sidebar",
  },
  {
    title: "Paso 4: Ajusta el tamaño de texto",
    description:
      "Usa el boton de configuracion (engranaje) para abrir el panel de tamaño de textos. Ajusta cada campo para que queda perfectamente en tu volante.",
    icon: <IconGear />,
    selector: ".vgen-fab-size",
  },
  {
    title: "Paso 5: Elige el formato",
    description:
      "Selecciona '2 por hoja' o '3 por hoja' segun como quieras imprimir tus volantes. La vista previa se actualiza automaticamente.",
    icon: <IconSplitLayout />,
    selector: ".vgen-layout-toggle",
  },
  {
    title: "Paso 6: Exporta a PDF",
    description:
      "Cuando este todo listo, haz clic en 'Exportar Todo' para generar el PDF. Tambien puedes exportar registros individuales desde el panel de lotes.",
    icon: <IconDownload />,
    selector: ".vgen-btn-export-all",
  },
];

interface TutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TutorialOverlay({ isOpen, onClose }: TutorialOverlayProps) {
  return <TutorialOverlayBase isOpen={isOpen} onClose={onClose} steps={steps} />;
}
