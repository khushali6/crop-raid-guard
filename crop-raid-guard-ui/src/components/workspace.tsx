import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  Video,
  Sprout,
  PawPrint,
  Bell,
  FileText,
  Plus,
  Settings,
  Code2,
  Search,
  ChevronDown,
  Menu,
  X,
  ArrowUpRight,
  Wheat,
  Command,
  Sparkles,
  ClipboardCheck,
  ScanEye,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
import { supabase, supabaseConfigured, API_URL } from "@/lib/supabase";
import { useDashboard, useFarmSummaries, useRealtime } from "@/lib/data";
import type { FarmSummary, Organization, Profile } from "@/lib/types";

interface WorkspaceValue {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  org: Organization | null;
  orgId: string | null;
  displayName: string;
  fields: FarmSummary[];
  fieldsLoading: boolean;
  refreshProfile: () => Promise<void>;
  addField: (input: {
    name: string;
    crop: string;
    village?: string;
    description?: string;
  }) => Promise<string>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  ready: false,
  session: null,
  profile: null,
  org: null,
  orgId: null,
  displayName: "",
  fields: [],
  fieldsLoading: true,
  refreshProfile: async () => {},
  addField: async () => "",
  signOut: async () => {},
});

export const useWorkspace = () => useContext(WorkspaceContext);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthReady(true);
      if (!s) qc.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [qc]);

  const userId = session?.user.id ?? null;
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId ?? "")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Profile | null;
    },
  });
  const profile = profileQuery.data ?? null;
  const orgId = profile?.default_org_id ?? null;
  const orgQuery = useQuery({
    queryKey: ["org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, kind")
        .eq("id", orgId ?? "")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Organization | null;
    },
  });
  const farms = useFarmSummaries(orgId);
  useRealtime(orgId);

  const refreshProfile = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["profile"] });
  }, [qc]);

  const addField = useCallback<WorkspaceValue["addField"]>(
    async ({ name, crop, village, description }) => {
      if (!orgId) throw new Error("Your workspace is still loading.");
      const { data, error } = await supabase
        .from("farms")
        .insert({
          org_id: orgId,
          name: name.trim(),
          crop,
          village: village?.trim() || null,
          description: description?.trim() || null,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error)
        throw new Error(
          error.message.includes("duplicate")
            ? "A field with this name already exists."
            : error.message,
        );
      await qc.invalidateQueries({ queryKey: ["farms"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      return (data as { id: string }).id;
    },
    [orgId, userId, qc],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
  }, [qc]);

  const email = session?.user.email ?? "";
  const displayName = profile?.full_name?.trim() || email.split("@")[0] || "there";
  const ready = authReady && (!session || (profileQuery.isFetched && (!orgId || farms.isFetched)));

  const value = useMemo<WorkspaceValue>(
    () => ({
      ready,
      session,
      profile,
      org: orgQuery.data ?? null,
      orgId,
      displayName,
      fields: farms.data ?? [],
      fieldsLoading: farms.isLoading,
      refreshProfile,
      addField,
      signOut,
    }),
    [
      ready,
      session,
      profile,
      orgQuery.data,
      orgId,
      displayName,
      farms.data,
      farms.isLoading,
      refreshProfile,
      addField,
      signOut,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <Toaster position="bottom-right" />
    </WorkspaceContext.Provider>
  );
}

const navigation = [
  { to: "/", name: "Overview", icon: LayoutDashboard },
  { to: "/ask", name: "Ask", icon: Sparkles },
  { to: "/videos", name: "Videos", icon: Video },
  { to: "/fields", name: "Fields", icon: Sprout },
  { to: "/wildlife", name: "Wildlife", icon: PawPrint },
  { to: "/review", name: "Review", icon: ScanEye },
  { to: "/claims", name: "Claims", icon: ClipboardCheck },
  { to: "/alerts", name: "Alerts", icon: Bell },
  { to: "/reports", name: "Reports", icon: FileText },
] as const;

function useHealth() {
  return useQuery({
    queryKey: ["health"],
    enabled: !!API_URL,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const resp = await fetch(`${API_URL}/healthz`);
      if (!resp.ok) throw new Error(String(resp.status));
      return (await resp.json()) as { ok: boolean; worker: string | boolean; llm: boolean };
    },
  });
}

export function FullPageLoader({ label = "Opening your workspace…" }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <span className="brand-mark">
        <Wheat />
      </span>
      <p>
        <Loader2 className="animate-spin" size={14} /> {label}
      </p>
    </div>
  );
}

export function Workspace({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { ready, session, profile, org, orgId, displayName } = useWorkspace();
  const dashboard = useDashboard(orgId);
  const health = useHealth();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!ready || path === "/login") return;
    if (!session) void navigate({ to: "/login", search: { redirect: path } });
    else if (profile && !profile.onboarded && path !== "/onboarding")
      void navigate({ to: "/onboarding" });
  }, [ready, session, profile, path, navigate]);

  if (!supabaseConfigured) return <SetupNotice />;
  if (!ready || !session || (profile && !profile.onboarded && path !== "/onboarding"))
    return <FullPageLoader />;

  const openAlerts = dashboard.data?.open_alerts ?? 0;
  const pendingReview = dashboard.data?.pending_review ?? 0;
  const counts: Partial<Record<string, number>> = { Alerts: openAlerts, Review: pendingReview };
  const serviceState = !API_URL
    ? "Analysis service not configured"
    : health.isError
      ? "Analysis service waking up"
      : health.data?.ok
        ? "All systems operational"
        : "Checking systems…";
  const crumb = path === "/" ? "Overview" : (path.split("/")[1] ?? "").replace("-", " ");

  return (
    <div className="workspace">
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Wheat />
          </span>
          <span>
            Crop Raid
            <br />
            <strong>Guard</strong>
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="close-menu"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        >
          <X />
        </Button>
        <div className="workspace-label">Field intelligence</div>
        <nav>
          {navigation.map(({ to, name, icon: Icon }) => {
            const count = counts[name] ?? 0;
            return (
              <Button
                asChild
                variant="ghost"
                key={to}
                className={`nav-item ${(to === "/" ? path === "/" : path.startsWith(to)) ? "active" : ""}`}
              >
                <Link to={to} onClick={() => setMenu(false)}>
                  <Icon />
                  <span>{name}</span>
                  {count > 0 && <span className="nav-count">{count > 99 ? "99" : count}</span>}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="sidebar-upload">
          <Button asChild className="w-full" size="lg">
            <Link to="/upload">
              <Plus />
              Upload video
            </Link>
          </Button>
        </div>
        <div className="sidebar-bottom">
          <div className="field-note">
            <Sprout size={22} />
            <p>
              A little more insight.
              <br />A little less uncertainty.
            </p>
            <span>Rooted in observation.</span>
          </div>
          <Button asChild variant="ghost" className="nav-item">
            <Link to="/api-docs">
              <Code2 />
              API & documentation
              <ArrowUpRight className="ml-auto" />
            </Link>
          </Button>
          <Button asChild variant="ghost" className="nav-item">
            <Link to="/settings">
              <Settings />
              Settings
            </Link>
          </Button>
          <Button asChild variant="ghost" className="profile">
            <Link to="/settings">
              <span className="avatar">{displayName.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0">
                <strong className="truncate">{displayName}</strong>
                <small className="truncate">{org?.name ?? "Personal workspace"}</small>
              </span>
              <ChevronDown size={15} />
            </Link>
          </Button>
        </div>
      </aside>
      {menu && <div className="mobile-backdrop" onClick={() => setMenu(false)} />}
      <div className="main-wrap">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{crumb}</strong>
            </span>
          </div>
          <div className="top-actions">
            {(dashboard.data?.videos_processing ?? 0) > 0 && (
              <Link to="/videos" className="demo-label">
                {dashboard.data?.videos_processing} analysing
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search workspace"
              onClick={() => setSearch(true)}
            >
              <Search />
            </Button>
            <Button asChild variant="ghost" size="icon">
              <Link
                to="/alerts"
                aria-label={`View alerts${openAlerts ? ` (${openAlerts} open)` : ""}`}
              >
                <Bell />
              </Link>
            </Button>
            <Button asChild variant="ghost" className="workspace-switch">
              <Link to="/fields">
                <span className="status-dot" />
                {org?.name ?? "My fields"}
                <ChevronDown />
              </Link>
            </Button>
          </div>
        </header>
        <main key={path} className="page-content">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Crop Raid Guard</span>
          <span>Observe thoughtfully. Protect responsibly.</span>
          <span>
            {serviceState} <i className={`status-dot ${health.data?.ok ? "" : "muted"}`} />
          </span>
        </footer>
      </div>
      {search && (
        <div className="modal-backdrop" onClick={() => setSearch(false)}>
          <section
            className="search-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
          >
            <form
              className="search-input"
              onSubmit={(e) => {
                e.preventDefault();
                if (!query.trim()) return;
                setSearch(false);
                void navigate({ to: "/ask", search: { q: query.trim() } });
              }}
            >
              <Search />
              <input
                autoFocus
                placeholder="Search pages, or ask about your fields…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSearch(false)}
                aria-label="Close search"
              >
                <X />
              </Button>
            </form>
            {navigation
              .filter((n) => !query || n.name.toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setSearch(false)}
                  className="search-result"
                >
                  <n.icon size={18} />
                  {n.name}
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            {query && (
              <Link
                to="/ask"
                search={{ q: query }}
                className="search-result"
                onClick={() => setSearch(false)}
              >
                <Sparkles size={18} />
                Ask “{query}”
                <Command size={16} />
              </Link>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <Sprout size={30} className="mb-6 text-primary" />
        <h1>Almost there.</h1>
        <p>
          This deployment is missing its Supabase settings. Add <code>VITE_SUPABASE_URL</code>,{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> and <code>VITE_API_URL</code> to the
          environment and redeploy.
        </p>
      </div>
    </div>
  );
}
