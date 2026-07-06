import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { canManageMembership } from "@/lib/rbac";
import { db } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Feedback inbox" };

export default async function FeedbackPage() {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) redirect("/");

  const { data: items } = await db()
    .from("feedback")
    .select("*, member:members(name, nickname)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Feedback inbox</h1>
        <p className="text-sm text-muted-foreground">Bugs and enhancement ideas from members.</p>
      </div>
      {(items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No feedback yet — that&apos;s either very good or very suspicious 🙂
          </CardContent>
        </Card>
      ) : (
        (items ?? []).map((f) => (
          <Card key={f.id}>
            <CardContent className="space-y-1.5 pt-4">
              <div className="flex items-center gap-2">
                <Badge variant={f.type === "Bug" ? "destructive" : "outline"}>
                  {f.type === "Bug" ? "🐞 Bug" : f.type === "Enhancement" ? "✨ Enhancement" : "💬 Other"}
                </Badge>
                <span className="text-sm font-medium">
                  {f.member?.nickname || f.member?.name || "Unknown"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(f.created_at).toLocaleString()} {f.page ? `· ${f.page}` : ""}
                </span>
              </div>
              <p className="text-sm">{f.message}</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
