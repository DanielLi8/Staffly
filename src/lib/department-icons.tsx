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

export function getDepartmentIcon(iconKey: string): LucideIcon {
  return iconMap[iconKey] ?? Star;
}
