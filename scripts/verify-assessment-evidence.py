"""Verify export fingerprints using the producer's canonical JSON representation."""
import hashlib
import json
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    bundle = json.load(handle)
for record in bundle['assessments']:
    content = {key: record[key] for key in (
        'assessment_id', 'definition_version', 'administration', 'questionnaire', 'scoring')}
    fingerprint = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':'),
                                            ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    evidence = record['verification']
    if evidence['scoring_content_sha256'] != fingerprint or evidence['definition_version'] != record['definition_version']:
        raise SystemExit('Stale scoring evidence: ' + record['assessment_id'])
print('Verified scoring-content fingerprints for ' + str(len(bundle['assessments'])) + ' assessments.')
