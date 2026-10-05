export type RiskBand = "Low" | "Moderate" | "High";
export type Language = "en" | "hi" | "gu";
export type VideoStatus = "uploaded" | "queued" | "processing" | "completed" | "failed";
export type ReviewStatus = "pending" | "confirmed" | "corrected" | "rejected";
export type ClaimStatus =
  "draft" | "evidence_ready" | "approved" | "submitted" | "paid" | "rejected";

export interface Profile {
  id: string;
  full_name: string | null;
  language: Language;
  default_org_id: string | null;
  onboarded: boolean;
  telegram_chat_id: number | null;
  whatsapp_phone: string | null;
  notify_high_risk: boolean;
  notify_analysis: boolean;
  notify_weekly: boolean;
  retention_days: number | null;
}

export interface Organization {
  id: string;
  name: string;
  kind: string;
}

export interface FarmSummary {
  id: string;
  name: string;
  crop: string;
  village: string | null;
  description: string | null;
  created_at: string;
  cameras: number;
  videos: number;
  events: number;
  events_7d: number;
  risk_score: number;
  risk_band: RiskBand;
  last_event_at: string | null;
}

export interface Camera {
  id: string;
  farm_id: string;
  name: string;
  kind: string;
}

export interface VideoRow {
  id: string;
  org_id: string;
  farm_id: string;
  camera_id: string | null;
  title: string;
  storage_path: string;
  original_filename: string | null;
  size_bytes: number | null;
  captured_at: string;
  capture_time_mismatch: boolean;
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  status: VideoStatus;
  progress: number;
  stage: string | null;
  error: string | null;
  thumbnail_path: string | null;
  playback_path: string | null;
  model_versions: Record<string, string | null>;
  frames_sampled: number | null;
  frames_analyzed: number | null;
  processed_at: string | null;
  created_at: string;
  farms?: { name: string; crop: string } | null;
  cameras?: { name: string } | null;
  events?: { count: number }[];
}

export interface RiskFactor {
  key: string;
  label: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface EventRow {
  id: string;
  video_id: string;
  farm_id: string;
  camera_id: string | null;
  species_key: string;
  common_name: string;
  scientific_name: string | null;
  final_species_key: string;
  final_common_name: string;
  species_conf: number;
  started_at: string;
  start_offset_s: number;
  end_offset_s: number;
  duration_s: number;
  max_individuals: number;
  contains_people: boolean;
  risk_score: number;
  risk_band: RiskBand;
  risk_factors: RiskFactor[];
  needs_review: boolean;
  review_status: ReviewStatus;
  clip_path: string | null;
  keyframe_path: string | null;
  best_bbox: number[] | null;
  description: string | null;
  vlm_caption: string | null;
  farms?: { name: string; crop: string } | null;
  cameras?: { name: string } | null;
}

export interface AlertRow {
  id: string;
  farm_id: string | null;
  event_id: string | null;
  video_id: string | null;
  species_key: string | null;
  title: string;
  body: string;
  severity: RiskBand;
  occurrences: number;
  status: "open" | "resolved";
  channels: Record<string, string[]>;
  created_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  farms?: { name: string } | null;
  events?: {
    keyframe_path: string | null;
    start_offset_s: number;
    contains_people: boolean;
  } | null;
}

export interface ReportStats {
  period: { start: string; end: string };
  totals: {
    events: number;
    high_risk: number;
    moderate_risk: number;
    species: number;
    videos: number;
    pending_review: number;
    night_events: number;
  };
  previous_period_events: number;
  species: {
    species: string;
    events: number;
    high_risk: number;
    max_risk: number;
    peak_hour: number | null;
  }[];
  farms: { farm: string; crop: string; events: number; max_risk: number; risk_band: RiskBand }[];
  daily: { day: string; events: number; high_risk: number }[];
  top_events: {
    id: string;
    video_id: string;
    species: string;
    farm: string;
    started_at: string;
    start_offset_s: number;
    risk_score: number;
    risk_band: RiskBand;
  }[];
}

export interface ReportRow {
  id: string;
  kind: string;
  title: string;
  farm_id: string | null;
  video_id: string | null;
  period_start: string;
  period_end: string;
  stats: ReportStats;
  narrative: string | null;
  language: Language;
  status: string;
  created_at: string;
}

export interface ClaimRow {
  id: string;
  farm_id: string;
  title: string;
  status: ClaimStatus;
  incident_at: string;
  deadline_at: string;
  event_ids: string[];
  evidence_pack_id: string | null;
  crop: string | null;
  affected_area_note: string | null;
  farmer_notes: string | null;
  draft_text: string | null;
  draft_language: Language | null;
  draft_generated_at: string | null;
  approved_at: string | null;
  submitted_at: string | null;
  submission_ref: string | null;
  submitted_via: string | null;
  outcome_note: string | null;
  created_at: string;
  farms?: { name: string } | null;
}

export interface EvidencePackRow {
  id: string;
  manifest_sha256: string;
  signing_key_id: string;
  size_bytes: number | null;
  created_at: string;
  event_ids: string[];
}

export interface Dashboard {
  active_risks: number;
  open_alerts: number;
  events_7d: number;
  events_prev_7d: number;
  events_total: number;
  videos_7d: number;
  videos_processing: number;
  videos_total: number;
  farms: number;
  cameras: number;
  pending_review: number;
  claims_open: number;
}

export interface SeriesPoint {
  bucket_start: string;
  label: string;
  events: number;
  high_risk: number;
}

export interface SpeciesSummary {
  species_key: string;
  common_name: string;
  scientific_name: string | null;
  events: number;
  high_risk: number;
  farms: number;
  peak_hour: number | null;
  last_seen: string | null;
  max_risk: number;
  best_event_id: string | null;
}

export interface Citation {
  n: number;
  title: string;
  publisher: string | null;
  source_url: string | null;
  snippet?: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
