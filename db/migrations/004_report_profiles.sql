CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_profile_versions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_library(id),
  assessment_version_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_versions(id),
  profile_version TEXT NOT NULL,
  scoring_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  status TEXT NOT NULL,
  clinical_approved BOOLEAN NOT NULL DEFAULT FALSE,
  source_profile JSONB NOT NULL,
  runtime_profile JSONB NOT NULL,
  validation JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, content_hash)
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.assessment_report_profiles (
  assessment_id TEXT PRIMARY KEY REFERENCES pod_assessment_prototype.assessment_library(id),
  active_profile_version_id TEXT NOT NULL
    REFERENCES pod_assessment_prototype.report_profile_versions(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_profile_imports (
  import_hash TEXT PRIMARY KEY,
  manifest JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS report_profile_versions_assessment
  ON pod_assessment_prototype.report_profile_versions (assessment_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS report_profile_versions_review_status
  ON pod_assessment_prototype.report_profile_versions (status, clinical_approved);
