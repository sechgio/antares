import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, Clock } from "lucide-react";
import {
  formatTimeParts,
  MINUTE_STEP,
  parseTimeString,
  snapTimeToStep,
  stepTime,
} from "../utils/timeStep";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export default function TimePicker({
  value,
  onChange,
  label,
  className = "",
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatTime = (timeString: string) => {
    if (!timeString) return "Seleccionar hora";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const { hours, minutes } = parseTimeString(value);

  const handleHoursChange = (delta: number) => {
    const newHours = (hours + delta + 24) % 24;
    onChange(formatTimeParts({ hours: newHours, minutes }));
  };

  const handleMinutesChange = (direction: 1 | -1) => {
    onChange(formatTimeParts(stepTime({ hours, minutes }, direction)));
  };

  const handleNow = () => {
    const now = new Date();
    onChange(
      formatTimeParts(
        snapTimeToStep({
          hours: now.getHours(),
          minutes: now.getMinutes(),
        }),
      ),
    );
    setIsOpen(false);
  };

  return (
    <div className={`vgen-time-picker ${className}`} ref={pickerRef}>
      {label && <label className="vgen-label-sm">{label}</label>}
      <div
        className="vgen-time-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Clock className="vgen-time-picker-trigger-icon" size={16} />
        <span className="vgen-time-picker-trigger-value">
          {formatTime(value)}
        </span>
      </div>

      {isOpen && (
        <div className="vgen-time-picker-popup">
          <div className="vgen-time-picker-content">
            <div className="vgen-time-picker-column">
              <div className="vgen-time-picker-label">Hora</div>
              <div className="vgen-time-picker-controls">
                <button
                  onClick={() => handleHoursChange(1)}
                  className="vgen-time-picker-btn"
                  type="button"
                  aria-label="Aumentar hora"
                >
                  <ChevronUp size={18} />
                </button>
                <div className="vgen-time-picker-value">
                  {String(hours).padStart(2, "0")}
                </div>
                <button
                  onClick={() => handleHoursChange(-1)}
                  className="vgen-time-picker-btn"
                  type="button"
                  aria-label="Disminuir hora"
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            </div>

            <div className="vgen-time-picker-separator">:</div>

            <div className="vgen-time-picker-column">
              <div className="vgen-time-picker-label">Min</div>
              <div className="vgen-time-picker-controls">
                <button
                  onClick={() => handleMinutesChange(1)}
                  className="vgen-time-picker-btn"
                  type="button"
                  aria-label={`Aumentar ${MINUTE_STEP} minutos`}
                >
                  <ChevronUp size={18} />
                </button>
                <div className="vgen-time-picker-value">
                  {String(minutes).padStart(2, "0")}
                </div>
                <button
                  onClick={() => handleMinutesChange(-1)}
                  className="vgen-time-picker-btn"
                  type="button"
                  aria-label={`Disminuir ${MINUTE_STEP} minutos`}
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleNow}
            className="vgen-time-picker-now"
            type="button"
          >
            Ahora
          </button>
        </div>
      )}
    </div>
  );
}