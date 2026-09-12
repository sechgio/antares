import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useAnchoredPopover } from "../../../hooks/useAnchoredPopover";
import { isSameDate, parseIsoDateLocal, toIsoDateLocal } from "../../../utils/dates";
import { buildMonthCalendar, formatDate } from "../../../utils/datePickerCalendar";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

const WEEK_DAYS = ["D", "L", "M", "M", "J", "V", "S"];
const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export default function DatePicker({
  value,
  onChange,
  label,
  className = "",
}: DatePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(() => parseIsoDateLocal(value) ?? new Date());
  const { isOpen, position, triggerRef, popupRef, toggle, close, updatePosition } =
    useAnchoredPopover({
      estimatedHeight: 300,
      estimatedWidth: 260,
      align: "start",
    });

  useEffect(() => {
    const parsed = parseIsoDateLocal(value);
    if (parsed) setCurrentMonth(parsed);
  }, [value]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, currentMonth, updatePosition]);

  const days = buildMonthCalendar(currentMonth, false);

  const isToday = (date: Date) => isSameDate(date, new Date());

  const isSelected = (date: Date) => {
    const selected = parseIsoDateLocal(value);
    return selected !== null && isSameDate(date, selected);
  };

  const selectDate = (date: Date) => {
    onChange(toIsoDateLocal(date));
    close();
  };

  const selectToday = () => {
    const today = new Date();
    selectDate(today);
    setCurrentMonth(today);
  };

  return (
    <div className={`vgen-date-picker ${className}`}>
      {label && <label className="vgen-label-sm">{label}</label>}
      <button
        ref={triggerRef}
        type="button"
        className={`vgen-date-picker-trigger${isOpen ? " is-open" : ""}`}
        onClick={toggle}
        aria-expanded={isOpen}
      >
        <Calendar className="vgen-date-picker-trigger-icon" size={13} />
        <span className="vgen-date-picker-trigger-value">
          {formatDate(value ? new Date(`${value}T00:00:00`) : null, "Seleccionar fecha")}
        </span>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            className="vgen-date-picker-popup"
            role="dialog"
            aria-label="Elegir fecha"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            <div className="vgen-date-picker-header">
              <button
                type="button"
                className="vgen-date-picker-nav"
                onClick={() =>
                  setCurrentMonth(
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1),
                  )
                }
                aria-label="Mes anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="vgen-date-picker-month">
                {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </span>
              <button
                type="button"
                className="vgen-date-picker-nav"
                onClick={() =>
                  setCurrentMonth(
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1),
                  )
                }
                aria-label="Mes siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="vgen-date-picker-weekdays">
              {WEEK_DAYS.map((day, index) => (
                <div key={`${day}-${index}`} className="vgen-date-picker-weekday">
                  {day}
                </div>
              ))}
            </div>

            <div className="vgen-date-picker-days">
              {days.map(({ date }, index) => {
                if (!date) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="vgen-date-picker-day empty"
                    />
                  );
                }
                return (
                  <button
                    key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
                    type="button"
                    onClick={() => selectDate(date)}
                    className={[
                      "vgen-date-picker-day",
                      isSelected(date) ? "selected" : "",
                      isToday(date) ? "today" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="vgen-date-picker-today"
              onClick={selectToday}
            >
              Hoy
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
