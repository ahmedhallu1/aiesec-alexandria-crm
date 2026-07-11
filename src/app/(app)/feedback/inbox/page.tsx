import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { canSeeFeedbackInbox } from "@/lib/rbac";
import { db } from "@/lib/supabase";
import { FeedbackInboxView, type FeedbackItem } from "@/components/crm/feedback-inbox-view";

export const metadata = { title: "Feedback inbox" };

export default async function FeedbackInboxPage() {
  const viewer = await getViewer();
  if (!canSeeFeedbackInbox(viewer)) redirect("/feedback");

  const { data: items } = await db()
    .from("feedback")
    .select("*, member:members(name, nickname, email)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rise-in">
        <h1 className="text-2xl font-bold">Feedback inbox</h1>
        <p className="text-sm text-muted-foreground">
          The people spoke — thank them, act, archive. Sodio grows one idea at a time.
        </p>
      </div>
      <FeedbackInboxView
        items={((items ?? []) as (FeedbackItem & { status?: string; anonymous?: boolean })[]).map(
          (f) => ({
            ...f,
            status: f.status ?? "new",
            anonymous: f.anonymous ?? false,
          })
        )}
      />
    </div>
  );
}
