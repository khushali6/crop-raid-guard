import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  FileSignature,
  FileText,
  Loader2,
  PackageCheck,
  Pencil,
  Play,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Workspace, useWorkspace } from "@/components/workspace";
import { ErrorNote, EventTable, EventThumb, Heading, Loading, Risk } from "@/components/common";
import { api, post } from "@/lib/api";
import {
  errorText,
  fmtDateTime,
  fmtDuration,
  hoursLeft,
  relativeTime,
  speciesPhoto,
  useClaim,
  useClaims,
  useEvents,
  useEvidencePack,
  useSignedUrls,
} from "@/lib/data";
import { supabase } from "@/lib/supabase";
import type { ClaimRow, ClaimStatus, EventRow } from "@/lib/types";

const FALLBACK_SPECIES = [
  { key: "wild_boar", common: "Wild boar" },
  { key: "nilgai", common: "Nilgai" },
  { key: "blackbuck", common: "Blackbuck" },
  { key: "spotted_deer", common: "Spotted deer" },
  { key: "sambar", common: "Sambar deer" },
  { key: "asian_elephant", common: "Asian elephant" },
  { key: "gaur", common: "Gaur" },
  { key: "rhesus_macaque", common: "Rhesus macaque" },
  { key: "langur", common: "Gray langur" },
  { key: "indian_peafowl", common: "Indian peafowl" },
  { key: "porcupine", common: "Indian crested porcupine" },
  { key: "golden_jackal", common: "Golden jackal" },
  { key: "cattle", common: "Cattle (domestic)" },
  { key: "feral_dog", common: "Dog" },
  { key: "wild_bovid", common: "Antelope or wild cattle (possibly nilgai)" },
  { key: "primate", common: "Monkey" },
  { key: "animal", common: "Unidentified animal" },
];

const FILED_VIA = [
  { value: "crop_insurance_app", label: "Crop Insurance App" },
  { value: "office", label: "Insurance or agriculture office" },
  { value: "agent", label: "Bank, CSC or insurance agent" },
  { value: "helpline", label: "PMFBY helpline (14447)" },
  { value: "other", label: "Other" },
] as const;

function useSpeciesOptions() {
  return useQuery({
    queryKey: ["species-options"],
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const list = await api<{ key: string; common: string }[]>("/v1/species");
        return list.length ? list : FALLBACK_SPECIES;
      } catch {
        return FALLBACK_SPECIES;
      }
    },
  });
}

function invalidateEventData(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["events", "dashboard", "species", "series", "farms", "hourly"])
    void qc.invalidateQueries({ queryKey: [key] });
}

function useReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      decision: "confirm" | "correct" | "reject";
      key?: string;
      common?: string;
    }) => {
      const { error } = await supabase.rpc("review_event", {
        p_event: v.id,
        p_decision: v.decision,
        p_species_key: v.key ?? null,
        p_common_name: v.common ?? null,
      });
      if (error) throw new Error(error.message);
      return v.decision;
    },
    onSuccess: (d) => {
      toast.success(
        d === "reject"
          ? "Marked as not an animal"
          : d === "correct"
            ? "Species corrected"
            : "Detection confirmed",
      );
      invalidateEventData(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

function useCreateClaim() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (v: { farm: string; events: string[] }) => {
      const { data, error } = await supabase.rpc("create_claim", {
        p_farm: v.farm,
        p_event_ids: v.events,
      });
      if (error) throw new Error(error.message);
      return data as ClaimRow;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["claims"] });
      toast.success("Draft claim created");
      void navigate({ to: "/claims/$id", params: { id: c.id } });
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

function ReviewControls({ event, compact = false }: { event: EventRow; compact?: boolean }) {
  const review = useReview();
  const species = useSpeciesOptions();
  const [correcting, setCorrecting] = useState(false);
  const [choice, setChoice] = useState("");
  const options = (species.data ?? FALLBACK_SPECIES).filter(
    (s) => s.key !== event.final_species_key,
  );
  if (correcting)
    return (
      <div className="review-correct">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Correct species"
        >
          <option value="">Choose the species…</option>
          {options.map((s) => (
            <option key={s.key} value={s.key}>
              {s.common}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!choice || review.isPending}
          onClick={() => {
            const s = options.find((o) => o.key === choice);
            if (s)
              review.mutate(
                { id: event.id, decision: "correct", key: s.key, common: s.common },
                { onSuccess: () => setCorrecting(false) },
              );
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>
          Cancel
        </Button>
      </div>
    );
  return (
    <div className={`review-actions ${compact ? "compact" : ""}`}>
      <Button
        size="sm"
        disabled={review.isPending}
        onClick={() => review.mutate({ id: event.id, decision: "confirm" })}
      >
        <Check />
        Looks right
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={review.isPending}
        onClick={() => setCorrecting(true)}
      >
        <Pencil />
        Different animal
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={review.isPending}
        onClick={() => review.mutate({ id: event.id, decision: "reject" })}
      >
        <XCircle />
        Not an animal
      </Button>
    </div>
  );
}

const REVIEW_LABEL: Record<string, string> = {
  confirmed: "Confirmed by you",
  corrected: "Corrected by you",
  rejected: "Marked as not an animal",
};

export function EventDrawer({
  event,
  keyframe,
  onClose,
  onWatch,
}: {
  event: EventRow;
  keyframe: string | undefined;
  onClose: () => void;
  onWatch?: () => void;
}) {
  const { orgId } = useWorkspace();
  const create = useCreateClaim();
  const { data: fresh } = useEvents(orgId, { ids: [event.id], includeRejected: true });
  const e = fresh?.[0] ?? event;
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => k.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const withinWindow = Date.now() - new Date(e.started_at).getTime() < 72 * 3_600_000;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Event evidence"
        onClick={(x) => x.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon"
          className="close-drawer"
          onClick={onClose}
          aria-label="Close event"
        >
          <X />
        </Button>
        <h2>{e.final_common_name}</h2>
        <p className="text-muted-foreground text-sm">
          {fmtDateTime(e.started_at)} · {Math.round(e.species_conf * 100)}% confidence
        </p>
        <img
          src={keyframe ?? speciesPhoto(e.final_species_key)}
          alt={`${e.final_common_name} keyframe`}
        />
        <Risk level={e.risk_band} />
        <section className="info-section">
          <dl>
            <div>
              <dt>Field</dt>
              <dd>{e.farms?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Camera</dt>
              <dd>{e.cameras?.name ?? "Uploaded clip"}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{fmtDuration(e.duration_s)}</dd>
            </div>
            <div>
              <dt>Animals in frame</dt>
              <dd>{e.max_individuals}</dd>
            </div>
            {e.final_species_key !== e.species_key && (
              <div>
                <dt>Model guess</dt>
                <dd>{e.common_name}</dd>
              </div>
            )}
          </dl>
        </section>
        {e.risk_factors.length > 0 && (
          <section className="info-section">
            <h2>Why this risk score ({e.risk_score}/100)</h2>
            <ul className="factor-list">
              {e.risk_factors.map((f) => (
                <li key={f.key}>
                  <span>
                    {f.label}
                    <small>up to {f.weight} points</small>
                  </span>
                  <b>+{Math.round(f.contribution)}</b>
                  <i
                    style={{
                      width: `${Math.min(100, (f.contribution / Math.max(1, f.weight)) * 100)}%`,
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="info-section">
          <h2>Is this right?</h2>
          {e.review_status === "pending" ? (
            <>
              {e.needs_review && (
                <p className="mb-3">
                  The model was unsure about this one. A quick check keeps your counts and claims
                  accurate.
                </p>
              )}
              <ReviewControls event={e} />
            </>
          ) : (
            <p className="flex items-center gap-2">
              <CheckCircle2 size={14} />
              {REVIEW_LABEL[e.review_status]}
            </p>
          )}
        </section>
        <div className="flex gap-2 mt-6 flex-wrap">
          {onWatch ? (
            <Button onClick={onWatch}>
              <Play />
              Watch this moment
            </Button>
          ) : (
            <Button asChild>
              <Link
                to="/videos/$id"
                params={{ id: e.video_id }}
                search={{ t: Math.floor(e.start_offset_s) }}
              >
                <Play />
                Open footage
              </Link>
            </Button>
          )}
          {e.review_status !== "rejected" && (
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={() => create.mutate({ farm: e.farm_id, events: [e.id] })}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
              Prepare claim
            </Button>
          )}
        </div>
        {!withinWindow && e.review_status !== "rejected" && (
          <p className="mt-3 text-muted-foreground text-xs">
            This visit is older than 72 hours. Crop insurance usually needs losses reported within
            72 hours, so check with your insurer before filing.
          </p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Claims board
const STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: "Draft",
  evidence_ready: "Evidence ready",
  approved: "Approved",
  submitted: "Filed",
  paid: "Paid",
  rejected: "Not accepted",
};

function Deadline({ claim }: { claim: Pick<ClaimRow, "deadline_at" | "status"> }) {
  if (["submitted", "paid", "rejected"].includes(claim.status))
    return <span className="deadline-chip done">{STATUS_LABEL[claim.status]}</span>;
  const h = hoursLeft(claim.deadline_at);
  if (h <= 0) return <span className="deadline-chip late">Past 72 hours</span>;
  return (
    <span className={`deadline-chip ${h < 12 ? "urgent" : ""}`}>
      <Clock3 size={12} />
      {h < 1 ? "Under 1 hour left" : `${Math.floor(h)}h left to report`}
    </span>
  );
}

export function Claims({ event }: { event?: string }) {
  const { orgId, fields } = useWorkspace();
  const claims = useClaims(orgId);
  const recent = useEvents(orgId, { limit: 60 });
  const create = useCreateClaim();
  const [picked, setPicked] = useState<string[]>(event ? [event] : []);
  useEffect(() => {
    if (event) setPicked([event]);
  }, [event]);
  const candidates = useMemo(() => {
    const cutoff = Date.now() - 96 * 3_600_000;
    return (recent.data ?? []).filter(
      (e) => new Date(e.started_at).getTime() > cutoff || picked.includes(e.id),
    );
  }, [recent.data, picked]);
  const extra = useEvents(orgId, {
    ids: event && !candidates.some((c) => c.id === event) ? [event] : [],
  });
  const list = [
    ...(extra.data ?? []).filter((e) => !candidates.some((c) => c.id === e.id)),
    ...candidates,
  ];
  const signed = useSignedUrls(
    "media",
    list.map((e) => e.keyframe_path),
  );
  const selected = list.filter((e) => picked.includes(e.id));
  const farm = selected[0]?.farm_id;
  const toggle = (e: EventRow) =>
    setPicked((p) =>
      p.includes(e.id)
        ? p.filter((x) => x !== e.id)
        : farm && farm !== e.farm_id
          ? [e.id]
          : [...p, e.id],
    );
  return (
    <Workspace>
      <Heading
        title="Evidence, ready in time."
        description="Turn a night visit into a complete, signed claim within the 72-hour reporting window."
      />
      <section className="claims-start">
        <div className="section-heading">
          <h2>Start a claim</h2>
          <span>
            {selected.length
              ? `${selected.length} visit${selected.length === 1 ? "" : "s"} selected`
              : "Choose the visits that caused the loss"}
          </span>
        </div>
        {recent.isLoading && <Loading />}
        {!recent.isLoading && !list.length && (
          <div className="empty-state compact">
            <h2>No recent visits.</h2>
            <p>Visits from the last four days appear here. Upload footage to add more.</p>
          </div>
        )}
        <div className="claim-candidates">
          {list.map((e) => (
            <button
              type="button"
              key={e.id}
              className={`candidate ${picked.includes(e.id) ? "selected" : ""}`}
              onClick={() => toggle(e)}
              aria-pressed={picked.includes(e.id)}
            >
              <EventThumb event={e} url={signed(e.keyframe_path)} />
              <span className="candidate-text">
                <b>{e.final_common_name}</b>
                <small>
                  {e.farms?.name ?? "Field"} · {relativeTime(e.started_at)}
                </small>
              </span>
              <Risk level={e.risk_band} />
              <i className="tick">{picked.includes(e.id) && <Check size={12} />}</i>
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="claim-start-bar">
            <span>
              {fields.find((f) => f.id === farm)?.name ?? "Field"} · earliest visit{" "}
              {relativeTime(selected.map((s) => s.started_at).sort()[0])}
            </span>
            <Button
              disabled={create.isPending || !farm}
              onClick={() => farm && create.mutate({ farm, events: selected.map((s) => s.id) })}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
              Create draft claim
            </Button>
          </div>
        )}
      </section>
      <section className="mt-12">
        <div className="section-heading">
          <h2>Your claims</h2>
          <span>{claims.data?.length ?? 0} total</span>
        </div>
        {claims.isLoading && <Loading />}
        {claims.isError && <ErrorNote error={claims.error} retry={() => void claims.refetch()} />}
        <div className="report-list">
          {(claims.data ?? []).map((c) => (
            <Link key={c.id} to="/claims/$id" params={{ id: c.id }} className="report-row">
              <FileSignature size={22} />
              <div>
                <h3>{c.title}</h3>
                <p>
                  {c.farms?.name ?? "Field"} · incident {fmtDateTime(c.incident_at)} ·{" "}
                  {c.event_ids.length} visit{c.event_ids.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="report-actions">
                <span className={`status-badge claim-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                <Deadline claim={c} />
                <ArrowUpRight size={16} />
              </div>
            </Link>
          ))}
        </div>
        {!claims.isLoading && !claims.data?.length && (
          <div className="empty-state compact">
            <h2>No claims yet.</h2>
            <p>
              When an animal damages your crop, select the visits above to prepare the evidence.
            </p>
          </div>
        )}
      </section>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Claim detail
function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={`claim-step ${done ? "done" : ""}`}>
      <span className="step-mark">{done ? <Check size={13} /> : n}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

export function ClaimDetail({ id }: { id: string }) {
  const { orgId, profile } = useWorkspace();
  const qc = useQueryClient();
  const claim = useClaim(id);
  const c = claim.data;
  const pack = useEvidencePack(c?.evidence_pack_id);
  const events = useEvents(orgId, { ids: c?.event_ids ?? [], includeRejected: true });
  const [draft, setDraft] = useState<string | null>(null);
  const [details, setDetails] = useState<{ crop: string; area: string; notes: string } | null>(
    null,
  );
  const [via, setVia] = useState<string>(FILED_VIA[0].value);
  const [ref, setRef] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  useEffect(() => {
    if (c) {
      setDraft((d) => (d === null ? (c.draft_text ?? "") : d));
      setDetails(
        (d) =>
          d ?? {
            crop: c.crop ?? "",
            area: c.affected_area_note ?? "",
            notes: c.farmer_notes ?? "",
          },
      );
    }
  }, [c]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["claim", id] });
    void qc.invalidateQueries({ queryKey: ["claims"] });
  };
  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => {
        toast.success(ok);
        refresh();
      })
      .catch((e: unknown) => toast.error(errorText(e)));

  const build = useMutation({
    mutationFn: () => post(`/v1/claims/${id}/evidence-pack`),
    onSuccess: () => {
      toast.success("Evidence pack signed and saved");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const generate = useMutation({
    mutationFn: () =>
      post<{ draft_text?: string; text?: string }>(`/v1/claims/${id}/draft`, {
        language: profile?.language ?? "en",
      }),
    onSuccess: async () => {
      const { data } = await supabase
        .from("claims")
        .select("draft_text")
        .eq("id", id)
        .maybeSingle();
      setDraft((data as { draft_text: string | null } | null)?.draft_text ?? "");
      toast.success("Claim text drafted — please read it before approving");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
  };
  const update = async (patch: Partial<ClaimRow>) => {
    const { error } = await supabase.from("claims").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  };
  const download = async () => {
    if (!c?.evidence_pack_id) return;
    try {
      const { url } = await api<{ url: string }>(`/v1/evidence/${c.evidence_pack_id}/download`);
      window.location.assign(url);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (claim.isLoading)
    return (
      <Workspace>
        <Loading />
      </Workspace>
    );
  if (!c)
    return (
      <Workspace>
        {claim.isError ? (
          <ErrorNote error={claim.error} />
        ) : (
          <div className="empty-state">
            <h2>Claim not found.</h2>
            <p>
              It may have been removed.{" "}
              <Link to="/claims" className="inline-link">
                Back to claims
              </Link>
            </p>
          </div>
        )}
      </Workspace>
    );

  const locked = !["draft", "evidence_ready"].includes(c.status);
  const textSaved = !!c.draft_text?.trim();
  const dirty = draft !== null && draft !== (c.draft_text ?? "");
  return (
    <Workspace>
      <Heading
        title={c.title}
        description={`${c.farms?.name ?? "Field"} · first visit ${fmtDateTime(c.incident_at)}`}
        action={<Deadline claim={c} />}
      />
      <div className="viewer-grid">
        <div>
          <ol className="claim-steps">
            <Step n={1} done={!!c.evidence_pack_id} title="Seal the evidence">
              <p>
                Keyframes, clips and detection details are hashed and signed so anyone can check
                they were not changed.
              </p>
              {pack.data && (
                <p className="mono-note">
                  Signed {relativeTime(pack.data.created_at)} · {pack.data.event_ids.length} visit
                  {pack.data.event_ids.length === 1 ? "" : "s"} · SHA-256{" "}
                  {pack.data.manifest_sha256.slice(0, 16)}…
                </p>
              )}
              <div className="flex gap-2 flex-wrap mt-3">
                {!locked && (
                  <Button
                    size="sm"
                    variant={c.evidence_pack_id ? "outline" : "default"}
                    disabled={build.isPending}
                    onClick={() => build.mutate()}
                  >
                    {build.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                    {c.evidence_pack_id ? "Rebuild pack" : "Build evidence pack"}
                  </Button>
                )}
                {c.evidence_pack_id && (
                  <Button size="sm" variant="outline" onClick={() => void download()}>
                    <Download />
                    Download .zip
                  </Button>
                )}
              </div>
            </Step>
            <Step n={2} done={textSaved} title="Write the loss intimation">
              <p>A short factual note for your insurer. Edit it freely: only you can approve it.</p>
              <textarea
                className="claim-text"
                value={draft ?? ""}
                onChange={(e) => setDraft(e.target.value)}
                disabled={locked}
                rows={9}
                maxLength={8000}
                placeholder="Describe what happened, when, which crop and roughly how much area was affected…"
                aria-label="Claim text"
              />
              {!locked && (
                <div className="flex gap-2 flex-wrap mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate()}
                  >
                    {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {textSaved ? "Redraft with assistant" : "Draft with assistant"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!dirty}
                    onClick={() =>
                      void run(
                        () =>
                          update({
                            draft_text: draft ?? "",
                            draft_language: profile?.language ?? "en",
                          }),
                        "Claim text saved",
                      )
                    }
                  >
                    Save text
                  </Button>
                </div>
              )}
            </Step>
            <Step n={3} done={!!c.approved_at} title="Approve">
              <p>
                Confirm that the evidence and text are accurate. Nothing is sent on your behalf.
              </p>
              {!locked && (
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={!c.evidence_pack_id || !textSaved || dirty}
                  onClick={() =>
                    void run(() => rpc("approve_claim", { p_claim: id }), "Claim approved")
                  }
                >
                  <ShieldCheck />I have checked this — approve
                </Button>
              )}
              {!locked && dirty && <p className="text-xs mt-2">Save your text changes first.</p>}
            </Step>
            <Step n={4} done={!!c.submitted_at} title="Report it to your insurer">
              <p>
                File through the Crop Insurance App, your bank or insurer office, or the PMFBY
                helpline, and attach the evidence pack.
              </p>
              {c.status === "approved" && (
                <div className="claim-submit">
                  <select
                    value={via}
                    onChange={(e) => setVia(e.target.value)}
                    aria-label="Where you filed"
                  >
                    {FILED_VIA.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    maxLength={120}
                    placeholder="Docket or reference number (optional)"
                    aria-label="Reference number"
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          rpc("mark_claim_submitted", {
                            p_claim: id,
                            p_via: via,
                            p_ref: ref || null,
                          }),
                        "Marked as filed",
                      )
                    }
                  >
                    <Send />
                    Mark as filed
                  </Button>
                </div>
              )}
              {c.submitted_at && (
                <p className="mono-note">
                  Filed {fmtDateTime(c.submitted_at)} via{" "}
                  {FILED_VIA.find((v) => v.value === c.submitted_via)?.label ?? c.submitted_via}
                  {c.submission_ref ? ` · ref ${c.submission_ref}` : ""}
                </p>
              )}
            </Step>
            <Step n={5} done={c.status === "paid" || c.status === "rejected"} title="Outcome">
              {c.status === "submitted" ? (
                <div className="claim-submit">
                  <input
                    value={outcomeNote}
                    onChange={(e) => setOutcomeNote(e.target.value)}
                    maxLength={500}
                    placeholder="Amount or note (optional)"
                    aria-label="Outcome note"
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          rpc("set_claim_outcome", {
                            p_claim: id,
                            p_outcome: "paid",
                            p_note: outcomeNote || null,
                          }),
                        "Marked as paid",
                      )
                    }
                  >
                    Paid
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        () =>
                          rpc("set_claim_outcome", {
                            p_claim: id,
                            p_outcome: "rejected",
                            p_note: outcomeNote || null,
                          }),
                        "Outcome saved",
                      )
                    }
                  >
                    Not accepted
                  </Button>
                </div>
              ) : (
                <p>
                  {c.status === "paid"
                    ? "Paid"
                    : c.status === "rejected"
                      ? "Not accepted"
                      : "Record what your insurer decides once filed."}
                  {c.outcome_note ? ` — ${c.outcome_note}` : ""}
                </p>
              )}
            </Step>
          </ol>
          <section className="mt-12">
            <div className="section-heading">
              <h2>Visits in this claim</h2>
              <span>{c.event_ids.length}</span>
            </div>
            {events.isLoading ? <Loading /> : <EventTable events={events.data ?? []} />}
          </section>
        </div>
        <aside className="viewer-sidebar">
          <section className="info-section">
            <h2>Loss details</h2>
            {details && (
              <form
                className="claim-details"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      update({
                        crop: details.crop || null,
                        affected_area_note: details.area || null,
                        farmer_notes: details.notes || null,
                      }),
                    "Details saved",
                  );
                }}
              >
                <label>
                  Crop
                  <input
                    value={details.crop}
                    disabled={locked}
                    maxLength={80}
                    onChange={(e) => setDetails({ ...details, crop: e.target.value })}
                  />
                </label>
                <label>
                  Area affected
                  <input
                    value={details.area}
                    disabled={locked}
                    maxLength={200}
                    placeholder="e.g. about 0.5 acre near the canal"
                    onChange={(e) => setDetails({ ...details, area: e.target.value })}
                  />
                </label>
                <label>
                  Your notes
                  <textarea
                    value={details.notes}
                    disabled={locked}
                    maxLength={4000}
                    rows={4}
                    onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                  />
                </label>
                {!locked && (
                  <Button type="submit" size="sm" variant="outline">
                    Save details
                  </Button>
                )}
              </form>
            )}
          </section>
          <section className="info-section">
            <h2>Good to know</h2>
            <ul>
              <li>PMFBY asks for localised losses to be reported within 72 hours.</li>
              <li>Wild-animal damage is covered only where your state has adopted the add-on.</li>
              <li>Keep photos of the damaged crop alongside this pack.</li>
            </ul>
            <p className="mt-3 text-xs">
              <Link
                to="/ask"
                search={{ q: "What do I need to claim for wild animal crop damage?" }}
                className="inline-link"
              >
                Ask about eligibility
              </Link>
              {" · "}
              <Link to="/api-docs" className="inline-link">
                Verify a pack
              </Link>
            </p>
          </section>
        </aside>
      </div>
    </Workspace>
  );
}

// ------------------------------------------------------------------ Review queue
export function Review() {
  const { orgId } = useWorkspace();
  const queue = useEvents(orgId, { needsReview: true, limit: 60 });
  const signed = useSignedUrls(
    "media",
    (queue.data ?? []).map((e) => e.keyframe_path),
  );
  const [open, setOpen] = useState<EventRow | null>(null);
  const items = (queue.data ?? []).filter((e) => e.review_status === "pending");
  return (
    <Workspace>
      <Heading
        title="A second pair of eyes."
        description="Detections the model was unsure about. Your answers correct the counts, alerts and claims."
      />
      {queue.isLoading && <Loading />}
      {queue.isError && <ErrorNote error={queue.error} retry={() => void queue.refetch()} />}
      {!queue.isLoading && !items.length && (
        <div className="empty-state">
          <ScanSearch className="mx-auto mb-4" />
          <h2>All caught up.</h2>
          <p>Uncertain detections appear here after each analysis.</p>
        </div>
      )}
      <div className="review-grid">
        {items.map((e) => (
          <article key={e.id} className="media-card review-card">
            <button
              type="button"
              className="card-image"
              onClick={() => setOpen(e)}
              aria-label={`Open ${e.final_common_name}`}
            >
              <img
                src={signed(e.keyframe_path) ?? speciesPhoto(e.final_species_key)}
                alt={`${e.final_common_name} keyframe`}
                loading="lazy"
              />
            </button>
            <div className="review-body">
              <h3>
                {e.final_common_name}?<small>{Math.round(e.species_conf * 100)}% sure</small>
              </h3>
              <p>
                {e.farms?.name ?? "Field"} · {fmtDateTime(e.started_at)}
              </p>
              <ReviewControls event={e} compact />
            </div>
          </article>
        ))}
      </div>
      {open && (
        <EventDrawer
          event={open}
          keyframe={signed(open.keyframe_path)}
          onClose={() => setOpen(null)}
        />
      )}
      <p className="mt-10 text-muted-foreground text-xs flex items-center gap-2">
        <FileText size={13} />
        Reviewed detections are kept as labelled examples to improve future models.
      </p>
    </Workspace>
  );
}
