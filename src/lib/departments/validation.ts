/**
 * Department rules for the Staff page's department list, pure so the inline
 * form shows the same messages the server action returns. The icon keys are
 * passed in (see `DEPARTMENT_ICON_KEYS`) so this stays free of React imports.
 */

export const DEPARTMENT_MESSAGES = {
  nameRequired: "Enter the department name",
  nameTooLong: "Keep the name under 60 characters",
  codeInvalid: "Use 2-8 letters or digits, e.g. ER or MED",
  codeTaken: "Another department already uses this code",
  wingTooLong: "Keep the wing under 40 characters",
  iconInvalid: "Pick one of the icons",
} as const;

export type DepartmentField = "name" | "code" | "wing" | "iconKey";
export type DepartmentFieldErrors = Partial<Record<DepartmentField, string>>;

export interface DepartmentFormInput {
  name: string;
  code: string;
  wing: string;
  iconKey: string;
}

export interface DepartmentRecord {
  name: string;
  code: string;
  wing: string | null;
  iconKey: string;
}

export type DepartmentValidation =
  | { ok: true; record: DepartmentRecord }
  | { ok: false; fieldErrors: DepartmentFieldErrors };

export function validateDepartmentInput(
  input: DepartmentFormInput,
  iconKeys: readonly string[]
): DepartmentValidation {
  const errors: DepartmentFieldErrors = {};

  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = DEPARTMENT_MESSAGES.nameRequired;
  else if (name.length > 60) errors.name = DEPARTMENT_MESSAGES.nameTooLong;

  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(code)) errors.code = DEPARTMENT_MESSAGES.codeInvalid;

  const wing = input.wing.trim().replace(/\s+/g, " ") || null;
  if (wing && wing.length > 40) errors.wing = DEPARTMENT_MESSAGES.wingTooLong;

  if (!iconKeys.includes(input.iconKey)) errors.iconKey = DEPARTMENT_MESSAGES.iconInvalid;

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return { ok: true, record: { name, code, wing, iconKey: input.iconKey } };
}
