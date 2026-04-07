import { redirect } from "next/navigation";

export default function WorkerMyBidsRedirect() {
  redirect("/worker/bids");
}
