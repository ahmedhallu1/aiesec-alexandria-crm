import { getViewer } from "@/server/data";
import { canSeeFeedbackInbox } from "@/lib/rbac";
import { FeedbackForm } from "@/components/crm/feedback-form";

export const metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const viewer = await getViewer();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          Feedback<span className="text-primary">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This system is built for <b>YOU</b> — every bug you report and every
          idea you share makes it better and more reliable for you and the whole
          LC. Your feedback is a real contribution to building it. 💜
        </p>
      </div>
      <FeedbackForm showInboxLink={canSeeFeedbackInbox(viewer)} />
    </div>
  );
}
