import type { ElementType } from "react";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { Mail, User, Briefcase, Building2, Phone, Calendar } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneVerification } from "@/features/profile/phone-verification";
import { isVerifyConfigured } from "@/lib/outreach/twilio";

export const metadata = { title: "Profile – Staffly" };

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      departmentMemberships: {
        include: { department: { select: { name: true, code: true } } },
        orderBy: { department: { name: "asc" } },
      },
    },
  });

  if (!user) redirect("/login");

  const roleLabel =
    user.role === "SCHEDULER"
      ? "Scheduler"
      : user.role === "UNIT_CLERK"
        ? "Unit Clerk"
        : "Staff member";

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="page-title text-3xl">Profile</h1>
        <p className="text-sm text-neutral-500 mt-2">Your account details (read-only).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Personal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ProfileRow icon={User} label="Full name" value={user.name} />
          <ProfileRow icon={Mail} label="Email" value={user.email} />
          <ProfileRow icon={Briefcase} label="Role" value={roleLabel} />
          <ProfileRow icon={Calendar} label="Member since" value={format(user.createdAt, "MMMM d, yyyy")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Text &amp; call alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex gap-3">
            <Phone className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" aria-hidden />
            <p className="text-neutral-500">
              Verify your mobile number to get shift callouts by text and phone. Unverified
              numbers only receive in-app alerts.
            </p>
          </div>
          <PhoneVerification
            initialPhone={user.phone}
            verified={user.phoneVerifiedAt !== null}
            available={isVerifyConfigured()}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ProfileRow icon={Building2} label="Primary department" value={user.department ?? "—"} />
          <ProfileRow icon={Briefcase} label="Position" value={user.position ?? "—"} />
          {user.departmentMemberships.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-2">Department assignments</p>
              <ul className="space-y-2">
                {user.departmentMemberships.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-2 text-neutral-800"
                  >
                    <span className="font-medium">{m.department.name}</span>
                    <span className="text-neutral-400 mx-1.5">·</span>
                    <span className="text-neutral-600">{m.title}</span>
                    <span className="text-xs text-neutral-400 ml-2">({m.department.code})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
        <p className="text-neutral-900 mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}
