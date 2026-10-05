import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  MapPin,
  Sprout,
  PawPrint,
  Video,
  ShieldAlert,
  Sparkles,
  Play,
  Pause,
  Maximize,
  Upload,
  Plus,
  Search,
  Clock,
  ChevronRight,
  FileText,
  Download,
  Check,
  Bell,
  X,
  Camera,
  Leaf,
  CheckCircle2,
  Loader2,
  Settings,
  RotateCcw,
  ClipboardCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Workspace, useWorkspace } from "@/components/workspace";
import {
  ActivityChart,
  ErrorNote,
  EventTable,
  EventThumb,
  Heading,
  Loading,
  Markdown,
  Risk,
  UploadLink,
} from "@/components/common";
import { AskPanel } from "@/components/agent";
import { EventDrawer } from "@/components/claims";
import { boar, fieldImage, downloadText } from "@/lib/demo";
import {
  boxAt,
  CROPS,
  errorText,
  fmtClock,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtHourRange,
  fmtLongDate,
  fmtShortDate,
  relativeTime,
  speciesKeyFromSlug,
  speciesPhoto,
  speciesSlug,
  useAlerts,
  useCameras,
  useDashboard,
  useDetections,
  useEvents,
  useHourly,
  useReport,
  useReports,
  useSignedUrls,
  useSpecies,
  useVideo,
  useVideos,
} from "@/lib/data";
import { api, post } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { EventRow, FarmSummary, ReportRow, RiskBand, VideoRow } from "@/lib/types";

export { Risk } from "@/components/common";
export { Login, Onboarding } from "@/components/auth";

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function bandFor(score: number): RiskBand {
  return score >= 70 ? "High" : score >= 40 ? "Moderate" : "Low";
}

// ------------------------------------------------------------------ Overview
export function Overview() {
  const { displayName, fields, orgId } = useWorkspace();
  const dashboard = useDashboard(orgId);
  const recent = useEvents(orgId, { limit: 6 });
  const alerts = useAlerts(orgId);
  const d = dashboard.data;
  const delta = d ? d.events_7d - d.events_prev_7d : 0;
  const topFields = [...fields]
    .sort((a, b) => b.risk_score - a.risk_score || b.events_7d - a.events_7d)
    .slice(0, 3);
  const hero = topFields[0];
  const insight = alerts.data?.find((a) => a.status === "open");
  return (
    <Workspace>
      <Heading
        title={`${greeting()}, ${displayName.split(" ")[0]}.`}
        description="A closer look at the life around your fields."
        action={
          <div className="date">
            <CalendarDays size={14} />
            {fmtLongDate()}
          </div>
        }
      />
      <section className="hero-landscape">
        <img
          src={fieldImage}
          alt="Maize fields bordering a forest at sunrise"
          width={1536}
          height={1024}
        />
        <div className="hero-copy">
          <span className="hero-kicker">
            <Leaf size={13} />
            Your fields. A bigger picture.
          </span>
          <h2>
            Where nature meets
            <br />
            understanding.
          </h2>
          <p>
            Every sighting tells a story. Discover what’s
            <br />
            moving, when it appears, and what it means.
          </p>
          <Link to="/upload">
            Explore your footage <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="hero-location">
          <MapPin size={12} />
          {hero ? `${hero.name} · ${hero.crop} plantation` : "Add your first field"}
        </div>
      </section>
      {dashboard.isError && (
        <ErrorNote error={dashboard.error} retry={() => void dashboard.refetch()} />
      )}
      <section className="metrics">
        {[
          {
            label: "Active risks",
            value: d ? String(d.active_risks) : "–",
            note: d && d.active_risks > 0 ? "Needs your attention" : "All calm for now",
            icon: ShieldAlert,
            warn: !!d && d.active_risks > 0,
          },
          {
            label: "Wildlife events",
            value: d ? String(d.events_7d) : "–",
            note: d
              ? delta === 0
                ? "Same as last week"
                : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} vs last week`
              : "This week",
            icon: PawPrint,
          },
          {
            label: "Videos analyzed",
            value: d ? String(d.videos_7d) : "–",
            note: "This week",
            icon: Video,
          },
          {
            label: "Fields monitored",
            value: String(fields.length),
            note: d ? `${d.cameras} camera${d.cameras === 1 ? "" : "s"}` : "",
            icon: Sprout,
          },
        ].map((m) => (
          <div className="metric" key={m.label}>
            <div className="metric-label">
              <m.icon size={14} />
              {m.label}
            </div>
            <div className="metric-value">
              <strong>{m.value}</strong>
              <span className={`metric-note ${m.warn ? "warning" : ""}`}>{m.note}</span>
            </div>
          </div>
        ))}
      </section>
      <div className="overview-columns">
        <ActivityChart />
        <section>
          <div className="section-heading">
            <h2>A view across your fields</h2>
            <Link to="/fields">
              All fields
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="field-risk-list">
            {topFields.map((f) => (
              <Link to="/fields/$id" params={{ id: f.id }} key={f.id} className="field-risk-row">
                <span className="field-icon">
                  <Sprout size={17} />
                </span>
                <span>
                  <strong>{f.name}</strong>
                  <small>
                    {f.crop} · {f.cameras} camera{f.cameras === 1 ? "" : "s"}
                  </small>
                </span>
                <span className="ml-auto">
                  <Risk level={f.risk_band} />
                </span>
                <ChevronRight size={13} className="text-muted-foreground" />
              </Link>
            ))}
            {!fields.length && (
              <Link to="/fields/new" className="field-risk-row">
                <span className="field-icon">
                  <Plus size={17} />
                </span>
                <span>
                  <strong>Add your first field</strong>
                  <small>Name it, choose the crop, then upload footage.</small>
                </span>
              </Link>
            )}
          </div>
          <div className="insight-note">
            <Sparkles size={18} />
            <div>
              {insight ? (
                <>
                  <h3>{insight.title}</h3>
                  <p>{insight.body}</p>
                  {insight.video_id ? (
                    <Link
                      to="/videos/$id"
                      params={{ id: insight.video_id }}
                      search={{ t: Math.floor(insight.events?.start_offset_s ?? 0) }}
                    >
                      View the evidence
                      <ArrowUpRight size={12} />
                    </Link>
                  ) : (
                    <Link to="/alerts">
                      Open alerts
                      <ArrowUpRight size={12} />
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <h3>Nothing urgent right now</h3>
                  <p>
                    When animals return repeatedly or at risky hours, the pattern will show up here.
                  </p>
                  <Link to="/ask">
                    Ask about your fields
                    <ArrowUpRight size={12} />
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <h2>Recent encounters</h2>
          <Link to="/videos">
            View all activity
            <ArrowUpRight size={13} />
          </Link>
        </div>
        {recent.isLoading ? (
          <Loading />
        ) : recent.isError ? (
          <ErrorNote error={recent.error} />
        ) : (
          <EventTable events={recent.data ?? []} />
        )}
      </section>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Videos
function useVideoRisk(orgId: string | null) {
  return useQuery({
    queryKey: ["events", orgId, "video-risk"],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("video_id, risk_score")
        .eq("org_id", orgId ?? "")
        .neq("review_status", "rejected")
        .limit(5000);
      if (error) throw new Error(error.message);
      const max: Record<string, number> = {};
      for (const r of (data ?? []) as { video_id: string; risk_score: number }[])
        max[r.video_id] = Math.max(max[r.video_id] ?? 0, r.risk_score);
      return max;
    },
  });
}

function videoStatusLabel(v: VideoRow) {
  if (v.status === "failed") return "Analysis failed";
  if (v.status === "completed") return null;
  return v.status === "processing" ? `Analysing · ${v.progress}%` : "Waiting to analyse";
}

export function Videos() {
  const { orgId } = useWorkspace();
  const videos = useVideos(orgId);
  const risk = useVideoRisk(orgId);
  const [filter, setFilter] = useState("All videos");
  const [query, setQuery] = useState("");
  const list = videos.data ?? [];
  const signed = useSignedUrls(
    "media",
    list.map((v) => v.thumbnail_path),
  );
  const filtered = list.filter((v) => {
    const band = bandFor(risk.data?.[v.id] ?? 0);
    const pending = v.status !== "completed" && v.status !== "failed";
    if (filter === "Completed" && v.status !== "completed") return false;
    if (filter === "High risk" && (v.status !== "completed" || band !== "High")) return false;
    if (filter === "Processing" && !pending) return false;
    return `${v.title} ${v.farms?.name ?? ""} ${v.cameras?.name ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  return (
    <Workspace>
      <Heading
        title="Your footage, in focus."
        description="The moments that matter, gathered in one place."
        action={<UploadLink />}
      />
      <div className="toolbar">
        <div className="filter-search">
          <Search size={15} />
          <input
            aria-label="Search videos"
            placeholder="Search your videos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented">
          {["All videos", "Completed", "High risk", "Processing"].map((t) => (
            <Button
              key={t}
              variant="ghost"
              className={filter === t ? "selected" : ""}
              onClick={() => setFilter(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      {videos.isLoading && <Loading label="Loading your footage…" />}
      {videos.isError && <ErrorNote error={videos.error} retry={() => void videos.refetch()} />}
      <div className="card-grid">
        {filtered.map((v) => {
          const status = videoStatusLabel(v);
          const count = v.events?.[0]?.count ?? 0;
          const done = v.status === "completed";
          return (
            <Link
              to={done || v.status === "failed" ? "/videos/$id" : "/videos/$id/processing"}
              params={{ id: v.id }}
              className="media-card"
              key={v.id}
            >
              <div className="card-image">
                <img
                  src={signed(v.thumbnail_path) ?? fieldImage}
                  alt={`Camera trap footage from ${v.farms?.name ?? "your field"}`}
                  loading="lazy"
                />
                {status ? (
                  <span className={`risk-badge ${v.status === "failed" ? "high" : ""}`}>
                    {status}
                  </span>
                ) : (
                  <Risk level={bandFor(risk.data?.[v.id] ?? 0)} />
                )}
                {v.duration_s ? <span className="duration">{fmtClock(v.duration_s)}</span> : null}
              </div>
              <div className="card-body">
                <h3>{v.title}</h3>
                <p>
                  {fmtDate(v.captured_at)} · {v.farms?.name ?? "Field"}
                  {v.cameras?.name ? ` · ${v.cameras.name}` : ""}
                </p>
                <div className="card-bottom">
                  <span className="flex gap-2 items-center">
                    <PawPrint size={13} />
                    {done
                      ? `${count} wildlife event${count === 1 ? "" : "s"}`
                      : (v.stage ?? "Queued for analysis")}
                  </span>
                  <ArrowUpRight size={16} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!videos.isLoading && filtered.length === 0 && (
        <div className="empty-state">
          <Video className="mx-auto mb-4" />
          <h2>
            {filter === "Processing"
              ? "All caught up."
              : list.length
                ? "No matching footage."
                : "No footage yet."}
          </h2>
          <p>
            {filter === "Processing"
              ? "There are no videos being processed."
              : list.length
                ? "Try a different search or upload a new video."
                : "Upload a camera-trap video and we’ll find the wildlife in it."}
          </p>
          {!list.length && (
            <div className="mt-5">
              <UploadLink />
            </div>
          )}
        </div>
      )}
    </Workspace>
  );
}

// ------------------------------------------------------------------ Video detail
function peakHourOf(events: EventRow[]) {
  if (!events.length) return null;
  const counts = new Map<number, number>();
  for (const e of events) {
    const h = Number(
      new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        hour12: false,
        timeZone: "Asia/Kolkata",
      }).format(new Date(e.started_at)),
    );
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function VideoDetail({ id, t }: { id: string; t?: number }) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const videoQ = useVideo(id);
  const eventsQ = useEvents(orgId, { videoId: id, includeRejected: false, limit: 500 });
  const v = videoQ.data;
  const events = eventsQ.data ?? [];
  const media = useSignedUrls("media", [v?.playback_path, ...events.map((e) => e.keyframe_path)]);
  const raw = useSignedUrls("videos", [v && !v.playback_path ? v.storage_path : null]);
  const eventIds = useMemo(() => events.map((e) => e.id), [events]);
  const detections = useDetections(orgId, eventIds).data ?? [];
  const src = v ? (v.playback_path ? media(v.playback_path) : raw(v.storage_path)) : undefined;
  const videoEl = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(t ?? 0);
  const [playing, setPlaying] = useState(false);
  const [drawer, setDrawer] = useState<EventRow | null>(null);
  const duration = v?.duration_s ?? 0;

  useEffect(() => {
    if (t === undefined) return;
    setTime(t);
    if (videoEl.current) videoEl.current.currentTime = t;
    stage.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [t]);

  const reanalyze = useMutation({
    mutationFn: () => post<{ status: string; message?: string }>(`/v1/videos/${id}/analyze`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["video", id] });
      void navigate({ to: "/videos/$id/processing", params: { id } });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (videoQ.isLoading)
    return (
      <Workspace>
        <Loading label="Loading footage…" />
      </Workspace>
    );
  if (!v)
    return (
      <Workspace>
        <div className="empty-state">
          <h1>Video not found</h1>
          <p>It may have been removed, or it belongs to another workspace.</p>
          <Button asChild className="mt-5">
            <Link to="/videos">All videos</Link>
          </Button>
        </div>
      </Workspace>
    );

  const current =
    events.find((e) => time >= e.start_offset_s - 0.5 && time <= e.end_offset_s + 0.5) ?? null;
  const selected = current ?? events[0] ?? null;
  const top = [...events].sort((a, b) => b.risk_score - a.risk_score)[0];
  const species = new Set(events.map((e) => e.final_species_key));
  const highRisk = events.filter((e) => e.risk_band === "High").length;
  const bbox = current
    ? (boxAt(
        detections.filter((d) => d.event_id === current.id),
        time,
      ) ?? current.best_bbox)
    : null;
  const seek = (s: number) => {
    setTime(s);
    if (videoEl.current) videoEl.current.currentTime = s;
  };
  const toggle = () => {
    const el = videoEl.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  const pending = v.status !== "completed";

  return (
    <Workspace>
      <Heading
        title={v.title}
        description={`${fmtDateTime(v.captured_at)} · ${duration ? fmtClock(duration) : "—"} · ${v.farms?.name ?? "Field"}${v.cameras?.name ? ` · ${v.cameras.name}` : ""}`}
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/videos">
                <Video />
                All videos
              </Link>
            </Button>
          </div>
        }
      />
      {pending && (
        <div className="insight-note mb-6">
          {v.status === "failed" ? (
            <TriangleAlert size={18} />
          ) : (
            <Loader2 size={18} className="animate-spin" />
          )}
          <div>
            <h3>
              {v.status === "failed" ? "This video could not be analysed" : "Analysis in progress"}
            </h3>
            <p>
              {v.status === "failed"
                ? (v.error ?? "Something went wrong.")
                : (v.stage ?? "Waiting for an analysis worker")}
            </p>
            {v.status === "failed" ? (
              <Button
                variant="link"
                size="sm"
                className="px-0"
                disabled={reanalyze.isPending}
                onClick={() => reanalyze.mutate()}
              >
                <RotateCcw /> Try again
              </Button>
            ) : (
              <Link to="/videos/$id/processing" params={{ id }}>
                Follow progress <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
        </div>
      )}
      {v.capture_time_mismatch && (
        <div className="insight-note mb-6">
          <Clock size={18} />
          <div>
            <h3>Check the capture time</h3>
            <p>
              The time stored in the video file differs from the time entered at upload by more than
              a day. Event times use the time you entered.
            </p>
          </div>
        </div>
      )}
      <div className="viewer-grid">
        <div>
          <div
            ref={stage}
            className={`video-stage ${playing ? "playing" : ""}`}
            style={v.width && v.height ? { aspectRatio: `${v.width} / ${v.height}` } : undefined}
          >
            {src ? (
              <video
                ref={videoEl}
                src={src}
                playsInline
                preload="metadata"
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  if (t !== undefined) e.currentTarget.currentTime = t;
                }}
              />
            ) : (
              <img
                src={
                  selected
                    ? (media(selected.keyframe_path) ?? speciesPhoto(selected.final_species_key))
                    : fieldImage
                }
                alt="Footage preview"
              />
            )}
            <div className="frame-label">
              <Camera size={12} />
              {v.cameras?.name ?? v.farms?.name ?? "Camera"}
            </div>
            {current && bbox && bbox.length === 4 && (
              <div
                className="detection-box live"
                style={{
                  left: `${(bbox[0] ?? 0) * 100}%`,
                  top: `${(bbox[1] ?? 0) * 100}%`,
                  width: `${(bbox[2] ?? 0) * 100}%`,
                  height: `${(bbox[3] ?? 0) * 100}%`,
                }}
              >
                <span>
                  {current.final_common_name} · {Math.round(current.species_conf * 100)}%
                </span>
              </div>
            )}
          </div>
          <div className="video-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label={playing ? "Pause footage" : "Play footage"}
              onClick={toggle}
              disabled={!src}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <span className="timecode">
              {fmtClock(time)} / {fmtClock(duration)}
            </span>
            <div className="scrubber">
              <input
                aria-label="Video position"
                type="range"
                min="0"
                max={Math.max(duration, 1)}
                step="0.1"
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
              />
              {duration > 0 &&
                events.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`marker ${e.risk_band.toLowerCase()}`}
                    style={{ left: `${(e.start_offset_s / duration) * 100}%` }}
                    title={`${fmtClock(e.start_offset_s)} · ${e.final_common_name}`}
                    aria-label={`Jump to ${e.final_common_name} at ${fmtClock(e.start_offset_s)}`}
                    onClick={() => seek(e.start_offset_s)}
                  />
                ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fullscreen footage"
              onClick={() => void stage.current?.requestFullscreen?.()}
            >
              <Maximize />
            </Button>
          </div>
          <section className="timeline">
            <div className="section-heading">
              <h2>The activity timeline</h2>
              <span>
                {events.length} event{events.length === 1 ? "" : "s"} detected
              </span>
            </div>
            {eventsQ.isLoading && <Loading />}
            {!eventsQ.isLoading && !events.length && !pending && (
              <p className="text-muted-foreground text-xs py-6">
                No wildlife was detected in this footage.
              </p>
            )}
            {events.map((e) => (
              <div className="flex items-center border-b border-border" key={e.id}>
                <Button
                  variant="ghost"
                  className={`timeline-item ${current?.id === e.id ? "selected" : ""}`}
                  onClick={() => seek(e.start_offset_s)}
                >
                  <span className="timecode">{fmtClock(e.start_offset_s)}</span>
                  <EventThumb event={e} url={media(e.keyframe_path)} />
                  <span>
                    <strong>{e.final_common_name}</strong>
                    <small>
                      {Math.round(e.species_conf * 100)}% confidence · {fmtDuration(e.duration_s)}
                      {e.needs_review && e.review_status === "pending" ? " · Needs review" : ""}
                    </small>
                  </span>
                  <span className="ml-auto">
                    <Risk level={e.risk_band} />
                  </span>
                  <Play size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Detection details at ${fmtClock(e.start_offset_s)}`}
                  onClick={() => setDrawer(e)}
                >
                  <ArrowUpRight />
                </Button>
              </div>
            ))}
          </section>
        </div>
        <aside className="viewer-sidebar">
          <section className="info-section">
            <h2>A closer look</h2>
            {[
              ["Duration", duration ? fmtDuration(duration) : "—"],
              ["Species detected", String(species.size)],
              ["Wildlife events", String(events.length)],
              ["High-risk events", String(highRisk)],
              ["Peak activity", fmtHourRange(peakHourOf(events))],
            ].map(([l, s]) => (
              <div className="info-row" key={l}>
                <span>{l}</span>
                <strong>{s}</strong>
              </div>
            ))}
          </section>
          <section className="info-section">
            <div className="section-heading">
              <h2>Crop-raid risk</h2>
              <Risk level={top?.risk_band ?? "Low"} />
            </div>
            <div className="risk-score">
              <strong>{top?.risk_score ?? 0}</strong>
              <div>
                <span>out of 100</span>
                <small>Heuristic, not a probability</small>
              </div>
            </div>
            {top ? (
              <ul>
                {top.risk_factors
                  .filter((f) => f.contribution > 0)
                  .sort((a, b) => b.contribution - a.contribution)
                  .slice(0, 5)
                  .map((f) => (
                    <li key={f.key}>
                      {f.label} · +{Math.round(f.contribution)} of {f.weight}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs mb-3">
                No risk to report for this footage.
              </p>
            )}
            {top && (
              <Button variant="outline" size="sm" onClick={() => setDrawer(top)}>
                View evidence
                <ArrowUpRight />
              </Button>
            )}
          </section>
          <section className="info-section">
            <h2>What the footage tells us</h2>
            <p>
              {top?.description ??
                (pending
                  ? "The story will appear here once the analysis is complete."
                  : "Nothing moved through this camera’s view that looked like wildlife.")}
            </p>
            <p className="mt-3">Risk scores indicate patterns, not confirmed crop damage.</p>
            {v.model_versions["vision"] && (
              <p className="mt-3 text-muted-foreground text-xs">
                Analysed with {v.model_versions["vision"]} · {v.frames_analyzed ?? 0} of{" "}
                {v.frames_sampled ?? 0} sampled frames
              </p>
            )}
            {v.status === "completed" && (
              <Button
                variant="link"
                size="sm"
                className="px-0 mt-1"
                disabled={reanalyze.isPending}
                onClick={() => reanalyze.mutate()}
              >
                <RotateCcw /> Re-run analysis
              </Button>
            )}
          </section>
        </aside>
      </div>
      <AskPanel
        videoId={id}
        title="Ask this footage"
        placeholder="What animal appeared most often?"
        suggestions={[
          "What appeared most often?",
          "Show high-risk events",
          "When did the first animal appear?",
        ]}
      />
      {drawer && (
        <EventDrawer
          event={drawer}
          keyframe={media(drawer.keyframe_path)}
          onClose={() => setDrawer(null)}
          onWatch={() => {
            seek(drawer.start_offset_s);
            setDrawer(null);
            stage.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      )}
    </Workspace>
  );
}

// ------------------------------------------------------------------ Fields
export function Fields() {
  const { fields, fieldsLoading } = useWorkspace();
  return (
    <Workspace>
      <Heading
        title="Rooted in your fields."
        description="Every field has its own story. Keep yours in view."
        action={
          <Button asChild>
            <Link to="/fields/new">
              <Plus />
              Add field
            </Link>
          </Button>
        }
      />
      {fieldsLoading && <Loading />}
      <div className="card-grid">
        {fields.map((f, i) => (
          <Link to="/fields/$id" params={{ id: f.id }} className="media-card" key={f.id}>
            <div className="card-image">
              <img
                src={fieldImage}
                alt={`${f.name} landscape`}
                loading="lazy"
                style={{ objectPosition: `${(i * 30) % 100}% center` }}
              />
              <Risk level={f.risk_band} />
            </div>
            <div className="card-body">
              <h2>{f.name}</h2>
              <p>
                {f.crop} plantation{f.village ? ` · ${f.village}` : ""}
              </p>
              <div className="flex gap-5 mt-5 text-muted-foreground text-xs">
                <span className="flex items-center gap-2">
                  <Camera size={13} />
                  {f.cameras} camera{f.cameras === 1 ? "" : "s"}
                </span>
                <span className="flex items-center gap-2">
                  <Video size={13} />
                  {f.videos} video{f.videos === 1 ? "" : "s"}
                </span>
              </div>
              <div className="card-bottom">
                <span>Open field</span>
                <ArrowUpRight size={16} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!fieldsLoading && !fields.length && (
        <div className="empty-state">
          <Sprout className="mx-auto mb-4" />
          <h2>No fields yet.</h2>
          <p>Add a field to group your cameras and footage.</p>
        </div>
      )}
    </Workspace>
  );
}

export function NewField() {
  const { addField } = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [crop, setCrop] = useState("Maize");
  const [village, setVillage] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Workspace>
      <div className="form-page">
        <Heading
          title="A new field to watch."
          description="Start with a name. The rest can grow over time."
        />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              const id = await addField({ name, crop, village, description });
              toast.success("Your field has been created");
              void navigate({ to: "/fields/$id", params: { id } });
            } catch (err) {
              toast.error(errorText(err));
              setSaving(false);
            }
          }}
        >
          <div className="form-grid">
            <label className="full">
              Field name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. West Field"
                required
                maxLength={60}
              />
            </label>
            <label>
              Crop type
              <select value={crop} onChange={(e) => setCrop(e.target.value)}>
                {CROPS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Location (optional)
              <input
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="Village or region"
                maxLength={120}
              />
            </label>
            <label className="full">
              Description (optional)
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A few notes about this field…"
                maxLength={2000}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Create field
            </Button>
            <Button asChild variant="outline">
              <Link to="/fields">Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    </Workspace>
  );
}

export function FieldDetail({ id }: { id: string }) {
  const { fields, fieldsLoading, orgId } = useWorkspace();
  const qc = useQueryClient();
  const field = fields.find((f) => f.id === id);
  const cameras = useCameras(orgId, id);
  const species = useSpecies(orgId, id);
  const hourly = useHourly(orgId, null, id);
  const recent = useEvents(orgId, { farmId: id, limit: 8 });
  const [adding, setAdding] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const addCamera = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("cameras")
        .insert({ org_id: orgId, farm_id: id, name: name.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAdding(false);
      setCameraName("");
      toast.success("Camera added");
      void qc.invalidateQueries({ queryKey: ["cameras"] });
      void qc.invalidateQueries({ queryKey: ["farms"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (fieldsLoading)
    return (
      <Workspace>
        <Loading />
      </Workspace>
    );
  if (!field)
    return (
      <Workspace>
        <div className="empty-state">
          <h1>Field not found</h1>
          <p>This field isn’t part of your workspace.</p>
          <Button asChild className="mt-5">
            <Link to="/fields">All fields</Link>
          </Button>
        </div>
      </Workspace>
    );
  const peak = [...(hourly.data ?? [])].sort((a, b) => b.events - a.events)[0];
  return (
    <Workspace>
      <Heading
        title={field.name}
        description={`${field.crop} · ${field.cameras} camera${field.cameras === 1 ? "" : "s"} · Field intelligence`}
        action={<UploadLink />}
      />
      <section className="hero-landscape">
        <img src={fieldImage} alt={field.name} />
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sprout size={14} />
            {field.crop} plantation
          </span>
          <h2>
            A living landscape.
            <br />A clearer perspective.
          </h2>
          <p>{field.description ?? `Follow the wildlife activity around ${field.name}.`}</p>
        </div>
        <div className="hero-location">
          <Risk level={field.risk_band} />
        </div>
      </section>
      <section className="metrics">
        {[
          ["Videos analyzed", field.videos],
          ["Wildlife events", field.events],
          ["Species detected", species.data?.length ?? 0],
          ["Cameras active", field.cameras],
        ].map(([l, n]) => (
          <div className="metric" key={l}>
            <div className="metric-label">{l}</div>
            <div className="metric-value">
              <strong>{n}</strong>
            </div>
          </div>
        ))}
      </section>
      <div className="overview-columns">
        <ActivityChart farm={id} />
        <section>
          <div className="section-heading">
            <h2>Species activity</h2>
            <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>
              <Plus />
              Add camera
            </Button>
          </div>
          {adding && (
            <form
              className="ask-form"
              onSubmit={(e) => {
                e.preventDefault();
                addCamera.mutate(cameraName);
              }}
            >
              <input
                aria-label="Camera name"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
                placeholder="Camera name, e.g. North gate"
                required
                maxLength={60}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Save camera"
                disabled={addCamera.isPending}
              >
                {addCamera.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              </Button>
            </form>
          )}
          {(species.data ?? []).slice(0, 6).map((s) => (
            <Link
              to="/wildlife/$species"
              params={{ species: speciesSlug(s.species_key) }}
              className="info-row"
              key={s.species_key}
            >
              <span>{s.common_name}</span>
              <strong>
                {s.events} event{s.events === 1 ? "" : "s"}
              </strong>
            </Link>
          ))}
          {!species.isLoading && !species.data?.length && (
            <p className="text-muted-foreground text-xs mt-4">
              No wildlife recorded on this field yet.
            </p>
          )}
          {!!cameras.data?.length && (
            <p className="text-muted-foreground text-xs mt-4">
              Cameras: {cameras.data.map((c) => c.name).join(", ")}
            </p>
          )}
          {peak && peak.events > 0 && (
            <div className="insight-note">
              <Clock size={17} />
              <div>
                <h3>
                  {peak.hour >= 19 || peak.hour < 6 ? "After the sun goes down" : "During the day"}
                </h3>
                <p>Most recorded activity occurs between {fmtHourRange(peak.hour)}.</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <h2>Recent field encounters</h2>
        </div>
        {recent.isLoading ? (
          <Loading />
        ) : (
          <EventTable events={recent.data ?? []} empty="No encounters on this field yet." />
        )}
      </section>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Wildlife
function useBestKeyframes(ids: (string | null)[]) {
  const { orgId } = useWorkspace();
  const list = ids.filter((x): x is string => !!x);
  const q = useEvents(orgId, { ids: list, limit: 100 });
  const byId = new Map((q.data ?? []).map((e) => [e.id, e]));
  const signed = useSignedUrls(
    "media",
    (q.data ?? []).map((e) => e.keyframe_path),
  );
  return (id: string | null) => {
    const e = id ? byId.get(id) : undefined;
    return { event: e, url: e ? signed(e.keyframe_path) : undefined };
  };
}

export function Wildlife() {
  const { orgId } = useWorkspace();
  const species = useSpecies(orgId);
  const best = useBestKeyframes((species.data ?? []).map((s) => s.best_event_id));
  return (
    <Workspace>
      <Heading
        title="Meet your wild neighbours."
        description="An ever-growing picture of the species around your fields."
      />
      {species.isLoading && <Loading />}
      {species.isError && <ErrorNote error={species.error} />}
      <div className="card-grid">
        {(species.data ?? []).map((s) => (
          <Link
            to="/wildlife/$species"
            params={{ species: speciesSlug(s.species_key) }}
            key={s.species_key}
            className="media-card"
          >
            <div className="card-image">
              <img
                src={best(s.best_event_id).url ?? speciesPhoto(s.species_key)}
                alt={s.common_name}
                loading="lazy"
              />
              <Risk level={bandFor(s.max_risk)} />
            </div>
            <div className="card-body">
              <h2>{s.common_name}</h2>
              <p className="italic">{s.scientific_name ?? "Species not confirmed"}</p>
              <div className="info-row mt-4">
                <span>Recorded encounters</span>
                <strong>{s.events}</strong>
              </div>
              <div className="info-row">
                <span>Fields detected</span>
                <strong>{s.farms}</strong>
              </div>
              <div className="card-bottom">
                <span>Most active {fmtHourRange(s.peak_hour)}</span>
                <ArrowUpRight size={16} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!species.isLoading && !species.data?.length && (
        <div className="empty-state">
          <PawPrint className="mx-auto mb-4" />
          <h2>No wildlife recorded yet.</h2>
          <p>Species appear here as soon as your first footage is analysed.</p>
        </div>
      )}
    </Workspace>
  );
}

export function WildlifeDetail({ species: slug }: { species: string }) {
  const { orgId } = useWorkspace();
  const key = speciesKeyFromSlug(slug);
  const summary = useSpecies(orgId);
  const s = summary.data?.find((x) => x.species_key === key);
  const events = useEvents(orgId, { species: key, limit: 500 });
  const best = useBestKeyframes([s?.best_event_id ?? null]);
  const top = best(s?.best_event_id ?? null);
  const byField = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events.data ?? [])
      m.set(e.farms?.name ?? "Field", (m.get(e.farms?.name ?? "Field") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events.data]);
  if (summary.isLoading)
    return (
      <Workspace>
        <Loading />
      </Workspace>
    );
  if (!s)
    return (
      <Workspace>
        <div className="empty-state">
          <h1>No records yet</h1>
          <p>This species has not been recorded in your workspace.</p>
          <Button asChild className="mt-5">
            <Link to="/wildlife">All wildlife</Link>
          </Button>
        </div>
      </Workspace>
    );
  const night = s.peak_hour !== null && (s.peak_hour >= 19 || s.peak_hour < 6);
  return (
    <Workspace>
      <Heading
        title={s.common_name}
        description={`${s.scientific_name ?? "Species to be confirmed"} · ${s.events} recorded encounter${s.events === 1 ? "" : "s"}`}
        action={
          <Button asChild variant="outline">
            <Link to="/wildlife">
              <PawPrint />
              All wildlife
            </Link>
          </Button>
        }
      />
      <div className="viewer-grid">
        <div>
          <div className="video-stage">
            <img src={top.url ?? speciesPhoto(key)} alt={s.common_name} />
          </div>
          <section className="recent-section">
            <ActivityChart species={key} />
          </section>
        </div>
        <aside>
          <section className="info-section">
            <h2>Across your fields</h2>
            {byField.map(([l, n]) => (
              <div className="info-row" key={l}>
                <span>{l}</span>
                <strong>
                  {n} event{n === 1 ? "" : "s"}
                </strong>
              </div>
            ))}
          </section>
          <section className="info-section">
            <h2>When they appear</h2>
            <p>
              {s.peak_hour === null
                ? "Not enough sightings yet to see a pattern."
                : `${night ? "Mostly at night" : "Mostly during the day"}, with the most frequent visits between ${fmtHourRange(s.peak_hour)}. Last seen ${relativeTime(s.last_seen)}.`}
            </p>
            <div className="mt-5">
              <Risk level={bandFor(s.max_risk)} />
            </div>
          </section>
          {top.event && (
            <Button asChild>
              <Link
                to="/videos/$id"
                params={{ id: top.event.video_id }}
                search={{ t: Math.floor(top.event.start_offset_s) }}
              >
                <Play />
                Watch evidence
              </Link>
            </Button>
          )}
        </aside>
      </div>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Upload
const MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

async function sha256Hex(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function uploadWithProgress(
  path: string,
  file: File,
  contentType: string,
  token: string,
  onProgress: (p: number) => void,
) {
  const base = (import.meta.env["VITE_SUPABASE_URL"] as string).replace(/\/$/, "");
  const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    import.meta.env["VITE_SUPABASE_ANON_KEY"]) as string;
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/storage/v1/object/videos/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = "The upload failed. Please try again.";
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          if (body.message?.includes("exceeded"))
            msg = "This video is larger than the 50 MB limit.";
          else if (body.message) msg = body.message;
        } catch {
          /* keep default */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () =>
      reject(new Error("The connection dropped during upload. Please try again."));
    xhr.send(file);
  });
}

function localInputValue(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function UploadPage() {
  const { fields, orgId, session } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [farmId, setFarmId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [capturedAt, setCapturedAt] = useState(localInputValue());
  const [options, setOptions] = useState({ report: true, recurring: true, notify: false });
  const [phase, setPhase] = useState<"idle" | "hashing" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeFarm = farmId || fields[0]?.id || "";
  const cameras = useCameras(orgId, activeFarm || undefined);
  const crop = fields.find((f) => f.id === activeFarm)?.crop;

  const choose = (f?: File) => {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!VIDEO_TYPES[ext]) {
      setError("Please choose an MP4, MOV or WebM video.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(
        "Please choose a video smaller than 50 MB. Trim long recordings into shorter clips.",
      );
      return;
    }
    setError("");
    setFile(f);
    if (f.lastModified) setCapturedAt(localInputValue(new Date(f.lastModified)));
  };

  const submit = async () => {
    if (!file || !orgId || !session) return;
    if (!activeFarm) {
      setError("Add a field first, then upload footage for it.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
    const contentType = VIDEO_TYPES[ext] ?? "video/mp4";
    const id = crypto.randomUUID();
    const path = `${orgId}/${id}.${ext}`;
    try {
      setPhase("hashing");
      const sha = await sha256Hex(file);
      const { data: dup } = await supabase
        .from("videos")
        .select("id, title")
        .eq("org_id", orgId)
        .eq("sha256", sha)
        .maybeSingle();
      if (dup) {
        const existing = dup as { id: string; title: string };
        toast.info(`This video was already uploaded as “${existing.title}”.`);
        void navigate({ to: "/videos/$id", params: { id: existing.id } });
        return;
      }
      setPhase("uploading");
      await uploadWithProgress(path, file, contentType, session.access_token, setProgress);
      setPhase("saving");
      const { error: insertError } = await supabase.from("videos").insert({
        id,
        org_id: orgId,
        farm_id: activeFarm,
        camera_id: cameraId || null,
        uploaded_by: session.user.id,
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "Field video",
        storage_path: path,
        original_filename: file.name.slice(0, 200),
        size_bytes: file.size,
        sha256: sha,
        mime: contentType,
        captured_at: new Date(capturedAt).toISOString(),
        options,
      });
      if (insertError) {
        await supabase.storage.from("videos").remove([path]);
        throw new Error(insertError.message);
      }
      void qc.invalidateQueries({ queryKey: ["videos"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void navigate({ to: "/videos/$id/processing", params: { id } });
    } catch (err) {
      setError(errorText(err));
      setPhase("idle");
      setProgress(0);
    }
  };

  const busy = phase !== "idle";
  return (
    <Workspace>
      <div className="form-page">
        <Heading
          title="Let your footage tell its story."
          description="Bring a camera-trap video into focus."
        />
        <div
          className={`dropzone ${drag ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <Upload size={32} />
          <h2>{file ? "Your footage is ready." : "Drop your video here"}</h2>
          <p>MP4, MOV or WebM · Up to 50 MB</p>
          <input
            hidden
            ref={fileInput}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Video />
            {file ? "Choose another video" : "Choose video"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-3">
            {error}
          </p>
        )}
        {file && (
          <div className="selected-file">
            <Video />
            <div>
              <strong>{file.name}</strong>
              <small>
                {(file.size / 1024 ** 2).toFixed(1)} MB ·{" "}
                {phase === "hashing"
                  ? "Fingerprinting…"
                  : phase === "uploading"
                    ? `Uploading ${progress}%`
                    : phase === "saving"
                      ? "Starting analysis…"
                      : "Ready for analysis"}
              </small>
              {phase === "uploading" && (
                <div className="progress-track slim">
                  <div style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <Button
              className="ml-auto"
              variant="ghost"
              size="icon"
              aria-label="Remove selected file"
              onClick={() => setFile(null)}
              disabled={busy}
            >
              <X />
            </Button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) {
              setError("Choose a video to continue.");
              return;
            }
            void submit();
          }}
        >
          {!fields.length ? (
            <div className="insight-note mb-6">
              <Sprout size={18} />
              <div>
                <h3>Add a field first</h3>
                <p>Footage is organised by field so risk can be tracked over time.</p>
                <Link to="/fields/new">
                  Add a field <ArrowUpRight size={12} />
                </Link>
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <label>
                Field
                <select
                  value={activeFarm}
                  onChange={(e) => {
                    setFarmId(e.target.value);
                    setCameraId("");
                  }}
                >
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Camera
                <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                  <option value="">Not specified</option>
                  {(cameras.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date and time captured
                <input
                  type="datetime-local"
                  value={capturedAt}
                  onChange={(e) => setCapturedAt(e.target.value)}
                  max={localInputValue()}
                  required
                />
              </label>
              <label>
                Crop
                <input value={crop ?? ""} readOnly aria-readonly="true" title="Set on the field" />
              </label>
            </div>
          )}
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={options.report}
                onChange={(e) => setOptions({ ...options, report: e.target.checked })}
              />
              Generate a wildlife report
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.recurring}
                onChange={(e) => setOptions({ ...options, recurring: e.target.checked })}
              />
              Identify recurring activity
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.notify}
                onChange={(e) => setOptions({ ...options, notify: e.target.checked })}
              />
              Notify me about moderate-risk events too
            </label>
          </div>
          <Button type="submit" disabled={!file || busy || !fields.length}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? "Uploading…" : "Analyse footage"}
            {!busy && <ArrowRight />}
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Your footage is stored privately in your workspace. People in frames are blurred in
            shared evidence.
          </p>
        </form>
      </div>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Processing
const STEPS = [
  { label: "Prepare camera-trap footage", at: 12 },
  { label: "Identify wildlife encounters", at: 72 },
  { label: "Group recurring events", at: 76 },
  { label: "Build risk insights and evidence", at: 96 },
];

export function Processing({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const video = useVideo(id);
  const v = video.data;
  const progress = v?.status === "completed" ? 100 : (v?.progress ?? 0);
  const waitingSince = v?.created_at ? Date.now() - new Date(v.created_at).getTime() : 0;
  useEffect(() => {
    if (v?.status === "completed") {
      const t = setTimeout(() => void navigate({ to: "/videos/$id", params: { id } }), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [v?.status, id, navigate]);
  const retry = useMutation({
    mutationFn: () => post(`/v1/videos/${id}/analyze`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["video", id] }),
    onError: (e) => toast.error(errorText(e)),
  });
  const failed = v?.status === "failed";
  return (
    <Workspace>
      <section className="processing">
        {failed ? (
          <TriangleAlert className="mx-auto mb-6" size={30} />
        ) : (
          <Sparkles className="mx-auto mb-6" size={30} />
        )}
        <h1>
          {failed
            ? "We couldn’t finish this one."
            : progress === 100
              ? "Your story is ready."
              : "Bringing the details into focus."}
        </h1>
        <p>
          {failed
            ? (v?.error ?? "Something went wrong during analysis.")
            : v?.status === "queued" && waitingSince > 45000
              ? "Waiting for the analysis server. On the free plan it can take a minute to wake up."
              : (v?.title ?? "Analysing your footage")}
        </p>
        <div className="processing-image">
          <img src={boar} alt="Wildlife analysis in progress" />
        </div>
        <div className="progress-track">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span>
            {failed ? "Analysis stopped" : (v?.stage ?? "Waiting for an analysis worker")}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="checks text-left">
          {STEPS.map((s) => (
            <div className="flex gap-3 items-center text-muted-foreground text-xs" key={s.label}>
              {progress >= s.at ? <CheckCircle2 size={15} /> : <Clock size={15} />} {s.label}
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-center">
          {failed && (
            <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
              <RotateCcw />
              Try again
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to="/videos">{failed ? "Back to videos" : "Continue in the background"}</Link>
          </Button>
        </div>
      </section>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Alerts
export function Alerts() {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  const alerts = useAlerts(orgId);
  const [filter, setFilter] = useState("Open");
  const [detail, setDetail] = useState<string | null>(null);
  const list = alerts.data ?? [];
  const signed = useSignedUrls(
    "media",
    list.map((a) => a.events?.keyframe_path),
  );
  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("resolve_alert", { p_alert: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Alert marked as resolved");
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const open = list.filter((a) => a.status === "open").length;
  const shown = list.filter((a) =>
    filter === "Resolved"
      ? a.status === "resolved"
      : filter === "Open"
        ? a.status === "open"
        : true,
  );
  const selected = list.find((a) => a.id === detail);
  return (
    <Workspace>
      <Heading
        title="A little heads-up."
        description="The patterns that deserve a closer look."
        action={
          <Button asChild variant="outline">
            <Link to="/settings">
              <Settings />
              Alert settings
            </Link>
          </Button>
        }
      />
      <div className="toolbar">
        <span className="text-muted-foreground text-xs">
          {open} alert{open === 1 ? "" : "s"} need{open === 1 ? "s" : ""} attention
        </span>
        <div className="segmented">
          {["All alerts", "Open", "Resolved"].map((f) => (
            <Button
              key={f}
              variant="ghost"
              className={filter === f ? "selected" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>
      {alerts.isLoading && <Loading />}
      {alerts.isError && <ErrorNote error={alerts.error} />}
      <div className="alert-list">
        {shown.map((a) => (
          <article className="alert-row" key={a.id}>
            <span className="alert-icon">
              <ShieldAlert size={21} />
            </span>
            <div>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              <small>
                {a.farms?.name ?? "Field"} · {relativeTime(a.last_seen_at)}
                {a.occurrences > 1 ? ` · ${a.occurrences} sightings` : ""}
                {a.channels["telegram"]?.length ? " · Sent on Telegram" : ""}
              </small>
              <div className="flex gap-2 mt-3">
                <Button variant="link" size="sm" onClick={() => setDetail(a.id)}>
                  View evidence
                  <ArrowUpRight />
                </Button>
                {a.status === "open" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate(a.id)}
                  >
                    <Check />
                    Resolve
                  </Button>
                )}
              </div>
            </div>
            <div className="alert-meta">
              <Risk level={a.severity} />
              {a.status === "resolved" && <small>Resolved</small>}
            </div>
          </article>
        ))}
      </div>
      {!alerts.isLoading && !shown.length && (
        <div className="empty-state">
          <Bell className="mx-auto mb-4" />
          <h2>
            {filter === "Resolved"
              ? "No resolved alerts yet."
              : filter === "Open"
                ? "Nothing needs attention."
                : "No alerts yet."}
          </h2>
          <p>Alerts appear when high-risk or repeated wildlife activity is detected.</p>
        </div>
      )}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setDetail(null)}>
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Alert evidence"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="close-drawer"
              onClick={() => setDetail(null)}
              aria-label="Close alert"
            >
              <X />
            </Button>
            <h2>{selected.title}</h2>
            <img
              src={signed(selected.events?.keyframe_path) ?? speciesPhoto(selected.species_key)}
              alt="Alert evidence"
            />
            <Risk level={selected.severity} />
            <p className="mt-5">{selected.body}</p>
            <p className="mt-3 text-muted-foreground">
              Alerts are based on species, event frequency, time of day and crop context. They do
              not confirm damage.
            </p>
            <div className="flex gap-2 mt-6 flex-wrap">
              {selected.video_id && (
                <Button asChild>
                  <Link
                    to="/videos/$id"
                    params={{ id: selected.video_id }}
                    search={{ t: Math.floor(selected.events?.start_offset_s ?? 0) }}
                  >
                    <Play />
                    Open supporting footage
                  </Link>
                </Button>
              )}
              {selected.event_id && (
                <Button asChild variant="outline">
                  <Link to="/claims" search={{ event: selected.event_id }}>
                    <ClipboardCheck />
                    Prepare claim
                  </Link>
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </Workspace>
  );
}

// ------------------------------------------------------------------ Reports
function reportText(r: ReportRow) {
  const s = r.stats;
  const lines = [
    `Crop Raid Guard — ${r.title}`,
    `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`,
    "",
    r.narrative ?? "",
    "",
    "Totals",
    `Wildlife events: ${s.totals.events} (${s.totals.high_risk} high-risk, ${s.totals.night_events} at night)`,
    `Species: ${s.totals.species} · Videos: ${s.totals.videos}`,
    "",
    "Species",
    ...s.species.map((x) => `${x.species}: ${x.events} events (${x.high_risk} high-risk)`),
    "",
    "Fields",
    ...s.farms.map(
      (f) =>
        `${f.farm} (${f.crop}): ${f.events} events · ${f.risk_band === "Low" ? "Normal" : f.risk_band}`,
    ),
    "",
    "Methodology",
    "Detections by SpeciesNet (MegaDetector + species classifier). Risk scores describe activity patterns from species, crop, visit frequency, time of day, trend, dwell time and group size. They do not establish crop damage.",
  ];
  return lines.join("\n");
}

export function Reports() {
  const { orgId, fields } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reports = useReports(orgId);
  const [days, setDays] = useState(7);
  const [farm, setFarm] = useState("");
  const generate = useMutation({
    mutationFn: () => {
      const end = new Date();
      const start = new Date(end.getTime() - (days - 1) * 86400000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return post<{ id: string }>("/v1/reports", {
        kind: farm ? "farm" : days > 7 ? "custom" : "weekly",
        farm_id: farm || null,
        start: iso(start),
        end: iso(end),
        title: farm
          ? `${fields.find((f) => f.id === farm)?.name ?? "Field"} wildlife summary`
          : days > 7
            ? `${days}-day activity overview`
            : null,
      });
    },
    onSuccess: (r) => {
      toast.success("Report ready");
      void qc.invalidateQueries({ queryKey: ["reports"] });
      void navigate({ to: "/reports/$id", params: { id: r.id } });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Workspace>
      <Heading
        title="The bigger picture, on paper."
        description="Thoughtful summaries of your field and wildlife activity."
        action={
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Generate report
          </Button>
        }
      />
      <div className="report-cover">
        <img src={fieldImage} alt="Field landscape report cover" />
        <h2>A week in the wild.</h2>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant="ghost"
              className={days === d ? "selected" : ""}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
        <select
          aria-label="Report field"
          className="max-w-56"
          value={farm}
          onChange={(e) => setFarm(e.target.value)}
        >
          <option value="">All fields</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="section-heading">
        <h2>Your field reports</h2>
        <span>
          {reports.data?.length ?? 0} report{reports.data?.length === 1 ? "" : "s"}
        </span>
      </div>
      {reports.isLoading && <Loading />}
      {reports.isError && <ErrorNote error={reports.error} />}
      {(reports.data ?? []).map((r) => (
        <div className="report-row" key={r.id}>
          <FileText size={26} />
          <div>
            <h3>{r.title}</h3>
            <p>
              {fmtShortDate(r.period_start)} – {fmtDate(r.period_end)} · {r.stats.totals.events}{" "}
              event{r.stats.totals.events === 1 ? "" : "s"} · {r.stats.farms.length} field
              {r.stats.farms.length === 1 ? "" : "s"} · Ready
            </p>
          </div>
          <div className="report-actions">
            <Button asChild variant="outline" size="sm">
              <Link to="/reports/$id" params={{ id: r.id }}>
                Open report
                <ArrowUpRight />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Download ${r.title}`}
              onClick={() =>
                downloadText(
                  `${r.title.toLowerCase().replaceAll(" ", "-")}-${r.period_end}.txt`,
                  reportText(r),
                )
              }
            >
              <Download />
            </Button>
          </div>
        </div>
      ))}
      {!reports.isLoading && !reports.data?.length && (
        <div className="empty-state compact">
          <p>
            No reports yet. Generate one, or tick “Generate a wildlife report” when uploading
            footage.
          </p>
        </div>
      )}
    </Workspace>
  );
}

function StaticChart({ daily }: { daily: ReportRow["stats"]["daily"] }) {
  const max = Math.max(4, ...daily.map((d) => d.events));
  return (
    <section className="activity-section">
      <div className="section-heading">
        <h2>Wildlife activity</h2>
      </div>
      <div className="chart" role="img" aria-label="Daily wildlife events in this report">
        <div className="chart-axis">
          {[max, (max * 2) / 3, max / 3, 0].map((v) => (
            <span key={v}>{Math.round(v)}</span>
          ))}
        </div>
        {daily.map((d, i) => (
          <div className="chart-day" key={d.day}>
            <div
              className="chart-bar"
              style={{ height: `${(d.events / max) * 100}%` }}
              title={`${d.events} events`}
            />
            <div
              className="chart-bar secondary"
              style={{ height: `${(d.high_risk / max) * 100}%` }}
              title={`${d.high_risk} high-risk`}
            />
            <span>{daily.length <= 10 || i % 2 === 0 ? fmtShortDate(d.day) : ""}</span>
          </div>
        ))}
        {!daily.length && (
          <p className="text-muted-foreground text-xs">No events in this period.</p>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <i />
          Wildlife events
        </span>
        <span>
          <i className="secondary" />
          High-risk events
        </span>
      </div>
    </section>
  );
}

export function ReportDetail({ id }: { id: string }) {
  const report = useReport(id);
  const r = report.data;
  if (report.isLoading)
    return (
      <Workspace>
        <Loading />
      </Workspace>
    );
  if (!r)
    return (
      <Workspace>
        <div className="empty-state">
          <h1>Report not found</h1>
          <Button asChild className="mt-5">
            <Link to="/reports">All reports</Link>
          </Button>
        </div>
      </Workspace>
    );
  const s = r.stats;
  const topEvent = s.top_events[0];
  return (
    <Workspace>
      <Heading
        title={r.title}
        description={`${fmtDate(r.period_start)} – ${fmtDate(r.period_end)} · ${s.totals.events} wildlife events`}
        action={
          <Button onClick={() => window.print()}>
            <Download />
            Print / Save PDF
          </Button>
        }
      />
      <div className="report-cover">
        <img src={fieldImage} alt="Fields at sunrise" />
        <h2>Field observations</h2>
      </div>
      <div className="overview-columns">
        <section>
          <div className="info-section">
            <h2>Executive summary</h2>
            {r.narrative ? (
              <Markdown text={r.narrative} />
            ) : (
              <p>No summary was written for this report.</p>
            )}
          </div>
          <StaticChart daily={s.daily} />
          <section className="recent-section">
            <h2>Methodology</h2>
            <p className="text-muted-foreground text-xs mt-3">
              Detections come from SpeciesNet (MegaDetector plus a species classifier, geofenced to
              India). Risk scores reflect species, crop, visit frequency, time of day, trend, dwell
              time and group size; they do not establish crop damage. Events marked as “not an
              animal” during review are excluded.
            </p>
          </section>
        </section>
        <section>
          <div className="info-section">
            <h2>Species recorded</h2>
            {s.species.map((x) => (
              <div className="info-row" key={x.species}>
                <span>{x.species}</span>
                <strong>
                  {x.events} event{x.events === 1 ? "" : "s"}
                </strong>
              </div>
            ))}
            {!s.species.length && (
              <p className="text-muted-foreground text-xs">None in this period.</p>
            )}
          </div>
          <div className="info-section">
            <h2>Field comparison</h2>
            {s.farms.map((f: ReportRow["stats"]["farms"][number]) => (
              <div className="info-row" key={f.farm}>
                <span>{f.farm}</span>
                <Risk level={f.risk_band} />
              </div>
            ))}
          </div>
          {topEvent && (
            <Button asChild variant="outline">
              <Link
                to="/videos/$id"
                params={{ id: topEvent.video_id }}
                search={{ t: Math.floor(topEvent.start_offset_s) }}
              >
                View supporting evidence
                <ArrowUpRight />
              </Link>
            </Button>
          )}
        </section>
      </div>
    </Workspace>
  );
}

export { SettingsPage, ApiDocs } from "@/components/settings";
