# NovoPsych assessment JSON: gap audit

**Source:** all-assessments-cleaned-20261116.json (supplied 16 November 2026; 186 records; schema 2.3.0-clean-export.1).
**SHA-256:** 929041a311bd38be19fba7a81e5665dc31ac136bd45f3fb4b3d776023e8a9a28.
**Scope:** Static inspection of the supplied JSON and its own provenance, review flags, and import contract. This is not an independent, item-by-item comparison with the current NovoPsych website or a clinical validation of any instrument.

## Executive summary

| Area | Finding | Implication |
| --- | ---: | --- |
| Questionnaire content | 185 of 186 records have items; SDQ has none | SDQ cannot be administered from this bundle. |
| Structured scoring | 183 have draft rules; 3 have none | Draft calculations are possible for many records, but LEC-5 and asQ need their own non-total protocols; SDQ needs a form. |
| Clinical scoring switch | 186 disabled | The bundle itself authorizes no clinical scoring. |
| Clinical approval | 0 ready | No result from this bundle is marked ready for patient-care decisions. |
| Selection and branching | 177 flagged | Choice cardinality, skip logic, and section stems require source review. |
| Source counts | 14 flagged | Stated item counts and extracted response fields need reconciliation. |
| Extracted expressions | 120 records retain unparsed PDF expressions | Check each expression against executable rules; some already have manual equivalents. |
| Percentile lookup | 184 not implemented; 2 marked not applicable | Provider-equivalent normative reporting is not established. |
| Source PDF retrieval | 5 failed record references, representing 4 distinct resources | Verify the affected source documents manually. |
| Languages | 186 English definitions; 0 other languages | Approved translations are absent from this bundle. |

### How to read these findings

A **review flag** is an unresolved verification task recorded in the JSON; it does not prove the assessment is wrong. A **draft rule** is a machine-readable calculation, not a validated interpretation. The local application has separate implementations for PHQ-9, GAD-7, and PCL-5; those do not change the supplied bundle's `scoring.enabled: false` values. The bundle's `import_contract.scoring_is_enabled` is also `false`.

## Specific gaps and required source decisions

### 1. Missing questionnaire and non-total instruments

- **Strengths and Difficulties Questionnaire (SDQ):** 0 extracted items and 0 structured rules. The source description mentions 25 items. Its review flags say a specific questionnaire variant, instructions, and an authorized digital form are still required.
- **Life Events Checklist for DSM-5 (LEC-5):** 17 items but no executable scoring rules. The record calls it a descriptive exposure inventory. Preserve recorded responses; do not manufacture a numeric total.
- **Ask Suicide-Screening Questionnaire (asQ):** 8 extracted fields and source protocol guidance, but no executable rules or approved response-handling workflow in this bundle. Treat this as a screening protocol, not a routine numerical score.

### 2. Draft scoring is not verified scoring

- 183 records have structured rules and 729 total draft rules. All 186 have scoring.enabled: false and review.ready_for_clinical_use: false.

| JSON scoring status | Records |
| --- | ---: |
| source_arithmetic_draft | 175 |
| source_checked_draft | 8 |
| requires_rule_review | 1 |
| source_protocol_draft | 1 |
| descriptive_exposure_inventory | 1 |

- 120 records include scoring.unparsed_pdf_expressions. The import contract says some expressions have manually implemented equivalents; therefore this count is a **review queue**, not a count of wholly unscorable forms.
- 184 records report not_implemented_no_unverified_lookup for percentiles. The other 2 say source percentiles are not applicable. No record supplies an enabled, verified percentile calculation.
- The JSON does not contain an executable, validated equivalent of each NovoPsych sample report. Its draft rules and retained source tables do not establish verified norms, cutoffs, reliable change, interpretation wording, or visual report parity.

### 3. Questionnaire structure and source capture need checking

- 177 records flag selection mode, conditional display, skip handling, or section-specific stems for review. The structure is marked complete for 185, which is a parsing result rather than clinical verification.
- 14 records flag a difference between the page description and extracted response fields. For **Brief Addiction Monitor - Continuous (BAM)**, the page says 17 numbered items while the selected form contains 23 response fields. The [VA scoring instructions](https://www.mentalhealth.va.gov/healthcare-providers/docs/VA_OMH_The_Brief_Addiction-Monitor_Instuctions_508.pdf) identify item 7 as seven subitems (7a-g), which explains the extra six fields. The source JSON still carries the count flag; confirm its item-to-field mapping before removing that flag.

| Assessment | Count discrepancy recorded in JSON |
| --- | --- |
| Multilevel Assessment of Psychopathology (MAPsy) | Page description mentions [154] items; selected PDF has 155 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Brief Addiction Monitor – Continuous (BAM) | The file flags 17 numbered items versus 23 response fields. VA instructions identify seven subitems within item 7, explaining the extra six fields; confirm the imported mapping. |
| MASCC Unmet Needs Assessment for Cancer-Related Cognitive Impairment Impact (MASCC COG-IMPACT) | Page description mentions [55] items; selected PDF has 110 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Gender Preoccupation and Stability Questionnaire 2 (GPSQ-2) | Page description mentions [14] items; selected PDF has 17 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Composite Caregiving Questionnaire (CCQ) | Page description mentions [42] items; selected PDF has 45 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Borderline Symptom List (BSL-23) | Page description mentions [23] items; selected PDF has 24 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Depression Anxiety Stress Scale (DASS-10) | Page description mentions [10] items; selected PDF has 12 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Strengths and Difficulties Questionnaire (SDQ) | Page description mentions [25] items; selected PDF has 0 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Strengths and Stressors (SAS) | Page description mentions [56] items; selected PDF has 35 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Vanderbilt ADHD Diagnostic Teacher Rating Scale (VADTRS) | Page description mentions [43] items; selected PDF has 44 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Preschool Anxiety Scale (PAS) | Page description mentions [28] items; selected PDF has 35 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Agnew Relationship Measure – 5 (ARM-5) | Page description mentions [28] items; selected PDF has 5 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Spence Children’s Anxiety Scale – Child (SCAS-Child) | Page description mentions [44] items; selected PDF has 46 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |
| Spence Children’s Anxiety Scale – Parent (SCAS-Parent) | Page description mentions [38] items; selected PDF has 39 extracted response fields. Follow-up fields, subquestions or different editions may explain this; review the form scope. |

- 47 records retain an original_capture_gaps flag. Later repairs recovered content, so this is a provenance and source-check flag, not proof those current questions are empty.
- All 186 records have questionnaire_completeness_verified: false and complete_capture_verified: false.

### 4. Source documents that did not refresh

The source summary reports four unique PDF retrieval failures; the per-record refresh data contains five failed references because the same ASRS PDF is referenced by two assessments:

| Affected record | Retrieval error |
| --- | --- |
| Adult ADHD Self-Report Scale (ASRS) | The read operation timed out |
| Adult ADHD Observer-Report Scale (ASRS-O) | The read operation timed out |
| Brief Addiction Monitor – Continuous (BAM) | Not a PDF response |
| Maladaptive Schema Scale (MSS) | Source returned HTTP 404; no access restriction was bypassed. |
| Center for Epidemiological Studies Depression Scale for Children (CES-DC) | Source returned HTTP 404; no access restriction was bypassed. |

### 5. Assignment metadata, language, rights, and report scope

- target_population is absent for 185 records; the sole populated entry, **GAD-7**, contains conflicting minimum-age claims (12 versus 14). respondent_type, intended_uses, and estimated administration time are each absent for 185, 185, and 185 records respectively. The narrative description may still contain some of this information, but it is not structured for reliable automatic matching.
- The structured reference period is absent for 185 records, even where narrative time-window claims are retained.
- All 186 assessment definitions have assessment.language: en. The file supplies no fixed Hindi or Marathi versions for these imported forms.
- All 186 records have rights.reproduction_permission: not_verified in the file. This describes missing evidence in the dataset; it does not override any separate approval the client has granted. Attach the approved scope to the source record before product use.
- The export omits provider website URLs and does not embed external asset bytes. Archive paths and hashes are evidence references, not a self-contained, ready-to-render copy of source PDFs, images, or sample reports.

## Review issue code counts

| JSON review issue code | Records | Meaning in this audit |
| --- | ---: | --- |
| independent_review_pending | 186 | Independent content and scoring review has not been completed. |
| selection_and_branching_need_review | 177 | Selection cardinality, conditional items, skips, or section stems require review. |
| draft_scoring_review_pending | 175 | Structured calculations are still draft and disabled for clinical use. |
| original_capture_gaps | 47 | Earlier extraction gaps remain in provenance after later recovery. |
| source_item_count_differs | 14 | Stated count and extracted response-field count differ. |
| scoring_not_structured | 3 | No verified executable rule set is available. |
| sdq_authorized_digital_form_required | 1 | SDQ digital questionnaire authorization and form are missing. |
| form_scope | 1 | The selected source form/edition needs confirmation. |
| instructions_missing | 1 | Administration instructions are missing. |
| questionnaire_missing | 1 | Questionnaire items are missing. |
| variant_selection_required | 1 | An assessment variant must be selected. |

## Per-assessment gap matrix

Common to **every** row: draft source status; clinical scoring disabled; complete capture and independent clinical review unverified; English only; reproduction permission marked unverified. The markers below show additional, record-specific work. `U` denotes retained unparsed expressions, including some with manually implemented equivalents.

| Marker | Meaning |
| --- | --- |
| `B` | Selection/branching review flag |
| `S` | Draft scoring review flag |
| `C` | Original capture gap in provenance |
| `I` | Page item count differs from extracted response fields |
| `U` | Unparsed PDF expression retained |
| `N` | No executable scoring rules |
| `Q` | Questionnaire items missing |
| `F` | Source PDF refresh failed |
| `X` | Other review issue; full code shown in row |

| # | Assessment | Items | Rules | Gap markers / other issue codes |
| ---: | --- | ---: | ---: | --- |
| 1 | Adult ADHD Self-Report Scale (ASRS) | 18 | 3 | B, S, C, U, F |
| 2 | Adult ADHD Observer-Report Scale (ASRS-O) | 18 | 5 | B, S, C, U, F |
| 3 | Depression Anxiety Stress Scales – Short Form (DASS-21) | 21 | 7 | U |
| 4 | Multilevel Assessment of Psychopathology (MAPsy) | 155 | 1 | B, S, I |
| 5 | PTSD Checklist for DSM-5 (PCL-5) | 20 | 1 | - |
| 6 | Generalised Anxiety Disorder Assessment (GAD-7) | 7 | 1 | - |
| 7 | Patient Health Questionnaire – Depression (PHQ-9) | 9 | 1 | - |
| 8 | Autism Spectrum Quotient (AQ) | 50 | 1 | B, S, C, U |
| 9 | Executive Skills Questionnaire – Revised (ESQ-R) | 25 | 1 | B, S, U |
| 10 | Athens Insomnia Scale (AIS) | 8 | 3 | B, S |
| 11 | CRAFFT Substance Use Assessment (CRAFFT 2.1+N) | 20 | 2 | B, S |
| 12 | Alexian Brothers Urge to Self-Injure Scale (ABUSI) | 5 | 1 | B, S |
| 13 | Why Have Sex? Questionnaire Short Form (YSEX-SF) | 28 | 14 | B, S, U |
| 14 | Brief Addiction Monitor – Continuous (BAM) | 23 | 3 | B, S, C, I, U, F |
| 15 | MASCC Unmet Needs Assessment for Cancer-Related Cognitive Impairment Impact (MASCC COG-IMPACT) | 110 | 16 | B, S, I, U |
| 16 | Manic and Depression Symptoms Paired Screening (PMQ-9 and PHQ-9) | 18 | 2 | B, S, C |
| 17 | Fatigue Assessment Scale (FAS) | 10 | 1 | B, S, U |
| 18 | Comprehensive Autistic Trait Inventory (CATI) | 42 | 1 | B, S, U |
| 19 | Mood Disorder Questionnaire (MDQ) | 15 | 1 | B, S, U |
| 20 | Extreme Demand Avoidance Questionnaire – Adult (EDA-QA) | 26 | 1 | B, S, C |
| 21 | Extreme Demand Avoidance – 8 (EDA-8) | 8 | 1 | B, S |
| 22 | Dimensions of Anger Reactions (DAR-5) | 5 | 1 | - |
| 23 | Menopause Depression Rating Scale (MENO-D) | 12 | 1 | B, S, U |
| 24 | Death Anxiety Beliefs and Behaviours Scale (DABBS) | 18 | 1 | B, S, U |
| 25 | Couples Satisfaction Index (CSI-16) | 16 | 1 | B, S, U |
| 26 | Herth Hope Index (HHI) | 12 | 1 | B, S, U |
| 27 | Drug Use Disorders Identification Test (DUDIT) | 11 | 1 | B, S |
| 28 | Brief Resilience Scale (BRS) | 6 | 1 | B, S |
| 29 | Life Orientation Test Revised (LOT-R) | 10 | 1 | B, S, U |
| 30 | Brief Hierarchical Taxonomy of Psychopathology (B-HiTOP) | 45 | 8 | B, S, C, U |
| 31 | Brief 2-Way Social Support Scale (Brief 2-Way SSS) | 12 | 1 | B, S, U |
| 32 | Leadership Scale for Sports (LSS-15) | 15 | 6 | B, S, U |
| 33 | Child Dissociative Checklist (CDC) | 20 | 1 | B, S |
| 34 | Digital Stress Scale (DSS) | 24 | 6 | B, S, C |
| 35 | International Trauma Questionnaire – Child and Adolescent Version (ITQ-CA) | 22 | 10 | B, S, C |
| 36 | International Trauma Questionnaire (ITQ) | 18 | 10 | B, S, C |
| 37 | Gender Preoccupation and Stability Questionnaire 2 (GPSQ-2) | 17 | 1 | B, S, I, U |
| 38 | Brief Emotional Intelligence Scale (BEIS-10) | 10 | 1 | B, S, U |
| 39 | General Behaviour Inventory (GBI) | 73 | 4 | B, S, U |
| 40 | Flourishing Scale (FS) | 8 | 1 | B, S |
| 41 | Clinical Outcomes in Routine Evaluation (CORE-OM) | 34 | 5 | B, S |
| 42 | Clinical Outcomes in Routine Evaluation 10 (CORE-10) | 10 | 1 | - |
| 43 | Camouflaging Autistic Traits Questionnaire (CAT-Q) | 25 | 1 | B, S, C, U |
| 44 | Maladaptive Schema Scale (MSS) | 108 | 27 | B, S, C, U, F |
| 45 | Maladaptive Schema Scale – Young Schema Aligned (MSS-YSQ) | 76 | 19 | B, S, C, U |
| 46 | Brief Experiential Avoidance Questionnaire (BEAQ) | 15 | 1 | B, S |
| 47 | Brief Early Schema Questionnaire (BESQ) | 24 | 5 | B, S, U |
| 48 | Childhood Autism Spectrum Test (CAST) | 44 | 1 | B, S |
| 49 | Mental Health Literacy Scale (MHLS) | 35 | 1 | B, S |
| 50 | Buss and Perry Aggression Questionnaire (BPAQ) | 29 | 1 | B, S, U |
| 51 | Brief Emotional Distress Scale for Youth (BEDSY) | 8 | 1 | B, S, U |
| 52 | Geriatric Depression Scale (GDS-15) | 15 | 1 | B, S, U |
| 53 | Indigenous Risk Impact Screen (IRIS) | 13 | 2 | B, S, U |
| 54 | Children’s Eating Attitudes Test (ChEAT) | 26 | 5 | B, S, U |
| 55 | Eating Disorder-15 (ED-15) | 15 | 1 | B, S, U |
| 56 | Institute for Basic Research – Modified Overt Aggression Scale (IBR-MOAS) | 20 | 2 | B, S, U |
| 57 | Kessler Psychological Distress Scale-5 (K5) | 5 | 1 | B, S |
| 58 | Male Depression Risk Scale (MDRS-22) | 22 | 1 | B, S, U |
| 59 | Empathy Quotient (EQ-40) | 40 | 1 | B, S, U |
| 60 | Life Events Checklist for DSM-5 (LEC-5) | 17 | 0 | B, N, X:scoring_not_structured |
| 61 | Montgomery-Asberg Rating Scale (MADRS) | 10 | 1 | - |
| 62 | Kessler Psychological Distress Scale PLUS (K10+) | 14 | 1 | B, S, U |
| 63 | Life Skills Profile (LSP-16) | 16 | 1 | B, S, U |
| 64 | NovoPsych Five Factor Personality Scale – 30 item version (NFFPS-30) | 30 | 35 | B, S, U |
| 65 | International Personality Item Pool – NEO – 120 item version (IPIP-NEO-120) | 120 | 35 | B, S, C, U |
| 66 | Multidimensional Inventory of Dissociation – 60-item Adolescent version (MID-60-A) | 60 | 11 | B, S, U |
| 67 | Difficulties in Emotion Regulation Scale – 16 item version (DERS-16) | 16 | 1 | B, S, U |
| 68 | Clinical Impairment Assessment Questionnaire (CIA) | 16 | 1 | B, S |
| 69 | Depression Anxiety Stress Scales – Youth Version (DASS-Y) | 21 | 4 | B, S, U |
| 70 | Composite Caregiving Questionnaire (CCQ) | 45 | 5 | B, S, I, U |
| 71 | Obsessive Compulsive Inventory – Revised (OCI-R) | 18 | 1 | B, S, C, U |
| 72 | Multidimensional Inventory of Dissociation – 60-item version (MID-60) | 60 | 11 | B, S, C, U |
| 73 | McLean Screening Instrument for BPD (MSI-BPD) | 10 | 1 | B, S |
| 74 | Mindfulness-Based Self Efficacy Scale – Revised (MSES-R) | 22 | 6 | B, S, U |
| 75 | Equanimity Scale – 16 (ES-16) | 16 | 3 | B, S, U |
| 76 | Multidimensional Assessment of Interoceptive Awareness – Youth Version (MAIA-Y) | 32 | 8 | B, S |
| 77 | Multidimensional Assessment of Interoceptive Awareness – Version 2 (MAIA-2) | 37 | 8 | B, S |
| 78 | Borderline Symptom List (BSL-23) | 24 | 1 | B, S, I, U |
| 79 | Compassion Motivation and Action Scale – Self-Compassion (CMAS-Self) | 18 | 1 | B, S, U |
| 80 | Compassion Motivation and Action Scales – Compassion (CMAS-other) | 12 | 1 | B, S, U |
| 81 | Cognitive Flexibility Inventory (CFI) | 20 | 3 | B, S, U |
| 82 | Depression Anxiety Stress Scale (DASS-10) | 12 | 6 | B, S, I, U |
| 83 | Coping Orientation to Problems Experienced Inventory (Brief-COPE) | 28 | 3 | B, S, U |
| 84 | Center for Epidemiological Studies Depression Scale for Children (CES-DC) | 20 | 1 | B, S, C, F |
| 85 | Center for Epidemiologic Studies Depression Scale – Revised (CESD-R) | 20 | 1 | B, S, C |
| 86 | Client Satisfaction Survey (CSS) | 10 | 1 | B, S |
| 87 | Counselling Self Estimate Inventory (COSE) | 37 | 6 | B, S |
| 88 | Depression Anxiety Stress Scales – Long Form (DASS-42) | 42 | 4 | B, S, U |
| 89 | Difficulties in Emotion Regulation Scale (DERS) | 36 | 1 | B, S, U |
| 90 | Dissociative Experiences Scale – II (DES-II) | 28 | 3 | B, S, C, U |
| 91 | Eating Attitudes Test-26 (EAT-26) | 31 | 1 | B, S, U |
| 92 | Edinburgh Postnatal Depression Scale (EPDS) | 10 | 1 | B, S |
| 93 | Experience in Close Relationship Scale – Short Form (ECR-S) | 12 | 2 | B, S, U |
| 94 | Five Facet Mindfulness Questionnaire (FFMQ-15) | 15 | 6 | B, S, U |
| 95 | Frost Multidimensional Perfectionism Scale (FMPS) | 35 | 5 | B, S, U |
| 96 | Mood and Feelings Questionnaire: Parent Report (MFQ-Parent) | 13 | 1 | B, S |
| 97 | Mood and Feelings Questionnaire-Self Report (MFQ-Self) | 13 | 1 | B, S |
| 98 | Obsessional Compulsive Inventory – Child Self Report (ChOCI-R-S) | 38 | 6 | B, S, U |
| 99 | Obsessional Compulsive Inventory- Revised-Parent (ChOCI-R-P) | 38 | 6 | B, S, C, U |
| 100 | Obsessional Compulsive Inventory- Revised-Parent (ChOCI-R-P) | 38 | 6 | B, S, C, U |
| 101 | Ask Suicide-Screening Questionnaire (asQ) | 8 | 0 | B, N, X:scoring_not_structured |
| 102 | Strengths and Difficulties Questionnaire (SDQ) | 0 | 0 | C, I, N, Q, X:questionnaire_missing, X:variant_selection_required, X:instructions_missing, X:scoring_not_structured, X:sdq_authorized_digital_form_required |
| 103 | Ruminative Responses Scale (RRS) | 22 | 1 | B, S, U |
| 104 | Work and Social Adjustment Scale (WSAS) | 5 | 1 | B, S, U |
| 105 | Reflective Practice Questionnaire – Extended (RPQ-E) | 30 | 4 | B, S |
| 106 | Penn Alcohol Craving Scale (PACS) | 5 | 1 | B, S, U |
| 107 | Pica, ARFID, and Rumination Disorder Interview – ARFID Questionnaire: Informant-report (PARDI-AR-Q-Informant) | 33 | 4 | B, S |
| 108 | Pica, ARFID, and Rumination Disorder Interview – ARFID Questionnaire (PARDI-AR-Q) | 33 | 4 | B, S, C |
| 109 | Attachment Style Questionnaire – Short Form (ASQ-SF) | 29 | 7 | B, S, U |
| 110 | Pain Self-Efficacy Questionnaire (PSEQ) | 10 | 1 | B, S, U |
| 111 | Autism Treatment Evaluation Checklist (ATEC) | 77 | 5 | B, S, U |
| 112 | State Difficulties in Emotion Regulation Scale (S-DERS) | 21 | 5 | B, S |
| 113 | Perfectionistic Cognitions Inventory (PCI) | 25 | 1 | B, S |
| 114 | Phobic Stimuli Response Scale (PSRS) | 46 | 1 | B, S, U |
| 115 | Athlete Psychological Strain Questionnaire (APSQ) | 10 | 1 | B, S, U |
| 116 | Strengths and Stressors (SAS) | 35 | 6 | B, S, C, I |
| 117 | Protective Factors of Resilience Scale (PFRS) | 15 | 4 | B, S, U |
| 118 | Team Psychological Safety (TPS-7) | 7 | 1 | B, S, U |
| 119 | Screen for Child Anxiety Related Emotional Disorders Parent Version (SCARED Parent) | 41 | 1 | B, S |
| 120 | Screen for Child Anxiety Related Emotional Disorders Child Version (SCARED Child) | 41 | 1 | B, S |
| 121 | WHO – Quality of Life – Brief (WHOQOL-BREF) | 26 | 5 | B, S, U |
| 122 | Young Person’s CORE (YP-CORE) | 10 | 1 | B, S |
| 123 | Thought Action Fusion Scale – Revised (TAFS-R) | 19 | 1 | B, S, U |
| 124 | Athletic Coping Skills Inventory (ACSI-28) | 28 | 8 | B, S, C, U |
| 125 | Wender Utah Rating Scale – 25 item version (WURS-25) | 25 | 4 | B, S, C, U |
| 126 | Personality Inventory for DSM-5 – Short Form (PID-5-SF) | 100 | 5 | B, S, C |
| 127 | Trauma Recovery Measure (TRM) | 15 | 1 | B, S, C |
| 128 | Zung Self-Rating Depression Scale | 20 | 4 | B, S, C, U |
| 129 | Adolescent Dissociative Experiences Scale (A-DES) | 30 | 5 | B, S, U |
| 130 | Positive Childhood Experiences (PCEs) scale | 7 | 1 | B, S |
| 131 | Benevolent Childhood Experiences (BCEs) scale | 20 | 3 | B, S, U |
| 132 | Repetitive Behaviours Questionnaire–3 (RBQ-3) | 20 | 6 | B, S, C, X:form_scope |
| 133 | Autism Spectrum Quotient Adolescent Version (AQ-Adolescent) | 50 | 1 | B, S, C, U |
| 134 | Autism Spectrum Quotient Children’s Version (AQ-Child) | 50 | 1 | B, S, C, U |
| 135 | Adult Separation Anxiety Questionnaire (ASA-27) | 27 | 1 | B, S, C, U |
| 136 | ADHD Clinical Outcome Scale (ACOS-Self) – Self-Report Version | 15 | 1 | B, S, C |
| 137 | ADHD Clinical Outcome Scale (ACOS-Clinician) – Clinician Version | 15 | 1 | B, S, C, U |
| 138 | Binge-Eating Scale (BES) | 16 | 1 | B, S, U |
| 139 | Anxiety, Depression, and Mood Scale (ADAMS) | 28 | 5 | B, S, U |
| 140 | Weiss Symptom Record II (WSR-II) | 123 | 57 | B, S, U |
| 141 | Oldenburg Burnout Inventory (OLBI) | 16 | 3 | B, S, U |
| 142 | Leeds Dependence Questionnaire (LDQ) | 10 | 1 | B, S, C |
| 143 | Toronto Alexithymia Scale (TAS) | 20 | 1 | B, S, U |
| 144 | World Health Organisation Disability Assessment Schedule – Children and Youth version (WHODAS-Child) | 40 | 13 | B, S, C, U |
| 145 | Problem Gambling Severity Index (PGSI) | 9 | 1 | B, S, U |
| 146 | Session Reactions Scale – 3 – Brief (SRS-3-B) | 15 | 4 | B, S, U |
| 147 | Your Experience of Service (YES) | 28 | 8 | B, S, C |
| 148 | Acceptance and Action Questionnaire – version 2 (AAQ-2) | 7 | 1 | B, S |
| 149 | Short Health Anxiety Inventory (SHAI) | 18 | 1 | B, S, U |
| 150 | Regensburg Insomnia Scale (RIS) | 10 | 4 | B, S |
| 151 | Personal Wellbeing Index – Adult (PWI-A) | 9 | 1 | B, S, U |
| 152 | Pediatric Symptom Checklist-17 (PSC-17) | 17 | 1 | B, S, U |
| 153 | Vanderbilt ADHD Diagnostic Teacher Rating Scale (VADTRS) | 44 | 11 | B, S, I, U |
| 154 | Positive and Negative Affect Schedule (PANAS) | 20 | 2 | B, S |
| 155 | Tinnitus Handicap Inventory (THI) | 25 | 1 | B, S, U |
| 156 | Ritvo Autism Asperger Diagnostic Scale – Revised (RAADS-R) | 80 | 9 | B, S, C, U |
| 157 | Vanderbilt ADHD Diagnostic Parent Rating Scale (VADPRS) | 55 | 13 | B, S, C, U |
| 158 | Adverse Childhood Experiences Questionnaire (ACE-Q) | 10 | 1 | B, S, U |
| 159 | Automatic Thoughts Questionnaire – Believability (ATQ-B) | 15 | 1 | B, S |
| 160 | World Health Organisation Disability Assessment Schedule 2.0 – Interview (WHODAS-interview) | 43 | 8 | B, S, C, U |
| 161 | World Health Organisation Disability Assessment Schedule 2.0 – Proxy (WHODAS-proxy) | 39 | 7 | B, S, C, U |
| 162 | The World Health Organisation Disability Assessment Schedule (WHODAS 2.0) – Self-Report Version | 39 | 7 | B, S, C, U |
| 163 | Self-Compassion Scale – Short Form (SCS-SF) | 12 | 3 | B, S, U |
| 164 | Preschool Anxiety Scale (PAS) | 35 | 1 | B, S, I, U |
| 165 | Agnew Relationship Measure – 5 (ARM-5) | 5 | 1 | B, S, I, U |
| 166 | Alcohol Use Disorders Identification Test (AUDIT) | 12 | 1 | B, S, C |
| 167 | Appearance Anxiety Inventory (AAI) | 10 | 4 | B, S |
| 168 | Opioid Risk Tool (ORT) | 10 | 1 | B, S, U |
| 169 | Panic Disorder Severity Scale (PDSS) | 7 | 1 | B, S, U |
| 170 | Penn State Worry Questionnaire (PSWQ) | 16 | 1 | B, S |
| 171 | Revised Child Anxiety and Depression Scale – Child (RCADS-Child) | 47 | 8 | B, S, U |
| 172 | Revised Child Anxiety and Depression Scale – Child (RCADS-Child) | 47 | 8 | B, S, U |
| 173 | Revised Child Anxiety and Depression Scale – Parent (RCADS-Parent) | 47 | 8 | B, S, U |
| 174 | Rosenberg Self-Esteem Scale (RSES) | 10 | 1 | B, S, U |
| 175 | Scale of Positive and Negative Experience (SPANE) | 12 | 3 | B, S, U |
| 176 | Satisfaction with Life Scale (SWLS) | 5 | 1 | B, S |
| 177 | Social Avoidance and Distress Scale (SADS) | 28 | 1 | B, S |
| 178 | Spence Children’s Anxiety Scale – Child (SCAS-Child) | 46 | 7 | B, S, I, U |
| 179 | Spence Children’s Anxiety Scale – Parent (SCAS-Parent) | 39 | 6 | B, S, I, U |
| 180 | Supervisory Styles Inventory (SSI) | 25 | 3 | B, S |
| 181 | Tampa Scale of Kinesiophobia (TSK) | 17 | 1 | B, S |
| 182 | The Kessler Psychological Distress Scale (K10) | 10 | 1 | B, S, U |
| 183 | The Professional Quality of Life Scale – 5 (ProQOL) | 30 | 3 | B, S, U |
| 184 | The Impact of Event Scale – Revised (IES-R) | 22 | 1 | B, S, C, U |
| 185 | Vancouver Obsessional Compulsive Inventory (VOCI) | 55 | 1 | B, S, C, U |
| 186 | Valuing Questionnaire (VQ) | 10 | 2 | C, U |

## Recommended resolution order

1. Resolve SDQ form authorization, variant, items, and rules; keep it unavailable until then.
2. Reconcile the 14 item-count differences and review selection/branching for the flagged forms, starting with forms intended for the next demonstration.
3. Audit each draft scoring formula against the exact questionnaire edition, including the 120 records with retained unparsed expressions; define an explicit non-total report for LEC-5 and a response protocol for asQ.
4. Obtain or verify the four failed source resources and decide which normative tables and report interpretations are needed for each form.
5. Add structured target population, respondent, reference-period, and language metadata for assignment logic; resolve the GAD-7 age conflict.
6. Record the client-approved reuse scope in the dataset and complete independent content, scoring, safety, and report review before patient-care use.

## Reproduction note

Counts above are calculated from the supplied file, not from the current application database. A source flag can apply to a record whose prototype screen already runs. Conversely, a prototype report can display a draft calculation while this source file still has `scoring.enabled: false`.
