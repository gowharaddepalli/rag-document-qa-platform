import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { ModeBanner } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Document Insight Hub — Ask your PDFs, with page citations" },
      {
        name: "description",
        content: "Upload PDFs and get answers that cite the document and page they came from.",
      },
      { property: "og:title", content: "Document Insight Hub" },
      { property: "og:description", content: "Answers from your PDFs, with page citations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "login") await api.login(email, password);
      else await api.register(name, email, password);
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen">
      <ModeBanner />
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Retrieval-augmented Q&A
          </p>
          <h1 className="mt-3 text-5xl font-semibold leading-tight text-primary">
            Ask your documents.
            <br />
            Every answer shows its page.
          </h1>
          <p className="mt-5 max-w-md text-muted-foreground">
            Upload PDFs, ask questions, and get answers grounded in retrieved passages, each cited
            by document and page. If the evidence isn't there, it says so.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-8 shadow-paper">
          <div className="flex gap-2">
            {(["login", "register"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                variant={tab === t ? "default" : "ghost"}
                size="sm"
                onClick={() => setTab(t)}
              >
                {t === "login" ? "Sign in" : "Create account"}
              </Button>
            ))}
          </div>
          {tab === "register" && (
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy}>
            {busy ? "Please wait…" : tab === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}