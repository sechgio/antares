import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, Clock } from "lucide-react";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export default function TimePicker({ value, onChange, label, className = "" }: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
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

  const parseTime = (timeString: string) => {
    if (!timeString) return { hours: 8, minutes: 0 };
    const [hours, minutes] = timeString.split(":").map(Number);
    return { hours: hours || 8, minutes: minutes || 0 };
  };

  const { hours, minutes } = parseTime(value);

  const handleHoursChange = (delta: number) => {
    const newHours = (hours + delta + 24) % 24;
    const formatted = `${String(newHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    onChange(formatted);
  };

  const handleMinutesChange = (delta: number) => {
    const newMinutes = (minutes + delta + 60) % 60;
    const formatted = `${String(hours).padStart(2, "0")}:${String(newMinutes).padStart(2, "0")}`;
    onChange(formatted);
  };

  const handleNow = () => {
    const now = new Date();
    const formatted = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    onChange(formatted);
    setIsOpen(false);
  };

  return (
    <div className={`vgen-time-picker ${className}`} ref={pickerRef}>
      {label && <label className="vgen-label-sm">{label}</label>}
      <div className="vgen-time-picker-trigger" onClick={() => setIsOpen(!isOpen)}>
        <Clock className="vgen-time-picker-trigger-icon" size={16} />
        <span className="vgen-time-picker-trigger-value">{formatTime(value)}</span>
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
                >
                  <ChevronUp size={18} />
                </button>
                <div className="vgen-time-picker-value">
                  {String(hours).padStart(2, "0")}
                </div>
                <button
                  onClick={() => handleHoursChange(-1)}
                  className="vgen-time-picker-btn"
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
                  onClick={() => handleMinutesChange(10)}
                  className="vgen-time-picker-btn"
                >
                  <ChevronUp size={18} />
                </button>
                <div className="vgen-time-picker-value">
                  {String(minutes).padStart(2, "0")}
                </div>
                <button
                  onClick={() => handleMinutesChange(-10)}
                  className="vgen-time-picker-btn"
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            </div>
          </div>

          <button onClick={handleNow} className="vgen-time-picker-now">
            Ahora
          </button>
        </div>
      )}
    </div>
  );
}
