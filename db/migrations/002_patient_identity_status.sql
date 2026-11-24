ALTER TABLE pod_assessment_prototype.patient_imports
  DROP CONSTRAINT IF EXISTS patient_imports_status_check;

ALTER TABLE pod_assessment_prototype.patient_imports
  ADD CONSTRAINT patient_imports_status_check
  CHECK (validation_status IN ('validated', 'validated_with_warnings', 'needs_review', 'rejected'));

ALTER TABLE pod_assessment_prototype.patient_imports
  DROP CONSTRAINT IF EXISTS patient_imports_validated_patient_check;

ALTER TABLE pod_assessment_prototype.patient_imports
  ADD CONSTRAINT patient_imports_validated_patient_check
  CHECK (validation_status NOT IN ('validated', 'validated_with_warnings') OR patient_id IS NOT NULL);

ALTER TABLE pod_assessment_prototype.patient_documents
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'matched',
  ADD COLUMN IF NOT EXISTS included_in_patient_record boolean NOT NULL DEFAULT true;

ALTER TABLE pod_assessment_prototype.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_identity_status_check;

ALTER TABLE pod_assessment_prototype.patient_documents
  ADD CONSTRAINT patient_documents_identity_status_check
  CHECK (identity_status IN ('matched', 'inherited', 'mismatch'));

ALTER TABLE pod_assessment_prototype.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_identity_inclusion_check;

ALTER TABLE pod_assessment_prototype.patient_documents
  ADD CONSTRAINT patient_documents_identity_inclusion_check
  CHECK (identity_status <> 'mismatch' OR included_in_patient_record = false);

CREATE INDEX IF NOT EXISTS patient_documents_patient_included_idx
  ON pod_assessment_prototype.patient_documents(patient_id, document_type, created_at DESC)
  WHERE included_in_patient_record;
