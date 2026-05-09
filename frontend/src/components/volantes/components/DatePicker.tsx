import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export default function DatePicker({ value, onChange, label, className = "" }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
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

  useEffect(() => {
    if (value) {
      const date = new Date(value + "T00:00:00");
      setCurrentMonth(date);
    }
  }, [value]);

  const formatDate = (dateString: string) => {
    if (!dateString) return "Seleccionar fecha";
    const date = new Date(dateString + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (date: Date) => {
    if (!value) return false;
    const selected = new Date(value + "T00:00:00");
    return (
      date.getDate() === selected.getDate() &&
      date.getMonth() === selected.getMonth() &&
      date.getFullYear() === selected.getFullYear()
    );
  };

  const handleDateClick = (date: Date) => {
    const formatted = date.toISOString().split("T")[0];
    onChange(formatted);
    setIsOpen(false);
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const handleToday = () => {
    const today = new Date();
    const formatted = today.toISOString().split("T")[0];
    onChange(formatted);
    setCurrentMonth(today);
    setIsOpen(false);
  };

  const weekDays = ["D", "L", "M", "M", "J", "V", "S"];
  const monthNames = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
  ];

  const days = getDaysInMonth(currentMonth);

  return (
    <div className={`vgen-date-picker ${className}`} ref={pickerRef}>
      {label && <label className="vgen-label-sm">{label}</label>}
      <div className="vgen-date-picker-trigger" onClick={() => setIsOpen(!isOpen)}>
        <Calendar className="vgen-date-picker-trigger-icon" size={16} />
        <span className="vgen-date-picker-trigger-value">{formatDate(value)}</span>
      </div>

      {isOpen && (
        <div className="vgen-date-picker-popup">
          <div className="vgen-date-picker-header">
            <button onClick={handlePrevMonth} className="vgen-date-picker-nav">
              <ChevronLeft size={18} />
            </button>
            <span className="vgen-date-picker-month">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </span>
            <button onClick={handleNextMonth} className="vgen-date-picker-nav">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="vgen-date-picker-weekdays">
            {weekDays.map((day) => (
              <div key={day} className="vgen-date-picker-weekday">
                {day}
              </div>
            ))}
          </div>

          <div className="vgen-date-picker-days">
            {days.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="vgen-date-picker-day empty" />;
              }
              return (
                <button
                  key={date.toISOString()}
                  onClick={() => handleDateClick(date)}
                  className={`vgen-date-picker-day ${isSelected(date) ? "selected" : ""} ${isToday(date) ? "today" : ""}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <button onClick={handleToday} className="vgen-date-picker-today">
            Hoy
          </button>
        </div>
      )}
    </div>
  );
}
