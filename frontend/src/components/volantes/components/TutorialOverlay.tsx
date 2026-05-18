import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
}

const steps: TutorialStep[] = [
  {
    title: "Paso 1: Importa tu Excel",
    description:
      "Haz clic en 'Importar' para cargar tu archivo Excel con los datos de los volantes. Tambien puedes descargar la 'Plantilla' para empezar con un formato correcto.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    title: "Paso 2: Selecciona un registro",
    description:
      "Abre el panel de 'Lotes' con el boton de la esquina inferior derecha. Selecciona el registro que quieres editar o genera uno nuevo.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    ),
  },
  {
    title: "Paso 3: Edita los datos",
    description:
      "En el panel izquierdo puedes modificar: logos, distrito, reservorio, fecha, hora, sector y zonas afectadas. Los cambios se reflejan en tiempo real en la vista previa.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    title: "Paso 4: Ajusta el tamaño de texto",
    description:
      "Usa el boton de configuracion (engranaje) para abrir el panel de tamaño de textos. Ajusta cada campo para que queda perfectamente en tu volante.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    title: "Paso 5: Elige el formato",
    description:
      "Selecciona '2 por hoja' o '3 por hoja' segun como quieras imprimir tus volantes. La vista previa se actualiza automaticamente.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 12h18" />
      </svg>
    ),
  },
  {
    title: "Paso 6: Exporta a PDF",
    description:
      "Cuando este todo listo, haz clic en 'Exportar Todo' para generar el PDF. Tambien puedes exportar registros individuales desde el panel de lotes.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
];

interface TutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TutorialOverlay({ isOpen, onClose }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="tutorial-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="tutorial-overlay"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <div className="tutorial-header">
              <button className="tutorial-close" onClick={onClose} title="Cerrar tutorial">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <span className="tutorial-step-counter">
                {currentStep + 1} / {steps.length}
              </span>
            </div>

            <div className="tutorial-progress-bar">
              <motion.div
                className="tutorial-progress-fill"
                initial={{ width: `${((currentStep) / steps.length) * 100}%` }}
                animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                className="tutorial-content"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25 }}
              >
                <div className="tutorial-icon">
                  <motion.div
                    initial={{ scale: 0, rotate: -10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 }}
                  >
                    {steps[currentStep].icon}
                  </motion.div>
                </div>

                <h2 className="tutorial-title">{steps[currentStep].title}</h2>
                <p className="tutorial-description">{steps[currentStep].description}</p>
              </motion.div>
            </AnimatePresence>

            <div className="tutorial-footer">
              <button
                className="tutorial-btn tutorial-btn-skip"
                onClick={handleSkip}
              >
                Omitir
              </button>

              <div className="tutorial-dots">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    className={`tutorial-dot ${i === currentStep ? "active" : ""}`}
                    onClick={() => setCurrentStep(i)}
                    aria-label={`Ir al paso ${i + 1}`}
                  />
                ))}
              </div>

              <div className="tutorial-nav-btns">
                {currentStep > 0 && (
                  <button
                    className="tutorial-btn tutorial-btn-secondary"
                    onClick={handlePrev}
                  >
                    Anterior
                  </button>
                )}
                <button
                  className="tutorial-btn tutorial-btn-primary"
                  onClick={handleNext}
                >
                  {currentStep === steps.length - 1 ? "Listo!" : "Siguiente"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
