import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
}

const WEEK_DAYS = ['DO', 'LU', 'MA', 'MI', 'JU', 'VI', 'SA'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const POPUP_GAP = 6;
const POPUP_EST_HEIGHT = 268;
const POPUP_EST_WIDTH = 248;

type CalendarDay = {
  date: Date;
  outside: boolean;
};

type PopupPosition = {
  top: number;
  left: number;
  width: number;
};

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDisplayDate(value: string, placeholder: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return placeholder;
  return parsed.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getCalendarDays(month: Date): CalendarDay[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingEmpty = firstDay.getDay();
  const days: CalendarDay[] = [];

  const previousMonthDays = new Date(year, monthIndex, 0).getDate();
  for (let index = leadingEmpty - 1; index >= 0; index -= 1) {
    days.push({
      date: new Date(year, monthIndex - 1, previousMonthDays - index),
      outside: true,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push({ date: new Date(year, monthIndex, day), outside: false });
  }

  while (days.length % 7 !== 0) {
    const nextDay = days.length - leadingEmpty - daysInMonth + 1;
    days.push({ date: new Date(year, monthIndex + 1, nextDay), outside: true });
  }

  return days;
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getDate() === right.getDate()
    && left.getMonth() === right.getMonth()
    && left.getFullYear() === right.getFullYear()
  );
}

export default function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Seleccionar',
  className = '',
  disabled = false,
  clearable = true,
  size = 'md',
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => parseIsoDate(value) ?? new Date());

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const height = popupRef.current?.offsetHeight ?? POPUP_EST_HEIGHT;
    const width = Math.min(
      Math.max(POPUP_EST_WIDTH, rect.width),
      window.innerWidth - 16,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < height + POPUP_GAP && rect.top > spaceBelow;

    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = openUp
      ? Math.max(8, rect.top - height - POPUP_GAP)
      : Math.min(rect.bottom + POPUP_GAP, window.innerHeight - height - 8);

    setPosition({ top, left, width });
  }, []);

  useEffect(() => {
    const parsed = parseIsoDate(value);
    if (parsed) setCurrentMonth(parsed);
  }, [value]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [isOpen, currentMonth, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    const handleLayout = () => updatePosition();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleLayout);
    window.addEventListener('scroll', handleLayout, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleLayout);
      window.removeEventListener('scroll', handleLayout, true);
    };
  }, [isOpen, updatePosition]);

  const selectedDate = parseIsoDate(value);
  const today = new Date();
  const days = getCalendarDays(currentMonth);
  const triggerSizeClass =
    size === 'sm'
      ? 'app-date-picker-trigger-sm'
      : size === 'lg'
        ? 'app-date-picker-trigger-lg'
        : 'app-date-picker-trigger-md';

  const handleSelect = (date: Date) => {
    onChange(toIsoDateLocal(date));
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const handleToday = () => {
    const next = new Date();
    onChange(toIsoDateLocal(next));
    setCurrentMonth(next);
    setIsOpen(false);
  };

  return (
    <div className={`app-date-picker ${className}`}>
      {label && (
        <label className="app-date-picker-label">
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={`app-date-picker-trigger ${triggerSizeClass} ${isOpen ? 'is-open' : ''}`}
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={popupId}
      >
        <Calendar
          className="app-date-picker-trigger-icon"
          size={size === 'sm' ? 13 : size === 'lg' ? 16 : 15}
          strokeWidth={2}
        />
        <span className={`app-date-picker-trigger-value ${value ? '' : 'is-placeholder'}`}>
          {formatDisplayDate(value, placeholder)}
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popupRef}
            id={popupId}
            className="app-date-picker-popup"
            role="dialog"
            aria-label={ariaLabel || label || 'Selector de fecha'}
            style={
              position
                ? { top: position.top, left: position.left, width: position.width }
                : { top: -9999, left: -9999, visibility: 'hidden' }
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="app-date-picker-header">
              <button
                type="button"
                className="app-date-picker-nav"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                aria-label="Mes anterior"
              >
                <ChevronLeft size={15} strokeWidth={2} />
              </button>

              <div className="app-date-picker-month">
                {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </div>

              <button
                type="button"
                className="app-date-picker-nav"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                aria-label="Mes siguiente"
              >
                <ChevronRight size={15} strokeWidth={2} />
              </button>
            </div>

            <div className="app-date-picker-weekdays">
              {WEEK_DAYS.map((day) => (
                <div key={day} className="app-date-picker-weekday">
                  {day}
                </div>
              ))}
            </div>

            <div className="app-date-picker-days">
              {days.map(({ date, outside }) => {
                const selected = selectedDate ? isSameDay(date, selectedDate) : false;
                const isToday = isSameDay(date, today);

                return (
                  <button
                    key={`${date.toISOString()}-${outside ? 'outside' : 'inside'}`}
                    type="button"
                    onClick={() => handleSelect(date)}
                    className={[
                      'app-date-picker-day',
                      outside ? 'is-outside' : '',
                      selected ? 'is-selected' : '',
                      isToday ? 'is-today' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="app-date-picker-footer">
              {clearable && (
                <button type="button" className="app-date-picker-action" onClick={handleClear}>
                  Borrar
                </button>
              )}
              <button type="button" className="app-date-picker-action is-primary" onClick={handleToday}>
                Hoy
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
