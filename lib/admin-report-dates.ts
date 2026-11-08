const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatLocalDateInput(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDateRange(value: string): { start: Date; end: Date } | null {
  const match = DATE_INPUT_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day);
  if (formatLocalDateInput(start) !== value) return null;

  const nextDay = new Date(year, month - 1, day + 1);
  return { start, end: new Date(nextDay.getTime() - 1) };
}

export function formatLocalReportDate(date: Date): string {
  return formatLocalDateInput(date);
}

export function formatLocalReportMonth(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
