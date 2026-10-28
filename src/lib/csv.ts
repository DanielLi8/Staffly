/**
 * Prefix a value a spreadsheet would run as a formula with "'" (OWASP CSV
 * injection): a leading = + - @, or a leading tab / carriage return, which
 * Excel and Sheets strip before reading the formula behind it.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string): string {
  return `"${neutralizeSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}
