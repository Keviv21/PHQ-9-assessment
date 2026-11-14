import { presentation } from "./presentation.js";
import { HttpError } from "./errors.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const duration = (seconds) =>
  seconds == null
    ? "Not recorded"
    : seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)} min ${seconds % 60}s`;

// Adapt Sagar's results/response charts using the saved definition, never generic norms.
export function assessmentReport(state, patient) {
  if (state.status !== "completed")
    throw new HttpError(
      409,
      "Complete the assessment before downloading its report.",
    );
  const d = presentation(state.definition, state.language);
  const elapsed =
    (Date.parse(state.completedAt) - Date.parse(state.startedAt)) / 1000;
  const scored = d.scoring?.enabled === true && Number.isFinite(state.score);
  const responses = d.questions.map((q, i) => {
    const option = q.options.find((o) => o.value === state.answers[i]);
    return {
      number: i + 1,
      questionId: q.id,
      question: q.text,
      originalQuestion: state.definition.questions[i].text,
      value: state.answers[i],
      response: option?.label ?? "Not recorded",
      summary: state.answerDetails?.[i]?.summary || null,
      method: state.answerDetails?.[i]?.method || null,
    };
  });
  const counts = new Map();
  for (const r of responses)
    counts.set(r.response, (counts.get(r.response) || 0) + 1);
  return {
    id: state.id,
    title: d.title,
    patient: { name: patient.name, recordedAge: patient.recordedAge ?? null },
    language: state.language,
    mode: state.sessionMode,
    version: d.version,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    elapsedSeconds:
      Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null,
    score: scored ? state.score : null,
    min: scored ? d.scoring.min : null,
    max: scored ? d.scoring.max : null,
    severity: scored ? state.severity : null,
    bands: scored ? d.scoring.bands || [] : [],
    instructions: d.instructions,
    referencePeriod: d.referencePeriod,
    responses,
    responseCounts: [...counts].map(([label, count]) => ({ label, count })),
    revisions: state.answerRevisions || [],
    note: scored
      ? "Recorded score and descriptor use the scoring rules saved with this questionnaire."
      : "Responses only. This questionnaire does not provide enabled scoring rules; no severity or percentile is calculated.",
  };
}

export function reportHtml(r) {
  const esc = escape;
  const timestamp = (value) =>
    Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString("en-GB", {
          timeZone: "UTC",
          dateStyle: "medium",
          timeStyle: "short",
        }) + " UTC"
      : "Not recorded";
  const facts = [
    ["Patient", r.patient.name],
    ["Age recorded", r.patient.recordedAge ?? "Not recorded"],
    ["Completed", timestamp(r.completedAt)],
    ["Elapsed time", duration(r.elapsedSeconds)],
    ["Language", r.language],
    [
      "Response mode",
      { screen: "On-screen", chat: "Chat", voice: "Voice" }[r.mode] || r.mode,
    ],
    ["Questionnaire version", r.version],
    ["Responses", `${r.responses.length} saved`],
  ];
  const bars = r.responseCounts
    .map(
      (c) =>
        `<div class="bar-row"><span>${esc(c.label)}</span><progress max="${r.responses.length}" value="${c.count}"></progress><strong>${c.count}</strong></div>`,
    )
    .join("");
  return `<!doctype html><html lang="${esc(r.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)} — Assessment report</title><style>
body{font:15px/1.6 system-ui;color:#203349;background:#f4f7fb;margin:0}main{max-width:1000px;margin:32px auto;background:white;padding:36px;border:1px solid #e1e8f0;border-radius:16px}h1{font-size:28px;margin:8px 0}h2{font-size:20px;margin-top:28px}.eyebrow{color:#45618b;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.toolbar{display:flex;gap:12px;flex-wrap:wrap}button,a{padding:10px 16px;border-radius:8px;border:1px solid #ccd9eb;color:#155cc2;background:white;text-decoration:none;cursor:pointer}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:20px 0;border-block:1px solid #e1e8f0}dt{font-size:12px;color:#697b91}dd{margin:4px 0;overflow-wrap:anywhere}.notice{padding:16px;background:#eef5ff;border-radius:8px}.bar-row{display:grid;grid-template-columns:minmax(180px,2fr) 3fr 30px;gap:16px;align-items:center;margin:12px 0}progress{width:100%;accent-color:#1688ed}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #e1e8f0;text-align:left;padding:12px;vertical-align:top}th{background:#f4f7fb}small{display:block;color:#66768a}tr{break-inside:avoid}.table-scroll{overflow:auto}footer{margin-top:28px;color:#66768a;font-size:12px}@media(max-width:650px){main{margin:0;padding:18px;border:0}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.bar-row{grid-template-columns:1fr 1fr 24px;gap:8px}}@media print{body{background:white}main{border:0;margin:0;padding:0;max-width:none}.toolbar{display:none}thead{display:table-header-group}h2{break-after:avoid}.facts{grid-template-columns:repeat(4,minmax(0,1fr))}}
</style></head><body><main><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button><a href="/api/workspace/sessions/${encodeURIComponent(r.id)}/report?download=1">Download HTML report</a></div><p class="eyebrow">OpenMind · Assessment results · Clinician review</p><h1>${esc(r.title)}</h1><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl><h2>Results</h2>${r.score !== null ? `<p><strong>Score: ${esc(r.score)} / ${esc(r.max)}</strong> · ${esc(r.severity || "No recorded descriptor")}</p>` : ""}<p class="notice">${esc(r.note)}</p>${r.bands.length ? `<table><thead><tr><th>Recorded score range</th><th>Descriptor</th></tr></thead><tbody>${r.bands.map((b) => `<tr><td>${esc(b.min)}–${esc(b.max)}</td><td>${esc(b.label)}${r.score >= b.min && r.score <= b.max ? " · Recorded result" : ""}</td></tr>`).join("")}</tbody></table>` : ""}<h2>Response distribution</h2><p>Number of questions answered with each label. These counts are not a clinical score or population percentile.</p>${bars}<h2>Saved responses</h2><p>${esc(r.referencePeriod || r.instructions)}</p><div class="table-scroll"><table><thead><tr><th>#</th><th>Question</th><th>Final response</th></tr></thead><tbody>${r.responses.map((q) => `<tr><td>${q.number}</td><td>${esc(q.question)}${q.originalQuestion !== q.question ? `<small>Original: ${esc(q.originalQuestion)}</small>` : ""}</td><td>${esc(q.response)}${q.summary ? `<small>Response summary: ${esc(q.summary)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>${r.revisions.length ? `<h2>Answer revisions</h2><p>${r.revisions.length} correction(s) recorded before completion.</p><table><thead><tr><th>Question</th><th>Previous response</th><th>Updated response</th><th>Saved at</th></tr></thead><tbody>${r.revisions.map((a) => `<tr><td>${esc(a.questionId)}</td><td>${esc(a.previousLabel)}</td><td>${esc(a.responseLabel)}</td><td>${esc(timestamp(a.at))}</td></tr>`).join("")}</tbody></table>` : ""}<footer>Saved assessment ${esc(r.id)}. Source questionnaire and assisted translations require review. No audio, video or doctor conversation is included.</footer></main></body></html>`;
}
