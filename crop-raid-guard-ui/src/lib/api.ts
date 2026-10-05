import { API_URL, supabase } from "@/lib/supabase";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return "Some details are missing or invalid.";
  }
  if (status === 0) return "The analysis service is not reachable. Please try again shortly.";
  return status >= 500
    ? "The analysis service had a problem. Please try again."
    : "That request could not be completed.";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new ApiError("The analysis service URL is not configured (VITE_API_URL).", 0);
  const headers: Record<string, string> = { ...(await authHeaders()) };
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
  } catch {
    throw new ApiError(errorMessage(null, 0), 0);
  }
  if (resp.status === 204) return undefined as T;
  const body: unknown = await resp.json().catch(() => null);
  if (!resp.ok) throw new ApiError(errorMessage(body, resp.status), resp.status);
  return body as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) });

export type ChatEvent =
  | { type: "thread"; thread_id: string }
  | { type: "route"; route: string; reason: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; summary: string; ok: boolean }
  | {
      type: "answer";
      thread_id: string;
      answer: string;
      route: string | null;
      status: string;
      citations: {
        n: number;
        title: string;
        publisher: string | null;
        source_url: string | null;
      }[];
      trace: Record<string, unknown>[];
    }
  | { type: "error"; message: string }
  | { type: "done" };

export async function streamChat(
  body: { message: string; thread_id?: string | null; video_id?: string | null; language?: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!API_URL) throw new ApiError("The analysis service URL is not configured (VITE_API_URL).", 0);
  const init: RequestInit = {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}/v1/agent/chat`, init);
  } catch (err) {
    if (signal?.aborted) return;
    throw new ApiError(errorMessage(null, 0), 0);
  }
  if (!resp.ok || !resp.body) {
    const json: unknown = await resp.json().catch(() => null);
    throw new ApiError(errorMessage(json, resp.status), resp.status);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatEvent);
      } catch {
        // ignore malformed keepalive fragments
      }
    }
  }
}
