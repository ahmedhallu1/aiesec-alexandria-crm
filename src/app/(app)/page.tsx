import { redirect } from "next/navigation";

/** Accounts are the daily workspace — the home route lands there.
 *  The dashboard lives on /dashboard. */
export default function Home() {
  redirect("/accounts");
}
