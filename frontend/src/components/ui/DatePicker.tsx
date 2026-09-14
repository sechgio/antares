import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { isSameDate, monthStart, parseIsoDateLocal, toIsoDateLocal } from '../../utils/dates';
import { buildMonthCalendar, formatIsoDate } from '../../utils/datePickerCalendar';

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

const POPUP_EST_HEIGHT = 268;
const POPUP_EST_WIDTH = 248;

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
  const triggerId = useId();
  const { isOpen, position, triggerRef, popupRef, open, close, updatePosition } =
    useAnchoredPopover({
      estimatedHeight: POPUP_EST_HEIGHT,
      estimatedWidth: POPUP_EST_WIDTH,
    });
  const focusedDayRef = useRef<HTMLButtonElement>(null);
  const [currentMonth, setCurrentMonth] = useState(() => parseIsoDateLocal(value) ?? new Date());
  const [focusedDate, setFocusedDate] = useState(() => parseIsoDateLocal(value) ?? new Date());

  useEffect(() => {
    const parsed = parseIsoDateLocal(value);
    if (parsed) {
      setCurrentMonth(parsed);
      setFocusedDate(parsed);
    }
  }, [value]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, currentMonth, updatePosition]);

  useFocusTrap(popupRef, isOpen, focusedDayRef);

  useEffect(() => {
    if (isOpen) focusedDayRef.current?.focus({ preventScroll: true });
  }, [focusedDate, isOpen]);

  const selectedDate = parseIsoDateLocal(value);
  const today = new Date();
  const days = buildMonthCalendar(currentMonth, true);
  const triggerSizeClass =
    size === 'sm'
      ? 'app-date-picker-trigger-sm'
      : size === 'lg'
        ? 'app-date-picker-trigger-lg'
        : 'app-date-picker-trigger-md';

  const handleSelect = (date: Date) => {
    setFocusedDate(date);
    onChange(toIsoDateLocal(date));
    close();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const openCalendar = () => {
    const nextDate = selectedDate ?? new Date();
    setFocusedDate(nextDate);
    setCurrentMonth(monthStart(nextDate));
    open();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCalendar();
    }
  };

  const handleDayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, date: Date) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(date);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }

    const nextDate = new Date(date);
    if (event.key === 'ArrowLeft') nextDate.setDate(nextDate.getDate() - 1);
    else if (event.key === 'ArrowRight') nextDate.setDate(nextDate.getDate() + 1);
    else if (event.key === 'ArrowUp') nextDate.setDate(nextDate.getDate() - 7);
    else if (event.key === 'ArrowDown') nextDate.setDate(nextDate.getDate() + 7);
    else if (event.key === 'Home') nextDate.setDate(nextDate.getDate() - nextDate.getDay());
    else if (event.key === 'End') nextDate.setDate(nextDate.getDate() + (6 - nextDate.getDay()));
    else return;

    event.preventDefault();
    setFocusedDate(nextDate);
    setCurrentMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  };

  const handleClear = () => {
    onChange('');
    close();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const handleToday = () => {
    const next = new Date();
    onChange(toIsoDateLocal(next));
    setCurrentMonth(next);
    close();
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className={`app-date-picker ${className}`}>
      {label && (
        <label htmlFor={triggerId} className="app-date-picker-label">
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`app-date-picker-trigger ${triggerSizeClass} ${isOpen ? 'is-open' : ''}`}
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            close();
            triggerRef.current?.focus({ preventScroll: true });
          } else {
            openCalendar();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
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
          {formatIsoDate(value, placeholder)}
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
            aria-modal="true"
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
                onClick={() => {
                  const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
                  setCurrentMonth(nextMonth);
                  setFocusedDate(nextMonth);
                }}
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
                onClick={() => {
                  const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
                  setCurrentMonth(nextMonth);
                  setFocusedDate(nextMonth);
                }}
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
                if (!date) return null;
                const selected = selectedDate ? isSameDate(date, selectedDate) : false;
                const isToday = isSameDate(date, today);

                return (
                  <button
                    key={`${date.toISOString()}-${outside ? 'outside' : 'inside'}`}
                    type="button"
                    ref={isSameDate(date, focusedDate) ? focusedDayRef : undefined}
                    tabIndex={isSameDate(date, focusedDate) ? 0 : -1}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={date.toLocaleDateString('es-ES', { dateStyle: 'full' })}
                    onKeyDown={(event) => handleDayKeyDown(event, date)}
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
