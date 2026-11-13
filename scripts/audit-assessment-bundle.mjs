import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/audit-assessment-bundle.mjs <assessment-bundle.json>');
  process.exitCode = 2;
} else {
  try {
    const bundle = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(bundle.assessments)) throw new Error('The file has no assessments array.');

    const report = {
      declaredAssessments: bundle.assessment_count ?? null,
      records: bundle.assessments.length,
      recordsWithNoQuestions: 0,
      recordsWithCompleteAnswerOptions: 0,
      recordsWithMissingAnswerOptions: 0,
      questions: 0,
      questionsWithoutAnswerOptions: 0,
      questionsWithUnlabelledPrintedValues: 0,
      questionsWithUnsupportedResponseType: 0,
      scoringEnabledRecords: 0,
      clinicallyApprovedRecords: 0,
      recordsWithVerifiedReusePermission: 0,
    };

    for (const record of bundle.assessments) {
      const questionnaire = record.questionnaire || {};
      const questions = Array.isArray(questionnaire.items) ? questionnaire.items : [];
      const responseSets = new Map((questionnaire.response_sets || []).map((set) => [set.id, set]));
      const missingOptions = questions.filter((question) => {
        const options = responseSets.get(question.response_set_id)?.options;
        return !Array.isArray(options) || options.length < 2;
      }).length;
      const incomplete = questions.filter((question) => {
        const options = responseSets.get(question.response_set_id)?.options || [];
        const unlabelled = options.some((option) => !String(option.label || '').trim());
        const printedScale = unlabelled && options.every((option) =>
          (typeof option.printed_value === 'number' && Number.isFinite(option.printed_value)) ||
          (typeof option.printed_value === 'string' && option.printed_value.trim()));
        if (printedScale) report.questionsWithUnlabelledPrintedValues += 1;
        if (!['choice', 'single_choice'].includes(question.response_type) ||
            (question.selection_mode && question.selection_mode !== 'single')) {
          report.questionsWithUnsupportedResponseType += 1;
        }
        return !String(question.text || '').trim() || options.length < 2 ||
          (unlabelled && !printedScale) ||
          !['choice', 'single_choice'].includes(question.response_type) ||
          (question.selection_mode && question.selection_mode !== 'single');
      }).length;

      report.questions += questions.length;
      report.questionsWithoutAnswerOptions += missingOptions;
      if (!questions.length) report.recordsWithNoQuestions += 1;
      else if (incomplete) report.recordsWithMissingAnswerOptions += 1;
      else report.recordsWithCompleteAnswerOptions += 1;
      if (record.scoring?.enabled === true) report.scoringEnabledRecords += 1;
      if (record.review?.ready_for_clinical_use === true) report.clinicallyApprovedRecords += 1;
      if (record.rights?.reproduction_permission === 'verified') report.recordsWithVerifiedReusePermission += 1;
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`Could not audit assessment bundle: ${error.message}`);
    process.exitCode = 1;
  }
}
