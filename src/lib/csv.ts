export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string): string {
  return `"${neutralizeSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}
