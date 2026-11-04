/**
 * The supplemental demo roster the month generator staffs departments with.
 * PURE: no DB.
 *
 * The base seed has five staff across three departments, nowhere near enough
 * to fill a month of shifts on six units. For each department and counting
 * role (RN / RPN / PSW) this tops the roster up to `rosterTarget`, counting
 * the department's existing members first. Users are keyed by a deterministic
 * email (`<dept>-<role>-<n>@demo.staffly.com`) so re-running never creates a
 * second copy; they are NOT month-scoped and are never deleted by the
 * generator.
 */
import { STAFFING_ROLES, STAFFING_ROLE_LABELS, staffingRoleOf } from "@/lib/roles/staffing-role";
import { patternFor, rosterTarget } from "./patterns";
import { hashString } from "./random";

export const DEMO_EMAIL_DOMAIN = "demo.staffly.com";

export interface RosterDepartment {
  id: string;
  code: string;
  name: string;
}

export interface ExistingMember {
  departmentId: string;
  position: string | null;
  isTeamLead: boolean;
}

export interface DemoStaffSpec {
  email: string;
  name: string;
  position: string;
  departmentId: string;
  departmentName: string;
  /** DepartmentMembership.title. */
  title: string;
  isTeamLead: boolean;
  hireDate: Date;
}

const FIRST_NAMES = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Lucas", "Mia", "Benjamin",
  "Chloe", "Adrian", "Zoe", "Samuel", "Grace", "Owen", "Hannah", "Isaac", "Leah", "Gabriel",
  "Nadia", "Omar", "Fatima", "Ravi", "Mei", "Kenji", "Anika", "Mateo", "Lucia", "Tariq",
  "Amara", "Kwame", "Ines", "Diego", "Sana", "Arjun", "Yara", "Hugo", "Elena", "Malik",
  "Rosa", "Felix", "Naomi", "Victor", "Julia", "Andre", "Leila", "Marcus", "Simone", "Ahmed",
];

const LAST_NAMES = [
  "Tremblay", "Gagnon", "Roy", "Wong", "Singh", "MacDonald", "Campbell", "Li", "Bouchard", "Martin",
  "Brown", "Wilson", "Taylor", "Chen", "Ahmed", "Fernandes", "Kowalski", "Murphy", "Osei", "Haddad",
  "Nakamura", "Rossi", "Silva", "Bergeron", "Mensah", "Kaur", "Dubois", "Lopez", "Ivanova", "Park",
];

/** Deterministic, collision-free display names for `count` people (in order). */
function nameSequence(count: number, taken: Set<string>): string[] {
  const names: string[] = [];
  let i = 0;
  while (names.length < count) {
    const h = hashString(`demo-name-${i++}`);
    const name = `${FIRST_NAMES[h % FIRST_NAMES.length]} ${LAST_NAMES[(h >>> 8) % LAST_NAMES.length]}`;
    if (taken.has(name)) continue;
    taken.add(name);
    names.push(name);
  }
  return names;
}

/**
 * The demo staff each department needs on top of `existing` members. A
 * department with no team lead gets its first demo RN tagged as one.
 */
export function planDemoRoster(
  departments: RosterDepartment[],
  existing: ExistingMember[],
  takenNames: Set<string>
): DemoStaffSpec[] {
  const wanted: Array<Omit<DemoStaffSpec, "name">> = [];

  for (const dept of departments) {
    const pattern = patternFor(dept.code);
    const members = existing.filter((m) => m.departmentId === dept.id);
    let needsLead = !members.some((m) => m.isTeamLead);

    for (const role of STAFFING_ROLES) {
      const have = members.filter((m) => staffingRoleOf(m.position) === role).length;
      const target = rosterTarget(pattern, role);
      for (let n = have + 1; n <= target; n++) {
        const lead = role === "RN" && needsLead;
        if (lead) needsLead = false;
        wanted.push({
          email: `${dept.code.toLowerCase()}-${role.toLowerCase()}-${n}@${DEMO_EMAIL_DOMAIN}`,
          position: STAFFING_ROLE_LABELS[role],
          departmentId: dept.id,
          departmentName: dept.name,
          title: lead ? "Lead RN" : role,
          isTeamLead: lead,
          hireDate: hireDateFor(`${dept.code}-${role}-${n}`),
        });
      }
    }
  }

  const names = nameSequence(wanted.length, takenNames);
  return wanted.map((w, i) => ({ ...w, name: names[i] }));
}

function hireDateFor(key: string): Date {
  const h = hashString(`hire-${key}`);
  const year = 2008 + (h % 18);
  const month = (h >>> 5) % 12;
  const day = 1 + ((h >>> 9) % 28);
  return new Date(Date.UTC(year, month, day));
}
