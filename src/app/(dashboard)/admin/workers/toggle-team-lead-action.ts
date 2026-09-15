"use server";

import { setTeamLead } from "@/app/actions/workers";

export async function toggleTeamLeadFormAction(formData: FormData) {
  await setTeamLead({
    userId: String(formData.get("userId") ?? ""),
    isTeamLead: formData.get("isTeamLead") === "true",
  });
}
