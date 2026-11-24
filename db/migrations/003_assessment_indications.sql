CREATE TABLE IF NOT EXISTS pod_assessment_prototype.assessment_indications (
  assessment_id TEXT NOT NULL,
  indication_code TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  match_status TEXT NOT NULL DEFAULT 'current'
    CHECK (match_status IN ('current', 'monitoring')),
  rationale TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, indication_code, mapping_version)
);

CREATE INDEX IF NOT EXISTS assessment_indications_lookup
  ON pod_assessment_prototype.assessment_indications (indication_code, match_status, rank)
  WHERE active;

INSERT INTO pod_assessment_prototype.assessment_indications
  (assessment_id, indication_code, rank, match_status, rationale, mapping_version)
VALUES
  ('athens-insomnia-scale-ais--456d2e3fe9f5', 'sleep_disruption', 1, 'current',
   'The patient history documents persistent sleep fragmentation or delayed sleep onset. AIS is an adult self-report measure of insomnia severity.',
   'patient-history-v1'),
  ('regensburg-insomnia-scale-ris--3e3ecac36f30', 'sleep_disruption', 2, 'current',
   'The patient history documents persistent sleep disruption. RIS measures cognitive, behavioural and emotional aspects of insomnia in adults.',
   'patient-history-v1')
ON CONFLICT (assessment_id, indication_code, mapping_version) DO UPDATE SET
  rank = EXCLUDED.rank,
  match_status = EXCLUDED.match_status,
  rationale = EXCLUDED.rationale,
  active = TRUE;
