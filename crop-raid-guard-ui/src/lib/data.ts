import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { boar, deer, fieldImage } from "@/lib/demo";
import type {
  AlertRow,
  Camera,
  ClaimRow,
  Dashboard,
  EventRow,
  EvidencePackRow,
  FarmSummary,
  ReportRow,
  SeriesPoint,
  SpeciesSummary,
  VideoRow,
} from "@/lib/types";

const TZ = "Asia/Kolkata";

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
    ...opts,
  }).format(new Date(iso));
}

export function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TZ }).format(
    new Date(iso),
  );
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  })
    .format(new Date(iso))
    .toUpperCase();
}

export function fmtDateTime(iso: string | null | undefined) {
  return iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "—";
}

export function fmtLongDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(d);
}

export function fmtClock(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m} min`;
}

export function fmtHourRange(hour: number | null | undefined) {
  if (hour === null || hour === undefined) return "—";
  const f = (h: number) => {
    const hh = ((h + 11) % 12) + 1;
    return `${String(hh).padStart(2, "0")}:00`;
  };
  const next = (hour + 2) % 24;
  return `${f(hour)}–${f(next)} ${next < 12 ? "AM" : "PM"}`;
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return `Today, ${fmtTime(iso)}`;
  if (days === 1) return `Yesterday, ${fmtTime(iso)}`;
  return fmtDateTime(iso);
}

export function hoursLeft(deadline: string) {
  return (new Date(deadline).getTime() - Date.now()) / 3600000;
}

export function speciesSlug(key: string) {
  return key.replaceAll("_", "-");
}

export function speciesKeyFromSlug(slug: string) {
  return slug.replaceAll("-", "_");
}

/** Bundled photo for a species, used until a real keyframe is available. */
export const CROPS = [
  "Maize",
  "Wheat",
  "Rice",
  "Sugarcane",
  "Groundnut",
  "Cotton",
  "Vegetables",
  "Other",
];

export function speciesPhoto(key: string | null | undefined) {
  if (!key) return fieldImage;
  if (key.includes("boar") || key === "suid") return boar;
  if (/(deer|chital|sambar|blackbuck|nilgai|bovid|antelope)/.test(key)) return deer;
  return fieldImage;
}

export function errorText(err: unknown) {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string")
    return err.message;
  return "Something went wrong. Please try again.";
}

async function rows<T>(
  q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

const VIDEO_SELECT = "*, farms(name, crop), cameras(name), events(count)";
const EVENT_SELECT = "*, farms(name, crop), cameras(name)";

export function useDashboard(orgId: string | null) {
  return useQuery({
    queryKey: ["dashboard", orgId],
    enabled: !!orgId,
    queryFn: () => rows<Dashboard>(supabase.rpc("dashboard_summary", { p_org: orgId })),
  });
}

export function useSeries(
  orgId: string | null,
  days: number,
  farm?: string | null,
  species?: string | null,
) {
  return useQuery({
    queryKey: ["series", orgId, days, farm ?? null, species ?? null],
    enabled: !!orgId,
    queryFn: () =>
      rows<SeriesPoint[]>(
        supabase.rpc("activity_series", {
          p_org: orgId,
          p_days: days,
          p_farm: farm ?? null,
          p_species: species ?? null,
        }),
      ),
  });
}

export function useFarmSummaries(orgId: string | null) {
  return useQuery({
    queryKey: ["farms", orgId],
    enabled: !!orgId,
    queryFn: () => rows<FarmSummary[]>(supabase.rpc("farm_summaries", { p_org: orgId })),
  });
}

export function useCameras(orgId: string | null, farmId?: string) {
  return useQuery({
    queryKey: ["cameras", orgId, farmId ?? null],
    enabled: !!orgId,
    queryFn: () => {
      let q = supabase
        .from("cameras")
        .select("id, farm_id, name, kind")
        .eq("org_id", orgId ?? "")
        .order("name");
      if (farmId) q = q.eq("farm_id", farmId);
      return rows<Camera[]>(q);
    },
  });
}

export function useSpecies(orgId: string | null, farm?: string | null) {
  return useQuery({
    queryKey: ["species", orgId, farm ?? null],
    enabled: !!orgId,
    queryFn: () =>
      rows<SpeciesSummary[]>(
        supabase.rpc("species_summary", { p_org: orgId, p_farm: farm ?? null }),
      ),
  });
}

export function useHourly(orgId: string | null, species?: string | null, farm?: string | null) {
  return useQuery({
    queryKey: ["hourly", orgId, species ?? null, farm ?? null],
    enabled: !!orgId,
    queryFn: () =>
      rows<{ hour: number; events: number }[]>(
        supabase.rpc("hourly_activity", {
          p_org: orgId,
          p_farm: farm ?? null,
          p_species: species ?? null,
        }),
      ),
  });
}

export function useVideos(orgId: string | null, farmId?: string) {
  return useQuery({
    queryKey: ["videos", orgId, farmId ?? null],
    enabled: !!orgId,
    queryFn: () => {
      let q = supabase
        .from("videos")
        .select(VIDEO_SELECT)
        .eq("org_id", orgId ?? "")
        .order("created_at", { ascending: false })
        .limit(200);
      if (farmId) q = q.eq("farm_id", farmId);
      return rows<VideoRow[]>(q);
    },
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: ["video", id],
    queryFn: () =>
      rows<VideoRow | null>(
        supabase.from("videos").select(VIDEO_SELECT).eq("id", id).maybeSingle(),
      ),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "processing" || s === "uploaded" ? 4000 : false;
    },
  });
}

export interface EventFilter {
  videoId?: string;
  farmId?: string;
  species?: string;
  needsReview?: boolean;
  ids?: string[];
  limit?: number;
  includeRejected?: boolean;
}

export function useEvents(orgId: string | null, f: EventFilter = {}) {
  return useQuery({
    queryKey: ["events", orgId, f],
    enabled: !!orgId,
    queryFn: () => {
      let q = supabase
        .from("events")
        .select(EVENT_SELECT)
        .eq("org_id", orgId ?? "");
      if (f.videoId) q = q.eq("video_id", f.videoId);
      if (f.farmId) q = q.eq("farm_id", f.farmId);
      if (f.species) q = q.eq("final_species_key", f.species);
      if (f.ids) q = q.in("id", f.ids.length ? f.ids : ["00000000-0000-0000-0000-000000000000"]);
      if (f.needsReview) q = q.eq("needs_review", true).eq("review_status", "pending");
      else if (!f.includeRejected) q = q.neq("review_status", "rejected");
      q = f.videoId ? q.order("start_offset_s") : q.order("started_at", { ascending: false });
      return rows<EventRow[]>(q.limit(f.limit ?? 100));
    },
  });
}

export interface DetectionRow {
  event_id: string;
  t_offset_s: number;
  bbox: number[];
  conf: number;
}

export function useDetections(orgId: string | null, eventIds: string[]) {
  return useQuery({
    queryKey: ["detections", orgId, eventIds],
    enabled: !!orgId && eventIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      rows<DetectionRow[]>(
        supabase
          .from("detections")
          .select("event_id, t_offset_s, bbox, conf")
          .eq("org_id", orgId ?? "")
          .in("event_id", eventIds)
          .eq("label", "animal")
          .order("t_offset_s")
          .limit(5000),
      ),
  });
}

/** Box at time t, linearly interpolated between the nearest sampled detections (within 2 s). */
export function boxAt(dets: DetectionRow[], t: number): number[] | null {
  if (!dets.length) return null;
  let before: DetectionRow | undefined;
  let after: DetectionRow | undefined;
  for (const d of dets) {
    if (d.t_offset_s <= t) {
      if (!before || d.t_offset_s > before.t_offset_s || d.conf > before.conf) before = d;
    } else {
      after = d;
      break;
    }
  }
  if (before && after && after.t_offset_s - before.t_offset_s <= 2.5) {
    const k = (t - before.t_offset_s) / (after.t_offset_s - before.t_offset_s);
    return before.bbox.map((v, i) => v + ((after.bbox[i] ?? v) - v) * k);
  }
  const near = [before, after].filter(
    (d): d is DetectionRow => !!d && Math.abs(d.t_offset_s - t) <= 2,
  );
  return (
    near.sort((a, b) => Math.abs(a.t_offset_s - t) - Math.abs(b.t_offset_s - t))[0]?.bbox ?? null
  );
}

export function useAlerts(orgId: string | null) {
  return useQuery({
    queryKey: ["alerts", orgId],
    enabled: !!orgId,
    queryFn: () =>
      rows<AlertRow[]>(
        supabase
          .from("alerts")
          .select("*, farms(name), events(keyframe_path, start_offset_s, contains_people)")
          .eq("org_id", orgId ?? "")
          .order("last_seen_at", { ascending: false })
          .limit(100),
      ),
  });
}

export function useReports(orgId: string | null) {
  return useQuery({
    queryKey: ["reports", orgId],
    enabled: !!orgId,
    queryFn: () =>
      rows<ReportRow[]>(
        supabase
          .from("reports")
          .select("*")
          .eq("org_id", orgId ?? "")
          .order("created_at", { ascending: false })
          .limit(50),
      ),
  });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: ["report", id],
    queryFn: () =>
      rows<ReportRow | null>(supabase.from("reports").select("*").eq("id", id).maybeSingle()),
  });
}

export function useClaims(orgId: string | null) {
  return useQuery({
    queryKey: ["claims", orgId],
    enabled: !!orgId,
    queryFn: () =>
      rows<ClaimRow[]>(
        supabase
          .from("claims")
          .select("*, farms(name)")
          .eq("org_id", orgId ?? "")
          .order("created_at", { ascending: false })
          .limit(100),
      ),
  });
}

export function useClaim(id: string) {
  return useQuery({
    queryKey: ["claim", id],
    queryFn: () =>
      rows<ClaimRow | null>(
        supabase.from("claims").select("*, farms(name)").eq("id", id).maybeSingle(),
      ),
  });
}

export function useEvidencePack(id: string | null | undefined) {
  return useQuery({
    queryKey: ["evidence", id],
    enabled: !!id,
    queryFn: () =>
      rows<EvidencePackRow | null>(
        supabase
          .from("evidence_packs")
          .select("id, manifest_sha256, signing_key_id, size_bytes, created_at, event_ids")
          .eq("id", id ?? "")
          .maybeSingle(),
      ),
  });
}

/** Signed URLs for private storage objects, cached for 50 minutes. */
export function useSignedUrls(
  bucket: "media" | "videos" | "evidence",
  paths: (string | null | undefined)[],
) {
  const list = useMemo(() => [...new Set(paths.filter((p): p is string => !!p))].sort(), [paths]);
  const query = useQuery({
    queryKey: ["signed", bucket, list],
    enabled: list.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(list, 3600);
      if (error) throw new Error(error.message);
      const out: Record<string, string> = {};
      for (const item of data ?? [])
        if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
      return out;
    },
  });
  return (path: string | null | undefined) => (path ? query.data?.[path] : undefined);
}

/** Refresh cached data when the worker updates videos, events or alerts for this workspace. */
export function useRealtime(orgId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!orgId) return undefined;
    const filter = `org_id=eq.${orgId}`;
    const refresh = (keys: string[][]) =>
      keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    const channel = supabase
      .channel(`org-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "videos", filter }, (p) => {
        const id = (p.new as { id?: string } | null)?.id;
        refresh([["videos"], ["dashboard"], ...(id ? [["video", id]] : [])]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter }, () =>
        refresh([["events"], ["dashboard"], ["series"], ["species"], ["farms"], ["hourly"]]),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter }, () =>
        refresh([["alerts"], ["dashboard"]]),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, qc]);
}
