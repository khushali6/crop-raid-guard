import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Workspace, useWorkspace } from "@/components/workspace";
import { Heading } from "@/components/common";
import { api, post } from "@/lib/api";
import { errorText, fmtDate, relativeTime, useDashboard } from "@/lib/data";
import { API_URL, supabase } from "@/lib/supabase";
import type { ApiKeyRow, Language, Profile } from "@/lib/types";

async function copy(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Could not copy. Select the text instead.");
  }
}

function useProfileUpdate() {
  const { profile, refreshProfile } = useWorkspace();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      if (!profile) throw new Error("Your profile is still loading.");
      const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void refreshProfile(),
    onError: (e) => toast.error(errorText(e)),
  });
}

interface LinkCode {
  code: string;
  expires_in_minutes: number;
  telegram_url: string | null;
  whatsapp_text: string | null;
  telegram_enabled: boolean;
  whatsapp_enabled: boolean;
}

function Messaging() {
  const { profile, refreshProfile } = useWorkspace();
  const [link, setLink] = useState<LinkCode | null>(null);
  const create = useMutation({
    mutationFn: () => post<LinkCode>("/v1/integrations/link-code"),
    onSuccess: setLink,
    onError: (e) => toast.error(errorText(e)),
  });
  const unlink = useMutation({
    mutationFn: (channel: "telegram" | "whatsapp") =>
      api(`/v1/integrations/messaging?channel=${channel}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Disconnected");
      void refreshProfile();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  useEffect(() => {
    if (!link) return undefined;
    const t = setInterval(() => void refreshProfile(), 5000);
    return () => clearInterval(t);
  }, [link, refreshProfile]);
  const channels = [
    {
      id: "telegram" as const,
      name: "Telegram",
      linked: profile?.telegram_chat_id != null,
      detail: "Instant alerts and questions from your phone.",
    },
    {
      id: "whatsapp" as const,
      name: "WhatsApp",
      linked: !!profile?.whatsapp_phone,
      detail: profile?.whatsapp_phone
        ? `Linked to +${profile.whatsapp_phone}`
        : "Alerts on WhatsApp (when enabled on this server).",
    },
  ];
  return (
    <section className="settings-section">
      <h2>Phone alerts</h2>
      {channels.map((c) => (
        <div className="settings-row" key={c.id}>
          <div>
            <h3>{c.name}</h3>
            <p>{c.detail}</p>
          </div>
          {c.linked ? (
            <Button
              variant="outline"
              size="sm"
              disabled={unlink.isPending}
              onClick={() => unlink.mutate(c.id)}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : <MessageCircle />}
              Connect
            </Button>
          )}
        </div>
      ))}
      {link && (
        <div className="link-code">
          <p>
            Your one-time code <strong>{link.code}</strong> works for {link.expires_in_minutes}{" "}
            minutes.
          </p>
          <div className="flex gap-2 flex-wrap mt-3">
            {link.telegram_url && (
              <Button asChild size="sm">
                <a href={link.telegram_url} target="_blank" rel="noopener noreferrer">
                  <Send />
                  Open Telegram
                </a>
              </Button>
            )}
            {link.whatsapp_text && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void copy(
                    link.whatsapp_text ?? "",
                    "Message copied — send it to the WhatsApp number",
                  )
                }
              >
                <Copy />
                Copy WhatsApp message
              </Button>
            )}
          </div>
          {!link.telegram_enabled && !link.whatsapp_enabled && (
            <p className="text-xs text-muted-foreground mt-3">
              Messaging is not configured on this server yet. In-app alerts still work.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const SCOPES = [
  { id: "events:read", label: "Read events and risk" },
  { id: "claims:draft", label: "Draft claims and reports" },
  { id: "claims:write", label: "Create claims" },
] as const;

function ApiKeys() {
  const { session } = useWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["events:read"]);
  const [created, setCreated] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: ["api-keys", session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, name, prefix, scopes, created_at, last_used_at, revoked_at")
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ApiKeyRow[];
    },
  });
  const create = useMutation({
    mutationFn: () => post<{ key: string }>("/v1/api-keys", { name: name.trim(), scopes }),
    onSuccess: (r) => {
      setCreated(r.key);
      setName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Key revoked");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <section className="settings-section">
      <h2>API keys</h2>
      <p className="text-muted-foreground text-xs mb-4">
        For the REST API and MCP clients such as Claude Desktop or Cursor. Keys act as you, inside
        this workspace.
      </p>
      {created && (
        <div className="link-code">
          <p>Copy this key now. It won’t be shown again.</p>
          <div className="key-reveal">
            <code>{created}</code>
            <Button size="sm" variant="outline" onClick={() => void copy(created, "Key copied")}>
              <Copy />
              Copy
            </Button>
          </div>
        </div>
      )}
      {(keys.data ?? []).map((k) => (
        <div className="settings-row" key={k.id}>
          <div>
            <h3>
              {k.name} <code className="text-xs text-muted-foreground">{k.prefix}…</code>
            </h3>
            <p>
              {k.scopes.join(", ")} · created {fmtDate(k.created_at)} ·{" "}
              {k.last_used_at ? `used ${relativeTime(k.last_used_at)}` : "never used"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Revoke ${k.name}`}
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(k.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name, e.g. Claude Desktop"
          maxLength={60}
          required
          aria-label="Key name"
        />
        <div className="scope-list">
          {SCOPES.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={scopes.includes(s.id)}
                onChange={(e) =>
                  setScopes((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))
                }
              />
              {s.label}
            </label>
          ))}
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={create.isPending || !name.trim() || !scopes.length}
        >
          {create.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Create key
        </Button>
      </form>
    </section>
  );
}

export function SettingsPage() {
  const { profile, session, orgId, signOut } = useWorkspace();
  const update = useProfileUpdate();
  const dashboard = useDashboard(orgId);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [language, setLanguage] = useState<Language>(profile?.language ?? "en");
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLElement>(null);
  const profileId = profile?.id;

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name ?? "");
    setLanguage(profile.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (window.location.hash === "#password")
      passwordRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const notify = [
    {
      key: "notify_high_risk" as const,
      title: "High-risk wildlife alerts",
      desc: "When repeated or high-risk activity needs attention.",
    },
    {
      key: "notify_analysis" as const,
      title: "Analysis complete",
      desc: "When new footage is ready to explore.",
    },
    {
      key: "notify_weekly" as const,
      title: "Weekly field report",
      desc: "A digest of your field activity every Monday.",
    },
  ];
  const videos = dashboard.data?.videos_total ?? 0;

  return (
    <Workspace>
      <div className="form-page">
        <Heading title="Make yourself at home." description="Your workspace, your preferences." />
        <section className="settings-section">
          <h2>Profile</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate(
                { full_name: name.trim() || null, language },
                {
                  onSuccess: () => {
                    setSaved(true);
                    toast.success("Profile updated");
                  },
                },
              );
            }}
          >
            <div className="form-grid">
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={80}
                />
              </label>
              <label>
                Email
                <input type="email" value={session?.user.email ?? ""} disabled readOnly />
              </label>
              <label>
                Language for alerts and answers
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value as Language);
                    setSaved(false);
                  }}
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="gu">ગુજરાતી (Gujarati)</option>
                </select>
              </label>
            </div>
            <Button type="submit" disabled={update.isPending}>
              {saved ? <Check /> : null}
              {saved ? "Saved" : "Save changes"}
            </Button>
          </form>
        </section>
        <section className="settings-section">
          <h2>Notifications</h2>
          {notify.map((n) => (
            <div className="settings-row" key={n.key}>
              <div>
                <h3>{n.title}</h3>
                <p>{n.desc}</p>
              </div>
              <Switch
                aria-label={n.title}
                checked={profile?.[n.key] ?? false}
                disabled={!profile}
                onCheckedChange={(v) => update.mutate({ [n.key]: v })}
              />
            </div>
          ))}
        </section>
        <Messaging />
        <section className="settings-section">
          <h2>Privacy & storage</h2>
          <div className="settings-row">
            <div>
              <h3>Private footage</h3>
              <p>Your uploads are stored privately and only visible to your workspace.</p>
            </div>
            <span className="risk-badge">Private by default</span>
          </div>
          <div className="settings-row">
            <div>
              <h3>Data retention</h3>
              <p>
                Automatically remove older uploaded footage. Evidence packs and claims are kept.
              </p>
            </div>
            <select
              aria-label="Data retention"
              className="max-w-36"
              value={profile?.retention_days == null ? "keep" : String(profile.retention_days)}
              onChange={(e) =>
                update.mutate({
                  retention_days: e.target.value === "keep" ? null : Number(e.target.value),
                })
              }
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="keep">Keep until deleted</option>
            </select>
          </div>
        </section>
        <section className="settings-section" id="password" ref={passwordRef}>
          <h2>Password</h2>
          <form
            className="key-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await supabase.auth.updateUser({ password });
              if (error) toast.error(error.message);
              else {
                toast.success("Password updated");
                setPassword("");
              }
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              placeholder="New password (8+ characters)"
              autoComplete="new-password"
              aria-label="New password"
            />
            <Button type="submit" variant="outline">
              Update password
            </Button>
          </form>
        </section>
        <ApiKeys />
        <section className="settings-section">
          <h2>Workspace usage</h2>
          <div className="info-row">
            <span>Videos analysed</span>
            <strong>{videos}</strong>
          </div>
          <div className="progress-track">
            <div style={{ width: `${Math.min(100, (videos / 200) * 100)}%` }} />
          </div>
          <p className="text-muted-foreground text-xs">
            Free plan: videos up to 50 MB each. Storage is shared across your workspace.
          </p>
        </section>
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOut />
          Sign out
        </Button>
      </div>
    </Workspace>
  );
}

// ------------------------------------------------------------------ API docs
const ENDPOINTS: [string, string, string][] = [
  ["GET", "/healthz", "Service, database and worker status"],
  ["POST", "/v1/agent/chat", "Ask a question; streams tool steps and a cited answer (SSE)"],
  ["POST", "/v1/videos/{id}/analyze", "Queue or re-run analysis for an uploaded video"],
  ["POST", "/v1/search/events", "Semantic search across event descriptions"],
  ["POST", "/v1/reports", "Generate a weekly or custom field report"],
  ["POST", "/v1/claims/{id}/evidence-pack", "Build the signed evidence pack for a claim"],
  ["POST", "/v1/claims/{id}/draft", "Draft the loss intimation text"],
  ["GET", "/v1/evidence/{id}/download", "Short-lived download link for an evidence pack"],
  ["GET", "/v1/evidence/public-key", "Ed25519 public key used to sign packs"],
  ["POST", "/v1/evidence/verify", "Verify an evidence pack (no sign-in needed)"],
  ["GET", "/v1/species", "Species the system can recognise"],
];

const MCP_TOOLS = [
  "events_summary",
  "list_events",
  "farm_risk",
  "get_event",
  "semantic_search_events",
  "kb_search",
  "claimable_events",
  "check_deadline",
  "create_claim_draft",
  "build_evidence_pack",
];

interface VerifyResult {
  valid: boolean;
  reason?: string;
  key_id?: string;
  files?: number;
}

export function ApiDocs() {
  const base = API_URL || "https://your-space.hf.space";
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const curl = `curl -N ${base}/v1/agent/chat \\\n  -H "Authorization: Bearer crg_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "How many wild boar visits this week?"}'`;
  const mcp = JSON.stringify(
    {
      mcpServers: {
        "crop-raid-guard": {
          url: `${base}/mcp`,
          headers: { Authorization: "Bearer crg_YOUR_KEY" },
        },
      },
    },
    null,
    2,
  );

  const verify = async (file: File) => {
    setChecking(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      setResult(await api<VerifyResult>("/v1/evidence/verify", { method: "POST", body: form }));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Workspace>
      <Heading
        title="Field intelligence, connected."
        description="Use your workspace from scripts, AI assistants and other tools."
      />
      <div className="insight-note">
        <Sparkles size={18} />
        <div>
          <h3>Authentication</h3>
          <p>
            Create an API key in <a href="/settings">Settings</a> and send it as{" "}
            <code>Authorization: Bearer crg_…</code>. Keys only see your own workspace, and every
            call is audited.
          </p>
        </div>
      </div>
      <section className="api-section">
        <div className="section-heading">
          <h2>Ask from a script</h2>
          <Button variant="outline" size="sm" onClick={() => void copy(curl, "Example copied")}>
            <Copy />
            Copy example
          </Button>
        </div>
        <p>
          Answers stream as server-sent events: the route, each tool step, then the final answer
          with citations.
        </p>
        <pre className="code-block">{curl}</pre>
      </section>
      <section className="api-section">
        <div className="section-heading">
          <h2>Connect an MCP client</h2>
          <Button variant="outline" size="sm" onClick={() => void copy(mcp, "Config copied")}>
            <Copy />
            Copy config
          </Button>
        </div>
        <p>
          Add this to Claude Desktop, Cursor or any client that supports streamable HTTP. Available
          tools: {MCP_TOOLS.join(", ")}.
        </p>
        <pre className="code-block">{mcp}</pre>
      </section>
      <section className="api-section">
        <h2>Endpoints</h2>
        {ENDPOINTS.map(([m, p, d]) => (
          <div className="report-row" key={`${m} ${p}`}>
            <span className="risk-badge">{m}</span>
            <code>{p}</code>
            <span className="text-muted-foreground text-xs ml-auto">{d}</span>
          </div>
        ))}
        {API_URL && (
          <p className="mt-4 text-xs">
            Interactive reference:{" "}
            <a
              className="inline-link"
              href={`${API_URL}/docs`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {API_URL}/docs
            </a>
          </p>
        )}
      </section>
      <section className="api-section">
        <h2>Verify an evidence pack</h2>
        <p>
          Checks every file hash and the Ed25519 signature. Anyone, such as an insurer, can use this
          without an account.
        </p>
        <label className="verify-drop">
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => e.target.files?.[0] && void verify(e.target.files[0])}
          />
          {checking ? <Loader2 className="animate-spin" /> : <Upload />}
          {checking ? "Checking…" : "Choose an evidence .zip"}
        </label>
        {result && (
          <div className={`insight-note ${result.valid ? "" : "error-note"}`}>
            <ShieldCheck size={18} />
            <div>
              <h3>{result.valid ? "Authentic and unchanged" : "Could not verify"}</h3>
              <p>
                {result.valid
                  ? `Signature valid${result.key_id ? ` (key ${result.key_id})` : ""}${result.files ? ` · ${result.files} files match their hashes` : ""}.`
                  : (result.reason ?? "This file does not match its signature.")}
              </p>
            </div>
          </div>
        )}
      </section>
    </Workspace>
  );
}
