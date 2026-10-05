import { Fragment, useState, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Loader2, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace";
import {
  errorText,
  fmtShortDate,
  fmtTime,
  speciesPhoto,
  useSeries,
  useSignedUrls,
} from "@/lib/data";
import type { EventRow } from "@/lib/types";

export function Risk({ level }: { level: string }) {
  return (
    <span className={`risk-badge ${level.toLowerCase()}`}>
      {level === "Low" ? "Normal" : `${level} risk`}
    </span>
  );
}

export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function UploadLink() {
  return (
    <Button asChild>
      <Link to="/upload">
        <Plus />
        Upload video
      </Link>
    </Button>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="inline-loading" role="status">
      <Loader2 className="animate-spin" size={14} />
      {label}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="insight-note error-note" role="alert">
      <TriangleAlert size={18} />
      <div>
        <h3>This could not be loaded</h3>
        <p>{errorText(error)}</p>
        {retry && (
          <Button variant="link" size="sm" className="px-0" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

const PERIODS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = Math.ceil(n / 4);
  return step * 4;
}

export function ActivityChart({ farm, species }: { farm?: string; species?: string }) {
  const { orgId } = useWorkspace();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[0]);
  const series = useSeries(orgId, period.days, farm ?? null, species ?? null);
  const points = series.data ?? [];
  const max = niceMax(Math.max(0, ...points.map((p) => p.events)));
  const labelEvery = points.length > 8 ? 2 : 1;
  const first = points[0];
  const last = points.at(-1);
  const total = points.reduce((s, p) => s + p.events, 0);
  return (
    <section className="activity-section">
      <div className="section-heading">
        <h2>Wildlife activity</h2>
        <div className="segmented">
          {PERIODS.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              className={period.label === p.label ? "selected" : ""}
              onClick={() => setPeriod(p)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`${total} wildlife events during the last ${period.label}`}
      >
        <div className="chart-axis">
          {[max, (max * 2) / 3, max / 3, 0].map((v) => (
            <span key={v}>{Math.round(v)}</span>
          ))}
        </div>
        {series.isLoading && <Loading label="Loading activity…" />}
        {points.map((p, i) => (
          <div className="chart-day" key={p.bucket_start}>
            <div
              className="chart-bar"
              style={{ height: `${(p.events / max) * 100}%` }}
              title={`${p.events} wildlife event${p.events === 1 ? "" : "s"}`}
            />
            <div
              className="chart-bar secondary"
              style={{ height: `${(p.high_risk / max) * 100}%` }}
              title={`${p.high_risk} high-risk event${p.high_risk === 1 ? "" : "s"}`}
            />
            <span>{i % labelEvery === 0 ? p.label : ""}</span>
          </div>
        ))}
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
        <span className="ml-auto">
          {first && last
            ? `${fmtShortDate(first.bucket_start)} – ${fmtShortDate(last.bucket_start)}`
            : ""}
        </span>
      </div>
      {series.isError && <ErrorNote error={series.error} retry={() => void series.refetch()} />}
    </section>
  );
}

export function EventThumb({
  event,
  url,
}: {
  event: Pick<EventRow, "final_species_key" | "final_common_name">;
  url: string | undefined;
}) {
  return (
    <img
      src={url ?? speciesPhoto(event.final_species_key)}
      alt={event.final_common_name}
      loading="lazy"
    />
  );
}

export function EventTable({
  events,
  onSelect,
  empty,
}: {
  events: EventRow[];
  onSelect?: (e: EventRow) => void;
  empty?: ReactNode;
}) {
  const signed = useSignedUrls(
    "media",
    events.map((e) => e.keyframe_path),
  );
  if (!events.length)
    return (
      <div className="empty-state compact">
        <p>{empty ?? "No wildlife has been recorded yet. Upload footage to get started."}</p>
      </div>
    );
  return (
    <table className="event-table">
      <thead>
        <tr>
          <th>Detection</th>
          <th>Field</th>
          <th>Time captured</th>
          <th>Confidence</th>
          <th>Risk level</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td>
              <div className="event-species">
                <EventThumb event={e} url={signed(e.keyframe_path)} />
                <span>
                  {e.final_common_name}
                  <small>
                    {e.cameras?.name ?? "Camera"}
                    {e.needs_review && e.review_status === "pending" ? " · Needs review" : ""}
                  </small>
                </span>
              </div>
            </td>
            <td>{e.farms?.name ?? "—"}</td>
            <td>
              {fmtTime(e.started_at)}
              <small className="block text-muted-foreground">{fmtShortDate(e.started_at)}</small>
            </td>
            <td>{Math.round(e.species_conf * 100)}%</td>
            <td>
              <Risk level={e.risk_band} />
            </td>
            <td>
              {onSelect ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`View ${e.final_common_name} detection`}
                  onClick={() => onSelect(e)}
                >
                  <ArrowUpRight />
                </Button>
              ) : (
                <Button asChild variant="ghost" size="icon">
                  <Link
                    to="/videos/$id"
                    params={{ id: e.video_id }}
                    search={{ t: Math.floor(e.start_offset_s) }}
                    aria-label={`View ${e.final_common_name} detection`}
                  >
                    <ArrowUpRight />
                  </Link>
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Minimal, safe markdown: paragraphs, bullet lists, **bold**, [links](url) and [n] citations. No raw HTML. */
export function Markdown({ text, onCitation }: { text: string; onCitation?: (n: number) => void }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="markdown">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), onCitation)}</li>
              ))}
            </ul>
          );
        }
        const heading = /^#{1,4}\s+(.*)$/.exec(block);
        if (heading) return <h3 key={i}>{inline(heading[1] ?? "", onCitation)}</h3>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, onCitation)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string, onCitation?: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\[(\d{1,2})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, href, bold, cite] = m;
    if (label && href) {
      if (href.startsWith("/") && !href.startsWith("//")) {
        out.push(
          <InternalLink key={k++} href={href}>
            {label}
          </InternalLink>,
        );
      } else if (/^https?:\/\//.test(href)) {
        out.push(
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link"
          >
            {label}
          </a>,
        );
      } else out.push(label);
    } else if (bold) out.push(<strong key={k++}>{bold}</strong>);
    else if (cite) {
      const n = Number(cite);
      out.push(
        <button
          key={k++}
          type="button"
          className="cite"
          onClick={() => onCitation?.(n)}
          aria-label={`Source ${n}`}
        >
          {n}
        </button>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      className="inline-link"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.history.push(href);
      }}
    >
      {children}
    </a>
  );
}
