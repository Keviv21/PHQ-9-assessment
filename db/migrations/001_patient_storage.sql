CREATE TABLE IF NOT EXISTS pod_assessment_prototype.patient_profiles (
  id uuid PRIMARY KEY,
  source_system text NOT NULL,
  external_patient_id text NOT NULL,
  demographics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_profiles_source_identity_key UNIQUE (source_system, external_patient_id),
  CONSTRAINT patient_profiles_demographics_object CHECK (jsonb_typeof(demographics) = 'object')
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.patient_imports (
  id uuid PRIMARY KEY,
  patient_id uuid REFERENCES pod_assessment_prototype.patient_profiles(id) ON DELETE RESTRICT,
  source_system text NOT NULL,
  source_filename text NOT NULL,
  source_version text,
  source_patient_id text,
  payload_sha256 text NOT NULL UNIQUE,
  raw_payload jsonb NOT NULL,
  validation_status text NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_imports_hash_format CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT patient_imports_payload_object CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT patient_imports_errors_array CHECK (jsonb_typeof(validation_errors) = 'array'),
  CONSTRAINT patient_imports_status_check CHECK (validation_status IN ('validated', 'needs_review', 'rejected')),
  CONSTRAINT patient_imports_validated_patient_check CHECK (validation_status <> 'validated' OR patient_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS pod_assessment_prototype.patient_documents (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES pod_assessment_prototype.patient_profiles(id) ON DELETE RESTRICT,
  import_id uuid NOT NULL REFERENCES pod_assessment_prototype.patient_imports(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  source_section_key text NOT NULL,
  source_patient_id text,
  period_start date,
  period_end date,
  content_sha256 text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_documents_import_section_key UNIQUE (import_id, source_section_key),
  CONSTRAINT patient_documents_hash_format CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT patient_documents_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT patient_documents_period_check CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS patient_imports_patient_id_idx
  ON pod_assessment_prototype.patient_imports(patient_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS patient_imports_status_idx
  ON pod_assessment_prototype.patient_imports(validation_status, imported_at DESC);
CREATE INDEX IF NOT EXISTS patient_documents_patient_type_idx
  ON pod_assessment_prototype.patient_documents(patient_id, document_type, created_at DESC);
