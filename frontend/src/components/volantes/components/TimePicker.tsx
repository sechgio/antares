import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";
import {
  formatTimeParts,
  MINUTE_STEP,
  parseTimeString,
  snapTimeToStep,
} from "../utils/timeStep";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  /** Prefer popup alignment when near the right edge of the sidebar. */
  align?: "start" | "end" | "center";
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from(
  { length: Math.floor(60 / MINUTE_STEP) },
  (_, i) => i * MINUTE_STEP,
);

function formatDisplayTime(timeString: string): string {
  if (!timeString) return "Seleccionar hora";
  const [hoursText, minutes] = timeString.split(":");
  const hour = Number.parseInt(hoursText, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function ScrollList({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: number[];
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLElement>("[data-selected='true']");
    selected?.scrollIntoView({ block: "center" });
  }, [value]);

  return (
    <div className="vgen-time-list" aria-label={ariaLabel} ref={listRef}>
      {items.map((item) => {
        const selected = item === value;
        return (
          <button
            key={item}
            type="button"
            data-selected={selected ? "true" : "false"}
            className={`vgen-time-list-item${selected ? " is-selected" : ""}`}
            onClick={() => onChange(item)}
          >
            {String(item).padStart(2, "0")}
          </button>
        );
      })}
    </div>
  );
}

export default function TimePicker({
  value,
  onChange,
  label,
  className = "",
  align = "start",
}: TimePickerProps) {
  const { hours, minutes } = parseTimeString(value);
  const { isOpen, position, triggerRef, popupRef, toggle, close, updatePosition } =
    useAnchoredPopover({
      estimatedHeight: 220,
      estimatedWidth: 148,
      align,
    });

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, hours, minutes, updatePosition]);

  const commit = (nextHours: number, nextMinutes: number) => {
    onChange(formatTimeParts({ hours: nextHours, minutes: nextMinutes }));
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
    close();
  };

  return (
    <div className={`vgen-time-picker ${className}`}>
      {label && <label className="vgen-label-sm">{label}</label>}
      <button
        ref={triggerRef}
        type="button"
        className={`vgen-time-picker-trigger${isOpen ? " is-open" : ""}`}
        onClick={toggle}
        aria-expanded={isOpen}
      >
        <Clock className="vgen-time-picker-trigger-icon" size={13} />
        <span className="vgen-time-picker-trigger-value">
          {formatDisplayTime(value)}
        </span>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            className="vgen-time-picker-popup"
            role="dialog"
            aria-label="Elegir hora"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            <div className="vgen-time-picker-lists">
              <ScrollList
                items={HOURS}
                value={hours}
                onChange={(next) => commit(next, minutes)}
                ariaLabel="Hora"
              />
              <span className="vgen-time-picker-colon" aria-hidden="true">
                :
              </span>
              <ScrollList
                items={MINUTES}
                value={minutes}
                onChange={(next) => commit(hours, next)}
                ariaLabel="Minutos"
              />
            </div>
            <button
              type="button"
              className="vgen-time-picker-now"
              onClick={handleNow}
            >
              Ahora
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
