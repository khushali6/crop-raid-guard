import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;
const url = (env["VITE_SUPABASE_URL"] as string | undefined) ?? "";
const key =
  (env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
  (env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ??
  "";

export const supabaseConfigured = Boolean(url && key);
export const API_URL = ((env["VITE_API_URL"] as string | undefined) ?? "").replace(/\/$/, "");

const browser = typeof window !== "undefined";

export const supabase = createClient(url || "http://localhost:54321", key || "missing-key", {
  auth: { persistSession: browser, autoRefreshToken: browser, detectSessionInUrl: browser },
});
