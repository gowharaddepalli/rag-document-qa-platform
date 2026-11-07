import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { api, type DocumentItem } from "@/lib/api";
import { useSession } from "@/hooks/use-session";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Documents — Document Insight Hub" },
      { name: "description", content: "Upload PDFs and check their processing status." },
      { property: "og:title", content: "Documents — Document Insight Hub" },
      { property: "og:description", content: "Upload PDFs and check their processing status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useSession();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      api
        .listDocuments()
        .then(setDocs)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);
  async function onFile(f?: File) {
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      await api.uploadDocument(f);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
        <h1 className="text-3xl font-semibold">Your documents</h1>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-card p-10 text-center hover:border-primary">
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
          <span className="font-medium">
            {busy ? "Extracting text and indexing pages…" : "Upload a PDF (up to 20 MB)"}
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="divide-y rounded-lg border bg-card">
          {docs.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No documents yet.</p>
          )}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {d.pages} pages · {d.chunks} chunks · {(d.size / 1024).toFixed(0)} KB
                  {d.error ? ` · ${d.error}` : ""}
                </p>
              </div>
              <span
                className={`rounded-sm px-2 py-0.5 text-xs ${d.status === "ready" ? "bg-success text-primary-foreground" : d.status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"}`}
              >
                {d.status}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete document"
                onClick={async () => {
                  await api.deleteDocument(d.id);
                  refresh();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}