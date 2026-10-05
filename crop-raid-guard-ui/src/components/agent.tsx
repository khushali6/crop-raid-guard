import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Workspace, useWorkspace } from "@/components/workspace";
import { Heading, Markdown } from "@/components/common";
import { streamChat, type ChatEvent } from "@/lib/api";
import { errorText, relativeTime } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import type { Citation } from "@/lib/types";

interface Step {
  name: string;
  summary?: string;
  ok?: boolean;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  steps?: Step[];
  route?: string | null;
  error?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  events_summary: "Counted wildlife events",
  list_events: "Listed matching events",
  farm_risk: "Checked field risk",
  get_event: "Opened an event",
  semantic_search_events: "Searched clip descriptions",
  sql_readonly: "Ran a read-only query",
  kb_search: "Searched verified sources",
  claimable_events: "Found claimable events",
  check_deadline: "Checked the 72-hour deadline",
  create_claim_draft: "Created a draft claim",
  draft_claim_text: "Drafted claim text",
  build_evidence_pack: "Built the evidence pack",
};

const ROUTE_LABELS: Record<string, string> = {
  analyst: "Field analyst",
  advisor: "Scheme advisor",
  claims: "Claims assistant",
  report: "Report writer",
  general: "Assistant",
};

function useChat(videoId?: string) {
  const { profile } = useWorkspace();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const update = (fn: (m: Message) => Message) =>
    setMessages((list) => {
      const last = list.at(-1);
      return last && last.role === "assistant" ? [...list.slice(0, -1), fn(last)] : list;
    });

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "user", text: message },
        { role: "assistant", text: "", steps: [] },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamChat(
          {
            message,
            thread_id: threadId,
            video_id: videoId ?? null,
            language: profile?.language ?? "en",
          },
          (e: ChatEvent) => {
            if (e.type === "thread") setThreadId(e.thread_id);
            else if (e.type === "route") update((m) => ({ ...m, route: e.route }));
            else if (e.type === "tool_call")
              update((m) => ({ ...m, steps: [...(m.steps ?? []), { name: e.name }] }));
            else if (e.type === "tool_result")
              update((m) => {
                const steps = [...(m.steps ?? [])];
                for (let i = steps.length - 1; i >= 0; i--) {
                  const s = steps[i];
                  if (s && s.name === e.name && s.summary === undefined) {
                    steps[i] = { ...s, summary: e.summary, ok: e.ok };
                    break;
                  }
                }
                return { ...m, steps };
              });
            else if (e.type === "answer")
              update((m) => ({
                ...m,
                text: e.answer,
                citations: e.citations,
                route: e.route ?? m.route ?? null,
              }));
            else if (e.type === "error") update((m) => ({ ...m, text: e.message, error: true }));
          },
          controller.signal,
        );
      } catch (err) {
        update((m) => ({ ...m, text: errorText(err), error: true }));
      } finally {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["threads"] });
        void qc.invalidateQueries({ queryKey: ["claims"] });
      }
    },
    [busy, threadId, videoId, profile?.language, qc],
  );

  const reset = () => {
    abort.current?.abort();
    setMessages([]);
    setThreadId(null);
    setBusy(false);
  };

  const load = (id: string, history: Message[]) => {
    abort.current?.abort();
    setThreadId(id);
    setMessages(history);
  };

  return { messages, send, busy, reset, load, threadId };
}

function Steps({
  steps,
  busy,
  route,
}: {
  steps: Step[];
  busy: boolean;
  route?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !busy) return null;
  const expanded = busy || open;
  return (
    <div className="agent-steps">
      <button
        type="button"
        className="agent-steps-toggle"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" size={12} /> : <ShieldCheck size={12} />}
        {busy
          ? steps.length
            ? (TOOL_LABELS[steps.at(-1)?.name ?? ""] ?? "Working") + "…"
            : "Thinking…"
          : `${route ? `${ROUTE_LABELS[route] ?? "Assistant"} · ` : ""}${steps.length} step${steps.length === 1 ? "" : "s"} checked against your data`}
        {!busy && steps.length > 0 && (
          <ChevronDown size={12} className={open ? "rotate-180" : ""} />
        )}
      </button>
      {expanded && steps.length > 0 && (
        <ol>
          {steps.map((s, i) => (
            <li key={i} className={s.ok === false ? "failed" : ""}>
              {s.summary === undefined ? (
                <Loader2 className="animate-spin" size={11} />
              ) : s.ok === false ? (
                <TriangleAlert size={11} />
              ) : (
                <Check size={11} />
              )}
              <span>{TOOL_LABELS[s.name] ?? s.name}</span>
              {s.summary && <small>{s.summary}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="agent-sources">
      <h4>
        <BookOpen size={12} /> Sources
      </h4>
      <ol>
        {citations.map((c) => (
          <li key={c.n} id={`source-${c.n}`}>
            <span className="cite">{c.n}</span>
            {c.source_url ? (
              <a href={c.source_url} target="_blank" rel="noopener noreferrer">
                {c.title}
              </a>
            ) : (
              <span>{c.title}</span>
            )}
            {c.publisher && <small>{c.publisher}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AssistantMessage({ m, busy }: { m: Message; busy: boolean }) {
  return (
    <div className={`answer ${m.error ? "is-error" : ""}`}>
      <Steps steps={m.steps ?? []} busy={busy && !m.text} route={m.route} />
      {m.text ? (
        <Markdown
          text={m.text}
          onCitation={(n) =>
            document
              .getElementById(`source-${n}`)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
          }
        />
      ) : null}
      {m.citations && <Sources citations={m.citations} />}
      {m.text && !m.error && (
        <small>
          Figures come from your own footage and verified sources. Detections can be wrong — check
          the linked clips.
        </small>
      )}
    </div>
  );
}

export function AskPanel({
  videoId,
  title,
  placeholder,
  suggestions,
}: {
  videoId?: string;
  title: string;
  placeholder: string;
  suggestions: string[];
}) {
  const chat = useChat(videoId);
  const [query, setQuery] = useState("");
  const pairs = chat.messages;
  return (
    <section className="ask-section">
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="flex items-center gap-2">
          <Sparkles size={13} />
          Answers cite your clips
        </span>
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void chat.send(query);
          setQuery("");
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Ask a question about this footage"
          maxLength={2000}
        />
        <Button
          type="submit"
          disabled={chat.busy || !query.trim()}
          size="icon"
          aria-label="Ask question"
        >
          {chat.busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
      <div className="suggestions">
        {suggestions.map((q) => (
          <Button key={q} variant="outline" disabled={chat.busy} onClick={() => void chat.send(q)}>
            {q}
          </Button>
        ))}
      </div>
      {pairs.map((m, i) =>
        m.role === "user" ? (
          <p key={i} className="ask-question">
            {m.text}
          </p>
        ) : (
          <AssistantMessage key={i} m={m} busy={chat.busy && i === pairs.length - 1} />
        ),
      )}
    </section>
  );
}

interface ThreadRow {
  id: string;
  title: string;
  updated_at: string;
}

const ASK_SUGGESTIONS = [
  "Which field had the most wildlife this week?",
  "When do wild boar usually visit?",
  "Which fencing subsidy applies to me in Gujarat?",
  "Help me prepare a claim for last night’s visit",
  "How do I report a wild animal loss under PMFBY?",
  "Give me a summary of the last 30 days",
];

export function AskPage({ initial }: { initial?: string }) {
  const { orgId } = useWorkspace();
  const chat = useChat();
  const [query, setQuery] = useState("");
  const sentInitial = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const threads = useQuery({
    queryKey: ["threads", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_threads")
        .select("id, title, updated_at")
        .eq("org_id", orgId ?? "")
        .order("updated_at", { ascending: false })
        .limit(12);
      if (error) throw new Error(error.message);
      return (data ?? []) as ThreadRow[];
    },
  });

  useEffect(() => {
    if (initial && !sentInitial.current) {
      sentInitial.current = true;
      void chat.send(initial);
    }
  }, [initial, chat]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages]);

  const openThread = async (id: string) => {
    const { data } = await supabase
      .from("agent_messages")
      .select("role, content, citations, trace, route")
      .eq("thread_id", id)
      .order("id")
      .limit(60);
    const history: Message[] = (
      (data ?? []) as {
        role: string;
        content: string;
        citations: Citation[] | null;
        trace: { type: string; name?: string; summary?: string; ok?: boolean }[] | null;
        route: string | null;
      }[]
    )
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) =>
        m.role === "user"
          ? { role: "user", text: m.content }
          : {
              role: "assistant",
              text: m.content,
              citations: m.citations ?? [],
              route: m.route,
              steps: (m.trace ?? [])
                .filter((t) => t.type === "tool" && t.name)
                .map((t) => ({ name: t.name ?? "", summary: t.summary ?? "", ok: t.ok !== false })),
            },
      );
    chat.load(id, history);
  };

  return (
    <Workspace>
      <Heading
        title="Ask your fields."
        description="Questions about wildlife activity, schemes and claims, answered from your own footage with sources."
        action={
          chat.messages.length ? (
            <Button variant="outline" onClick={chat.reset}>
              <Plus />
              New conversation
            </Button>
          ) : undefined
        }
      />
      <div className="viewer-grid">
        <section className="ask-thread">
          {!chat.messages.length && (
            <div className="ask-empty">
              <Sparkles size={22} />
              <h2>What would you like to know?</h2>
              <p>
                Ask in English, हिन्दी or ગુજરાતી. Every number in an answer is checked against your
                own data.
              </p>
              <div className="suggestions">
                {ASK_SUGGESTIONS.map((q) => (
                  <Button key={q} variant="outline" onClick={() => void chat.send(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {chat.messages.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="ask-question">
                {m.text}
              </p>
            ) : (
              <AssistantMessage key={i} m={m} busy={chat.busy && i === chat.messages.length - 1} />
            ),
          )}
          <div ref={bottom} />
          <form
            className="ask-form sticky-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void chat.send(query);
              setQuery("");
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask about your fields, schemes or a claim…"
              aria-label="Ask a question"
              maxLength={2000}
            />
            <Button
              type="submit"
              disabled={chat.busy || !query.trim()}
              size="icon"
              aria-label="Send question"
            >
              {chat.busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </form>
        </section>
        <aside className="viewer-sidebar">
          <section className="info-section">
            <h2>Recent conversations</h2>
            {(threads.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`thread-row ${chat.threadId === t.id ? "active" : ""}`}
                onClick={() => void openThread(t.id)}
              >
                <MessageSquare size={13} />
                <span>
                  {t.title}
                  <small>{relativeTime(t.updated_at)}</small>
                </span>
              </button>
            ))}
            {!threads.isLoading && !threads.data?.length && (
              <p className="text-muted-foreground text-xs">Your conversations will appear here.</p>
            )}
          </section>
          <section className="info-section">
            <h2>How answers are checked</h2>
            <ul>
              <li>Counts and times come from database queries on your workspace only.</li>
              <li>Scheme answers quote verified documents and cite them.</li>
              <li>Claims are prepared as drafts; you approve and file them yourself.</li>
            </ul>
            <p className="mt-3 text-muted-foreground text-xs">
              Prefer a full checklist? Open the{" "}
              <Link to="/claims" className="inline-link">
                claims board
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>
    </Workspace>
  );
}
