CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_visual_spec_versions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_library(id),
  assessment_version_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_versions(id),
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  clinical_approved BOOLEAN NOT NULL DEFAULT FALSE,
  source_spec JSONB NOT NULL,
  runtime_spec JSONB NOT NULL,
  validation JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, content_hash)
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.assessment_report_visual_specs (
  assessment_id TEXT PRIMARY KEY REFERENCES pod_assessment_prototype.assessment_library(id),
  active_visual_spec_version_id TEXT NOT NULL
    REFERENCES pod_assessment_prototype.report_visual_spec_versions(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_visual_spec_imports (
  import_hash TEXT PRIMARY KEY,
  manifest JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS report_visual_spec_versions_assessment
  ON pod_assessment_prototype.report_visual_spec_versions (assessment_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS report_visual_spec_versions_review_status
  ON pod_assessment_prototype.report_visual_spec_versions (status, clinical_approved);
