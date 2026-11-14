import { createPatientAnalytics } from "./workspace-analytics.js";
import { $, el, api, date, reportLinks } from "./workspace-common.js";
let patients = [],
  catalogue = [],
  selectedPatientId = "",
  patient = null,
  selection = "",
  pendingLibrarySelection = "",
  doctorMessages = [],
  version = 0,
  recommendBusy = false,
  manual = false,
  config;
const sidebar = $("sidebar-toggle");
sidebar.onclick = () => {
  const collapsed = document
    .querySelector(".clinic-app")
    .classList.toggle("sidebar-collapsed");
  sidebar.setAttribute("aria-expanded", String(!collapsed));
};
function error(area, message) {
  area.replaceChildren(el("p", message, "notice alert"));
}
function step(n) {
  $("choose-patient").hidden = n !== 1;
  $("confirm-step").hidden = n !== 2;
  $("step-one").className = `step ${n === 1 ? "current" : "done"}`;
  $("step-two").className = `step ${n === 2 ? "current" : ""}`;
}
function clearConsultation() {
  version++;
  doctorMessages = [];
  $("doctor-text").value = "";
  $("doctor-messages").replaceChildren();
  $("doctor-suggestions").replaceChildren();
  recommendBusy = false;
  $("guidance-form").reset();
  $("guidance-fields").disabled = true;
  $("guidance-results").replaceChildren();
  $("guidance-status").textContent = "";
}
function view(name, patientId = selectedPatientId) {
  clearConsultation();
  pageAnalytics.hide();
  if (analyticsDialog.open) analyticsDialog.close();
  for (const id of ["prescribe", "reports", "analytics", "library"]) {
    $(`${id}-view`).hidden = id !== name;
    $(`nav-${id}`).classList.toggle("active", id === name);
  }
  const url = new URL(location.href);
  url.searchParams.set("view", name);
  if (patientId) url.searchParams.set("patient", patientId);
  history.replaceState({}, "", url);
  if (name === "reports") {
    $("report-patient").value = patientId;
    loadReports();
  }
  if (name === "analytics") {
    $("analytics-patient").value = patientId;
    loadAnalytics();
  }
}
function renderPatients() {
  const q = $("patient-search").value.toLowerCase();
  const list = $("patient-list");
  list.replaceChildren();
  for (const p of patients.filter((p) => p.name.toLowerCase().includes(q))) {
    const row = el(
      "label",
      undefined,
      `patient-row ${selectedPatientId === p.id ? "selected" : ""}`,
    );
    const input = el("input");
    input.type = "radio";
    input.name = "patient";
    input.value = p.id;
    input.checked = p.id === selectedPatientId;
    input.onchange = () => {
      selectedPatientId = p.id;
      $("next-step").disabled = false;
      renderPatients();
    };
    const name = el("span", p.name, "patient-name");
    name.append(
      el(
        "small",
        p.source === "NeuroTwin"
          ? "Imported NeuroTwin record"
          : p.source === "Sample"
            ? "Sample patient"
            : "Patient history available",
        "patient-subtitle",
      ),
    );
    row.append(
      input,
      el(
        "span",
        p.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join(""),
        "patient-avatar",
      ),
      name,
    );
    list.append(row);
  }
  if (!list.children.length)
    list.append(el("p", "No matching patients.", "empty-state"));
}
async function loadPatients() {
  patients = await api("patients");
  renderPatients();
  for (const id of ["report-patient", "analytics-patient"]) {
    const selected = $(id).value;
    $(id).replaceChildren(new Option("Choose a patient", ""));
    patients.forEach((p) => $(id).add(new Option(p.name, p.id)));
    $(id).value = selected;
  }
}
function populateAssessments() {
  const select = $("assessment-select");
  select.replaceChildren(
    new Option(`Choose from ${catalogue.length} assessments…`, ""),
  );
  for (const available of [true, false]) {
    const group = el("optgroup");
    group.label = available
      ? "Available questionnaires"
      : "Unsupported or incomplete content";
    for (const a of catalogue.filter(
      (a) =>
        a.runnable === available &&
        (a.id === selection ||
          ((!$("assessment-category").value ||
            a.category === $("assessment-category").value) &&
            `${a.title} ${a.description}`
              .toLowerCase()
              .includes($("assessment-search").value.toLowerCase().trim()))),
    )) {
      const option = new Option(
        a.title + (available ? "" : " — needs review"),
        a.id,
      );
      group.append(option);
    }
    select.append(group);
  }
  select.value = selection;
  $("assessment-match-count").textContent =
    `${select.options.length - 1} of ${catalogue.length} assessments shown`;
  select.disabled = false;
}
function selectAssessment(id, from = "manual") {
  selection = id;
  manual = from === "manual";
  populateAssessments();
  $("assessment-select").value = id;
  const a = catalogue.find((a) => a.id === id),
    area = $("selection-details");
  area.replaceChildren();
  $("prescription-result").replaceChildren();
  $("prescribe-button").disabled = !a?.runnable;
  $("selection-source").textContent =
    from === "manual"
      ? "You can choose any available assessment."
      : `Selected from ${from}. You can choose another assessment.`;
  if (a) {
    area.append(
      el("h3", a.title),
      el("p", a.description),
      el(
        "p",
        `${a.questionCount} questions · ${a.scoringEnabled ? "Scoring available" : "Responses only · no validated score"}`,
        "tag",
      ),
    );
    if (!a.runnable) area.append(el("p", a.reason, "notice alert"));
  }
}
function suggestionCards(result, area, source) {
  area.replaceChildren();
  if (source === "patient history") area.append(el("p", result.reply));
  result.suggestions.forEach((s, index) => {
    const a = catalogue.find((a) => a.id === s.assessmentId);
    if (!a) return;
    const card = el(
      "article",
      undefined,
      `suggestion-card ${index === 0 ? "leading" : ""}`,
    );
    if (index === 0)
      card.append(el("span", "Leading suggestion · Gemini", "tag"));
    card.append(el("h3", a.title), el("p", s.reason));
    if (s.caution) card.append(el("p", s.caution, "muted-text"));
    const choose = el(
      "button",
      a.runnable ? "Choose this assessment" : "Content needs review",
      "button outline",
    );
    choose.type = "button";
    choose.disabled = !a.runnable;
    choose.onclick = () => {
      selectAssessment(a.id, source);
      $("assessment-select").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };
    card.append(choose);
    area.append(card);
  });
  if (!manual) {
    const a = catalogue.find((a) => a.id === result.primaryAssessmentId);
    selectAssessment(a?.runnable ? a.id : "", source);
  }
}
async function suggest(source, refresh = false) {
  if (recommendBusy) return;
  const token = version,
    id = selectedPatientId;
  const area =
    source === "history" ? $("suggestion-output") : $("doctor-suggestions");
  let next = doctorMessages;
  const text = $("doctor-text").value.trim();
  if (source === "doctor") {
    if (!text) return;
    next = [...doctorMessages.slice(-28), { role: "user", text }];
  }
  recommendBusy = true;
  $("refresh-suggestions").disabled = true;
  $("doctor-send").disabled = true;
  area.replaceChildren(
    el(
      "p",
      "Matching history and observations with the assessment catalogue…",
      "loading-state",
    ),
  );
  try {
    const result = await api(`patients/${id}/recommendations`, {
      method: "POST",
      body: JSON.stringify({
        source,
        refresh,
        messages: source === "doctor" ? next : [],
      }),
    });
    if (token !== version) return;
    if (source === "doctor") {
      doctorMessages = [...next, { role: "assistant", text: result.reply }];
      $("doctor-messages").replaceChildren();
      for (const m of doctorMessages) {
        const row = el("div", undefined, `chat-message ${m.role}`);
        row.append(
          el("strong", m.role === "user" ? "Doctor" : "Gemini"),
          el("p", m.text),
        );
        $("doctor-messages").append(row);
      }
      $("doctor-text").value = "";
    }
    suggestionCards(
      result,
      area,
      source === "history" ? "patient history" : "doctor conversation",
    );
  } catch (e) {
    if (token === version) error(area, e.message);
  } finally {
    if (token === version) {
      recommendBusy = false;
      $("refresh-suggestions").disabled = !config.geminiConfigured;
      $("doctor-send").disabled = !config.geminiConfigured;
    }
  }
}
const concernLabels = {
  depression: "Low mood or reduced interest",
  anxiety: "Worry or anxiety",
  traumaSymptoms: "Trauma-related symptoms",
  stress: "Stress",
};
function guidanceConcerns() {
  return [
    ...document.querySelectorAll('input[name="guidance-concern"]:checked'),
  ].map((i) => i.value);
}
function guidanceFocus() {
  const concerns = guidanceConcerns(),
    selected = $("guidance-focus").value;
  $("guidance-focus").replaceChildren(new Option("Use summary priorities", ""));
  concerns.forEach((value) =>
    $("guidance-focus").add(new Option(concernLabels[value], value)),
  );
  $("guidance-focus").value = concerns.includes(selected) ? selected : "";
  $("guidance-focus-label").hidden = concerns.length < 2;
  if (concerns.length < 2) $("guidance-focus").value = "";
}
function renderGuidance(result, autoSelect = false) {
  const area = $("guidance-results");
  area.replaceChildren(
    el(
      "p",
      result.reply,
      result.status === "suggestions" ? "notice" : "notice alert",
    ),
  );
  for (const item of result.suggestions) {
    const card = el(
      "article",
      undefined,
      `suggestion-card ${item.assessmentId === result.primaryAssessmentId ? "leading" : ""}`,
    );
    card.append(
      el(
        "span",
        item.assessmentId === result.primaryAssessmentId
          ? "Suggested first · structured guidance"
          : "Additional option · structured guidance",
        "tag",
      ),
      el("h3", item.title),
      el("p", item.purpose),
      el("p", item.reason),
    );
    if (item.caution) card.append(el("p", item.caution, "muted-text"));
    if (item.evidence.length) {
      card.append(el("strong", "Matched summary observations"));
      const list = el("ul", undefined, "evidence-list");
      item.evidence.forEach((e) => list.append(el("li", e.description)));
      card.append(list);
    }
    const source = el("a", "Clinical reference");
    source.href = item.source;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    const choose = el(
      "button",
      item.available ? "Use this doctor suggestion" : item.availability,
      "button outline",
    );
    choose.type = "button";
    choose.disabled = !item.available;
    choose.onclick = () => {
      selectAssessment(item.assessmentId, "doctor review");
      manual = true;
      $("assessment-select").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };
    const actions = el("div", undefined, "guidance-actions");
    actions.append(choose, source);
    card.append(actions);
    area.append(card);
  }
  if (result.ignoredObservations.length) {
    const details = el("details");
    details.append(
      el("summary", "Additional context — not used as current concerns"),
    );
    const list = el("ul", undefined, "summary-list");
    result.ignoredObservations.forEach((e) =>
      list.append(el("li", `${e.description} — ${e.reason}`)),
    );
    details.append(list);
    area.append(details);
  }
  if (autoSelect && !manual && result.primaryAssessmentId) {
    selectAssessment(result.primaryAssessmentId, "doctor review");
    manual = true;
  }
}
async function loadGuidance(id, token) {
  $("guidance-status").textContent = "Loading doctor review…";
  try {
    const r = await api(`patients/${id}/doctor-guidance`);
    if (token !== version) return;
    $("guidance-age").value = r.context.ageGroup;
    $("guidance-safety").value = r.context.safetyStatus;
    $("guidance-trauma").value = r.context.traumaExposure;
    document
      .querySelectorAll('input[name="guidance-concern"]')
      .forEach((i) => (i.checked = r.context.concerns.includes(i.value)));
    guidanceFocus();
    renderGuidance(r, !config.geminiConfigured);
    $("guidance-status").textContent =
      r.contextSource === "Sample patient summary"
        ? "Pre-filled from the sample summary. Review or adjust the details."
        : "Confirm the review details and current concerns to request doctor guidance.";
  } catch (e) {
    if (token === version) error($("guidance-results"), e.message);
  } finally {
    if (token === version) $("guidance-fields").disabled = false;
  }
}
$("guidance-form").onsubmit = async (e) => {
  e.preventDefault();
  const token = version,
    id = selectedPatientId;
  $("guidance-fields").disabled = true;
  $("guidance-status").textContent = "Preparing doctor suggestions…";
  try {
    const result = await api(`patients/${id}/doctor-guidance`, {
      method: "POST",
      body: JSON.stringify({
        context: {
          ageGroup: $("guidance-age").value,
          safetyStatus: $("guidance-safety").value,
          traumaExposure: $("guidance-trauma").value,
          concerns: guidanceConcerns(),
        },
        focus: $("guidance-focus").value,
      }),
    });
    if (token !== version) return;
    renderGuidance(result, true);
    $("guidance-status").textContent =
      "Updated from doctor review. You can choose a suggestion or any assessment in the full dropdown.";
  } catch (e) {
    if (token === version) error($("guidance-results"), e.message);
  } finally {
    if (token === version) $("guidance-fields").disabled = false;
  }
};
$("guidance-form").onchange = (e) => {
  if (e.target.id === "guidance-focus") {
    $("guidance-form").requestSubmit();
    return;
  }
  guidanceFocus();
  $("guidance-results").replaceChildren();
  $("guidance-status").textContent =
    "Review details changed. Select “Suggest from doctor review” to update suggestions.";
};

async function loadRecentSessions(id, token) {
  const box = $("patient-recent-results");
  box.replaceChildren(el("p", "Loading saved sessions…"));
  try {
    const sessions = await api(`patients/${id}/sessions`);
    if (token !== version) return;
    box.replaceChildren();
    for (const s of sessions.slice(0, 5)) {
      const row = el("article", undefined, "recent-session");
      const link = el("a", s.definition.title);
      link.href =
        s.status === "completed"
          ? `/api/workspace/sessions/${s.id}/report`
          : `/workspace-session.html?prescriptionId=${s.prescriptionId}`;
      if (s.status === "completed") {
        link.target = "_blank";
        link.rel = "noopener";
      }
      row.append(
        link,
        el(
          "small",
          `${s.status === "completed" ? "Completed" : "Resume draft"} · ${date(s.completedAt || s.startedAt)}`,
        ),
      );
      box.append(row);
    }
    if (!sessions.length)
      box.append(
        el("p", "No saved sessions for this patient yet.", "muted-text"),
      );
  } catch (e) {
    if (token === version) error(box, e.message);
  }
}
async function openPatient(requestSuggestions = true) {
  clearConsultation();
  const token = version;
  manual = false;
  selectAssessment("", "patient history");
  step(2);
  $("patient-summary").replaceChildren(el("p", "Loading patient…"));
  try {
    const p = await api(`patients/${selectedPatientId}`);
    if (token !== version) return;
    patient = p;
    loadRecentSessions(p.id, token);
    const box = $("patient-summary");
    box.replaceChildren(
      el("h2", p.name),
      el(
        "p",
        `${p.recordedAge == null ? "Age not recorded" : p.recordedAge + " years"} · ${p.gender || "Gender not recorded"}`,
        "muted-text",
      ),
    );
    const details = el("details");
    details.open = true;
    details.append(el("summary", "Patient history summary"));
    const lines = p.historySummary.split(/\n+/).filter(Boolean);
    const list = el("ul", undefined, "summary-list");
    lines.slice(0, 2).forEach((line) => list.append(el("li", line)));
    details.append(list);
    if (lines.length > 2) {
      const more = el("details");
      more.append(
        el("summary", `Show ${lines.length - 2} more history entries`),
      );
      const rest = el("ul", undefined, "summary-list");
      lines.slice(2).forEach((line) => rest.append(el("li", line)));
      more.append(rest);
      details.append(more);
    }
    box.append(details);
    if (p.sourceProfile) {
      const full = el("details");
      full.append(el("summary", "Complete imported record"));
      const pre = el("pre", JSON.stringify(p.sourceProfile, null, 2));
      pre.className = "source-record";
      full.append(pre);
      box.append(full);
    }
    $("refresh-suggestions").disabled = !config.geminiConfigured;
    $("doctor-send").disabled = !config.geminiConfigured;
    await loadGuidance(p.id, token);
    if (token !== version) return;
    if (pendingLibrarySelection) {
      selectAssessment(pendingLibrarySelection);
      pendingLibrarySelection = "";
    }
    if (config.geminiConfigured && requestSuggestions) await suggest("history");
    else if (!config.geminiConfigured)
      error(
        $("suggestion-output"),
        "Gemini is not configured. Choose an assessment manually to continue.",
      );
  } catch (e) {
    if (token === version) error($("patient-summary"), e.message);
  }
}
async function prescribe() {
  const id = selectedPatientId,
    token = version;
  $("prescribe-button").disabled = true;
  try {
    const rx = await api(`patients/${id}/prescriptions`, {
      method: "POST",
      body: JSON.stringify({ assessmentId: selection }),
    });
    if (token !== version) return;
    const box = $("prescription-result");
    box.replaceChildren(
      el(
        "p",
        "Assessment prescribed. Choose the language and response mode on the next screen.",
        "notice",
      ),
    );
    const link = el("a", "Open patient assessment →", "button primary");
    link.href = `/workspace-session.html?prescriptionId=${rx.id}`;
    box.append(link);
  } catch (e) {
    if (token === version) error($("prescription-result"), e.message);
  } finally {
    if (token === version) $("prescribe-button").disabled = false;
  }
}
async function loadReports() {
  const id = $("report-patient").value,
    area = $("report-content");
  if (!id) {
    area.replaceChildren(el("p", "Choose a patient to view reports."));
    return;
  }
  area.replaceChildren(el("p", "Loading reports…"));
  try {
    const sessions = await api(`patients/${id}/sessions`);
    if ($("report-patient").value !== id) return;
    area.replaceChildren();
    for (const s of sessions) {
      const card = el("article", undefined, "panel");
      card.append(
        el("h3", s.definition.title),
        el(
          "p",
          `${s.status === "completed" ? "Completed" : "In progress"} · ${date(s.completedAt || s.startedAt)} · ${s.language}`,
        ),
      );
      if (s.status === "completed") card.append(reportLinks(s.id));
      else {
        const link = el("a", "Resume assessment", "button outline");
        link.href = `/workspace-session.html?prescriptionId=${s.prescriptionId}`;
        card.append(link);
      }
      area.append(card);
    }
    if (!sessions.length)
      area.append(
        el("p", "No saved assessments for this patient yet.", "empty-state"),
      );
  } catch (e) {
    error(area, e.message);
  }
}
const pageAnalytics = createPatientAnalytics($("analytics-dashboard"));
const dialogAnalytics = createPatientAnalytics($("analytics-dialog-dashboard"));
const analyticsDialog = $("patient-analytics-dialog");
function loadAnalytics() {
  pageAnalytics.show($("analytics-patient").value, {
    range: $("analytics-range").value,
    sessionId: new URL(location.href).searchParams.get("session"),
  });
}
analyticsDialog.addEventListener("close", () => dialogAnalytics.hide());
addEventListener("pagehide", () => {
  pageAnalytics.destroy();
  dialogAnalytics.destroy();
});
for (const name of ["prescribe", "reports", "analytics", "library"])
  $(`nav-${name}`).onclick = () => view(name);
$("patient-search").oninput = renderPatients;
$("next-step").onclick = () => openPatient();
$("back-step").onclick = () => {
  clearConsultation();
  step(1);
};
$("assessment-search").oninput = populateAssessments;
$("assessment-category").onchange = populateAssessments;
addEventListener("choose-library-assessment", async ({ detail }) => {
  if (!catalogue.some((a) => a.id === detail && a.runnable)) return;
  if (!selectedPatientId) {
    pendingLibrarySelection = detail;
    view("prescribe");
    step(1);
    $("patient-search").focus();
    $("patient-search").placeholder =
      "Select a patient first, then choose the assessment";
    return;
  }
  view("prescribe");
  await openPatient(false);
  if (patient?.id === selectedPatientId) selectAssessment(detail);
});
$("assessment-select").onchange = () =>
  selectAssessment($("assessment-select").value);
$("refresh-suggestions").onclick = () => suggest("history", true);
$("doctor-form").onsubmit = (e) => {
  e.preventDefault();
  suggest("doctor");
};
$("prescribe-button").onclick = prescribe;
$("patient-analytics").onclick = () => {
  if (!patient || patient.id !== selectedPatientId) return;
  $("pa-patient-name").textContent = patient.name;
  analyticsDialog.showModal();
  dialogAnalytics.show(patient.id);
};
$("patient-reports").onclick = () => view("reports");
$("report-patient").onchange = loadReports;
$("analytics-patient").onchange = loadAnalytics;
$("analytics-range").onchange = loadAnalytics;
$("add-patient").onclick = () => {
  $("patient-form-error").textContent = "";
  $("patient-dialog").showModal();
};
$("close-patient").onclick = () => $("patient-dialog").close();
$("add-patient-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const p = await api("patients", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
    });
    selectedPatientId = p.id;
    await loadPatients();
    $("patient-search").value = "";
    renderPatients();
    $("next-step").disabled = false;
    e.target.reset();
    $("patient-dialog").close();
  } catch (err) {
    $("patient-form-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
try {
  config = await api("catalogue");
  catalogue = config.catalogue;
  [...new Set(catalogue.map((a) => a.category))]
    .sort()
    .forEach((category) =>
      $("assessment-category").add(new Option(category, category)),
    );
  populateAssessments();
  await loadPatients();
  const q = new URL(location.href).searchParams;
  selectedPatientId = patients.some((p) => p.id === q.get("patient"))
    ? q.get("patient")
    : "";
  if (selectedPatientId) {
    $("next-step").disabled = false;
    renderPatients();
  }
  view(
    ["reports", "analytics", "library"].includes(q.get("view"))
      ? q.get("view")
      : "prescribe",
  );
} catch (e) {
  error($("patient-list"), e.message);
}
