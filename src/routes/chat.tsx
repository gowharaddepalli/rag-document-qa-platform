import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { api, type Conversation, type Message } from "@/lib/api";
import { useSession } from "@/hooks/use-session";
import { AppHeader } from "@/components/AppHeader";
import { CitationCard } from "@/components/CitationCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Document Insight Hub" },
      { name: "description", content: "Ask questions about your PDFs and see cited source pages." },
      { property: "og:title", content: "Chat — Document Insight Hub" },
      {
        property: "og:description",
        content: "Ask questions about your PDFs and see cited source pages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Chat,
});

function Chat() {
  const { user } = useSession();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) api.listConversations().then(setConvs);
  }, [user]);
  useEffect(() => {
    if (active) api.getMessages(active).then(setMsgs);
    else setMsgs([]);
  }, [active]);
  useEffect(() => {
    if (!reveal) return;
    const m = msgs.find((x) => x.id === reveal.id);
    if (!m || reveal.n >= m.content.length) {
      setReveal(null);
      return;
    }
    const t = setTimeout(() => setReveal({ id: reveal.id, n: reveal.n + 6 }), 12);
    return () => clearTimeout(t);
  }, [reveal, msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError("");
    const question = q;
    setQ("");
    setMsgs((m) => [
      ...m,
      { id: "pending", role: "user", content: question, citations: [], createdAt: "" },
    ]);
    try {
      const r = await api.ask(active, question, []);
      const all = await api.getMessages(r.conversationId);
      setMsgs(all);
      setReveal({ id: r.message.id, n: 0 });
      if (r.conversationId !== active) setActive(r.conversationId);
      setConvs(await api.listConversations());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <AppHeader user={user} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
          <div className="p-3">
            <Button variant="secondary" className="w-full" onClick={() => setActive(null)}>
              <Plus className="h-4 w-4" /> New conversation
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {convs.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-md text-sm ${active === c.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
              >
                <button
                  className="flex-1 truncate px-3 py-2 text-left"
                  onClick={() => setActive(c.id)}
                >
                  {c.title}
                </button>
                <button
                  aria-label="Delete conversation"
                  className="px-2 opacity-0 group-hover:opacity-100"
                  onClick={async () => {
                    await api.deleteConversation(c.id);
                    if (active === c.id) setActive(null);
                    setConvs(await api.listConversations());
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
              {msgs.length === 0 && (
                <p className="pt-16 text-center text-muted-foreground">
                  Ask a question about your uploaded PDFs.
                </p>
              )}
              {msgs.map((m) => {
                const streaming = reveal?.id === m.id;
                const text = streaming && reveal ? m.content.slice(0, reveal.n) : m.content;
                return m.role === "user" ? (
                  <div
                    key={m.id}
                    className="ml-auto max-w-[80%] rounded-lg bg-primary px-4 py-2.5 text-primary-foreground"
                  >
                    {m.content}
                  </div>
                ) : (
                  <div key={m.id} className="space-y-3">
                    <div
                      className={`whitespace-pre-wrap rounded-lg border bg-card p-4 shadow-paper ${m.notFound ? "border-warning-foreground/40" : ""} ${streaming ? "streaming-caret" : ""}`}
                    >
                      {text}
                    </div>
                    {!streaming && (
                      <>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {m.mode === "demo-extractive" ? "Demo mode · extractive, no LLM" : m.mode}{" "}
                          {m.latencyMs != null && `· ${m.latencyMs} ms`}
                        </p>
                        {m.citations.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {m.citations.map((c) => (
                              <CitationCard key={c.index} c={c} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {busy && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Retrieving passages…
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
          <form onSubmit={send} className="border-t bg-background p-4">
            <div className="mx-auto flex max-w-3xl gap-2">
              <Textarea
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask about your documents…"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) send(e);
                }}
              />
              <Button disabled={busy || !q.trim()} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}