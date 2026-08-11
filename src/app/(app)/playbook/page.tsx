import { redirect } from "next/navigation";

/** The Playbook grew into the Help center (v33.36). The old address keeps
 *  working forever — links in old emails, chats and heads live here. */
export default function PlaybookRedirect() {
  redirect("/help");
}
