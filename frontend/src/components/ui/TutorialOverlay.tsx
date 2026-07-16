import { useState, useEffect, useCallback, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import "./tutorial-overlay.css";

export interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  selector?: string;
}

interface TutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  steps: TutorialStep[];
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function TutorialOverlay({ isOpen, onClose, steps }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const maskId = useId().replace(/:/g, "");

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  const measureTarget = useCallback(() => {
    const activeStep = steps[currentStep];
    if (!activeStep?.selector) {
      setTargetRect(null);
      return;
    }
    const element = document.querySelector(activeStep.selector);
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect((prev) => {
          if (
            prev &&
            Math.abs(prev.top - rect.top) < 1 &&
            Math.abs(prev.left - rect.left) < 1 &&
            Math.abs(prev.width - rect.width) < 1 &&
            Math.abs(prev.height - rect.height) < 1
          ) {
            return prev;
          }
          return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          };
        });
        return;
      }
    }
    setTargetRect(null);
  }, [currentStep, steps]);

  useEffect(() => {
    if (!isOpen) {
      setTargetRect(null);
      return;
    }

    measureTarget();
    const timer = setTimeout(measureTarget, 200);

    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);

    const observer = new MutationObserver(measureTarget);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
      observer.disconnect();
    };
  }, [isOpen, measureTarget]);

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

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="tutorial-backdrop-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <svg
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              <defs>
                {targetRect && (
                  <mask id={maskId}>
                    <rect x="0" y="0" width="100%" height="100%" fill="white" />
                    <motion.rect
                      animate={{
                        x: targetRect.left - 8,
                        y: targetRect.top - 8,
                        width: targetRect.width + 16,
                        height: targetRect.height + 16,
                      }}
                      transition={{ type: "spring", stiffness: 300, damping: 28 }}
                      rx="12"
                      ry="12"
                      fill="black"
                    />
                  </mask>
                )}
              </defs>
              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(0, 0, 0, 0.65)"
                mask={targetRect ? `url(#${maskId})` : undefined}
              />
            </svg>
          </motion.div>

          {targetRect && (
            <motion.div
              ref={spotlightRef}
              className="tutorial-spotlight-ring"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                x: targetRect.left - 8,
                y: targetRect.top - 8,
                width: targetRect.width + 16,
                height: targetRect.height + 16,
              }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            />
          )}

          <motion.div
            className="tutorial-overlay"
            initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-45%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.9, x: "-50%", y: "-45%" }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <div className="tutorial-header">
              <WithHoverTooltip label="Cerrar tutorial" placement="bottom">
                <button className="tutorial-close" onClick={onClose} aria-label="Cerrar tutorial" type="button">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </WithHoverTooltip>
              <span className="tutorial-step-counter">
                {currentStep + 1} / {steps.length}
              </span>
            </div>

            <div className="tutorial-progress-bar">
              <motion.div
                className="tutorial-progress-fill"
                initial={{ width: `${(currentStep / steps.length) * 100}%` }}
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
              <button className="tutorial-btn tutorial-btn-skip" onClick={onClose} type="button">
                Omitir
              </button>

              <div className="tutorial-dots">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    className={`tutorial-dot ${i === currentStep ? "active" : ""}`}
                    onClick={() => setCurrentStep(i)}
                    aria-label={`Ir al paso ${i + 1}`}
                    type="button"
                  />
                ))}
              </div>

              <div className="tutorial-nav-btns">
                {currentStep > 0 && (
                  <button
                    className="tutorial-btn tutorial-btn-secondary"
                    onClick={handlePrev}
                    type="button"
                  >
                    Anterior
                  </button>
                )}
                <button
                  className="tutorial-btn tutorial-btn-primary"
                  onClick={handleNext}
                  type="button"
                >
                  {currentStep === steps.length - 1 ? "Listo!" : "Siguiente"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
