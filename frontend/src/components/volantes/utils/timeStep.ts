export const MINUTE_STEP = 1;
const MINUTES_PER_DAY = 24 * 60;

export interface TimeParts {
  hours: number;
  minutes: number;
}

export function parseTimeString(
  timeString: string,
  fallback: TimeParts = { hours: 8, minutes: 0 },
): TimeParts {
  if (!timeString) return fallback;
  const [hoursText, minutesText] = timeString.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return { hours, minutes };
}

export function formatTimeParts({ hours, minutes }: TimeParts): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeTotalMinutes(total: number): number {
  return ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function stepTime(
  { hours, minutes }: TimeParts,
  direction: 1 | -1,
  step = MINUTE_STEP,
): TimeParts {
  let total = hours * 60 + minutes;

  if (direction > 0) {
    const remainder = total % step;
    total += remainder === 0 ? step : step - remainder;
  } else {
    const remainder = total % step;
    total -= remainder === 0 ? step : remainder;
  }

  total = normalizeTotalMinutes(total);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function snapTimeToStep(
  { hours, minutes }: TimeParts,
  step = MINUTE_STEP,
): TimeParts {
  let total = Math.round((hours * 60 + minutes) / step) * step;
  total = normalizeTotalMinutes(total);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}