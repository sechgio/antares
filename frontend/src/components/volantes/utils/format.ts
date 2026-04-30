const dateFormatter = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});

const stripAccents = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export const toSlugId = (): string =>
  `flyer-${Math.random().toString(36).slice(2, 10)}`;

export const normalizeHeader = (value: string): string =>
  stripAccents(value).replace(/\s+/g, "_");

export const excelSerialToDate = (value: number): Date => {
  const base = new Date(Date.UTC(1899, 11, 30));
  const millis = value * 24 * 60 * 60 * 1000;
  return new Date(base.getTime() + millis);
};

export const normalizeDateInput = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const d = excelSerialToDate(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, dayRaw, monthRaw, yearRaw] = slashMatch;
    const day = dayRaw.padStart(2, "0");
    const month = monthRaw.padStart(2, "0");
    const year =
      yearRaw.length === 2 ? `20${yearRaw.padStart(2, "0")}` : yearRaw;

    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
};

export const normalizeTimeInput = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const dayTime = excelSerialToDate(value);
    const hh = String(dayTime.getHours()).padStart(2, "0");
    const mm = String(dayTime.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const basicTime = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?$/i);
  if (basicTime) {
    let hours = Number(basicTime[1]);
    const minutes = basicTime[2];
    const meridian = basicTime[3]?.replace(/\./g, "");

    if (meridian === "pm" && hours < 12) {
      hours += 12;
    }

    if (meridian === "am" && hours === 12) {
      hours = 0;
    }

    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  return null;
};

export const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

export const formatFlyerDateLine = (
  dateIso: string,
  startTime: string,
  endTime: string
): string => {
  if (!dateIso) {
    return "Fecha no disponible";
  }

  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible";
  }

  const prettyDate = dateFormatter.format(date);
  const normalizeFlyerTime = (timeValue: string): string => {
    const [hoursText, minutesText = "00"] = timeValue.split(":");
    const hours = Number(hoursText);
    const suffix = hours >= 12 ? "pm" : "am";
    return `${String(hours).padStart(2, "0")}:${minutesText} ${suffix}`;
  };

  const prettyStart = normalizeFlyerTime(startTime);
  const prettyEnd = normalizeFlyerTime(endTime);

  return `${capitalize(prettyDate)} de ${prettyStart} a ${prettyEnd}`;
};

export const sanitizeMultilineText = (value: string): string =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
