import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Cross,
  Heart,
  ScanLine,
  Scissors,
  Star,
  Stethoscope,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  star: Star,
  activity: Activity,
  heart: Heart,
  cross: Cross,
  scalpel: Scissors,
  scan: ScanLine,
  stethoscope: Stethoscope,
};

/** Every icon an admin can pick for a department, in picker order. */
export const DEPARTMENT_ICON_KEYS = Object.keys(iconMap);

export function getDepartmentIcon(iconKey: string): LucideIcon {
  return iconMap[iconKey] ?? Star;
}
