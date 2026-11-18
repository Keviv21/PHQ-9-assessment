import { setupPatientRecords } from "./patient-records.js";
import { createAnalyticsOverview } from "./analytics-overview.js";
import { createPatientAnalytics } from "./analytics.js";
import { $, el, api, date, reportLinks } from "../shared/api.js";
let patients = [],
  catalogue = [],
  patientPage = 0,
  selectedPatientId = "",
  patient = null,
  selection = "",
  pendingLibrarySelection = "",
  doctorMessages = [],
  version = 0,
  recommendBusy = false,
  manual = false,
  config;
const patientPageSize = 5;
const sidebar = $("sidebar-toggle");
function setSidebarCollapsed(collapsed) {
  document.querySelector(".clinic-app").classList.toggle("sidebar-collapsed", collapsed);
  sidebar.setAttribute("aria-expanded", String(!collapsed));
  sidebar.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  sidebar.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
}
sidebar.onclick = () => setSidebarCollapsed(
  !document.querySelector(".clinic-app").classList.contains("sidebar-collapsed"),
);
function error(area, message) {
  area.replaceChildren(el("p", message, "notice alert"));
}
function updatePatientLayout() {
  const prescribing = !$("prescribe-view").hidden;
  const choosing = !$("choose-patient").hidden;
  const app = document.querySelector(".clinic-app");
  app.classList.toggle("prescribing-active", prescribing);
  app.classList.toggle("patient-selection-active", prescribing && choosing);
  $("workspace-back").hidden = !prescribing || choosing;
}
function backToPatients() {
  clearConsultation();
  step(1);
  $("patient-search").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function step(n) {
  $("choose-patient").hidden = n !== 1;
  $("confirm-step").hidden = n !== 2;
  $("step-one").className = `step ${n === 1 ? "current" : "done"}`;
  $("step-two").className = `step ${n === 2 ? "current" : ""}`;
  updatePatientLayout();
}
function clearConsultation() {
  version++;
  doctorMessages = [];
  $("doctor-text").value = "";
  $("doctor-messages").replaceChildren();
  $("doctor-suggestions").replaceChildren();
  recommendBusy = false;
  $("discussion-results").hidden = true;
  $("assessment-dropdown").open = false;
  updateDiscussionControls();
}
function view(name, patientId = selectedPatientId) {
  const currentView = new URL(location.href).searchParams.get("view");
  if (arguments.length < 2 && ["reports", "analytics"].includes(name) && currentView === "reports") patientId = $("report-patient").value;
  if (arguments.length < 2 && ["reports", "analytics"].includes(name) && currentView === "analytics") patientId = $("analytics-patient").value;
  clearConsultation();
  reportRequest?.abort();
  pageAnalytics.hide();
  analyticsOverview.hide();
  if (analyticsDialog.open) analyticsDialog.close();
  for (const id of ["prescribe", "reports", "analytics", "library"]) {
    $(`${id}-view`).hidden = id !== name;
    $(`nav-${id}`).classList.toggle("active", id === name);
    if (id === name) $(`nav-${id}`).setAttribute("aria-current", "page");
    else $(`nav-${id}`).removeAttribute("aria-current");
  }
  updatePatientLayout();
  const url = new URL(location.href);
  url.searchParams.set("view", name);
  if (patientId) url.searchParams.set("patient", patientId);
  else url.searchParams.delete("patient");
  history.replaceState({}, "", url);
  if (name === "reports") {
    $("report-patient").value = patientId;
    loadReports();
  }
  if (name === "analytics") {
    $("analytics-patient").value = patientId;
    analyticsOverview.show();
    loadAnalytics();
  }
}
function showSelectedPatientPage() {
  $("patient-search").value = "";
  patientPage = Math.floor(Math.max(0, patients.findIndex((p) => p.id === selectedPatientId)) / patientPageSize);
  $("patient-list").scrollTop = 0;
  renderPatients();
}
function changePatientPage(page) {
  patientPage = page;
  $("patient-list").scrollTop = 0;
  renderPatients();
}
function renderPatients() {
  const q = $("patient-search").value.trim().toLowerCase();
  const list = $("patient-list");
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  const matches = patients.filter((p) => p.name.toLowerCase().includes(q));
  $("patient-count").textContent = q ? `${matches.length} of ${patients.length} patients` : `${patients.length} patients`;
  const selected = patients.find((p) => p.id === selectedPatientId);
  $("patient-selection-status").textContent = selected ? `${selected.name} selected` : "";
  const pageCount = Math.ceil(matches.length / patientPageSize);
  patientPage = Math.max(0, Math.min(patientPage, pageCount - 1));
  const start = patientPage * patientPageSize;
  $("patient-pagination").hidden = pageCount <= 1;
  $("patient-page-range").textContent = matches.length
    ? `${start + 1}–${Math.min(start + patientPageSize, matches.length)} of ${matches.length} patients`
    : "No patients";
  $("patient-previous").disabled = patientPage === 0;
  $("patient-next").disabled = patientPage >= pageCount - 1;
  $("patient-page").replaceChildren(
    ...Array.from({ length: pageCount }, (_, page) => new Option(`Page ${page + 1} of ${pageCount}`, String(page))),
  );
  $("patient-page").value = String(patientPage);
  for (const p of matches.slice(start, start + patientPageSize)) {
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
      const checked = list.querySelector('input:checked');
      checked?.focus({ preventScroll: true });
      checked?.closest(".patient-row").scrollIntoView({ block: "nearest" });
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
  list.scrollTop = scrollTop;
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
  const list = $("assessment-list");
  const scrollTop = list.scrollTop;
  const query = $("assessment-search").value.trim().toLowerCase();
  const category = $("assessment-category").value;
  const matches = catalogue.filter((a) =>
    (!category || a.category === category) &&
    `${a.title} ${a.description || ""} ${a.id}`.toLowerCase().includes(query),
  ).sort((a, b) => Number(Boolean(b.runnable)) - Number(Boolean(a.runnable)));
  list.replaceChildren();
  $("assessment-match-count").textContent = `${matches.length} of ${catalogue.length}`;
  $("assessment-reset").hidden = !query && !category;
  for (const a of matches) {
    const row = el("label", undefined, "assessment-row");
    row.classList.toggle("selected", a.id === selection);
    row.classList.toggle("unavailable", !a.runnable);
    const radio = el("input");
    radio.type = "radio";
    radio.name = "assessment";
    radio.value = a.id;
    radio.checked = a.id === selection;
    radio.disabled = !a.runnable;
    const info = el("span", undefined, "assessment-row-info");
    const title = el("strong", a.title, "assessment-row-title");
    const meta = el("span", [a.category, `${a.questionCount} questions`].filter(Boolean).join(" · "), "assessment-row-meta");
    info.append(title, meta);
    if (a.description) info.append(el("span", a.description, "assessment-row-description"));
    if (!a.runnable) info.append(el("span", a.reason || "Content needs review before prescribing.", "assessment-unavailable-reason"));
    const status = el("span", a.runnable ? (a.id === selection ? "Selected" : "Select") : "Unavailable", "assessment-row-status");
    radio.onchange = () => {
      selectAssessment(a.id);
      $("assessment-dropdown").open = false;
      $("assessment-dropdown-toggle").focus({ preventScroll: true });
    };
    row.append(radio, info, status);
    list.append(row);
  }
  if (!matches.length) list.append(el("p", catalogue.length
    ? "No assessments match your search. Try another term or clear the filters."
    : "No assessments are available yet.", "assessment-empty"));
  list.scrollTop = scrollTop;
}
function filterAssessments() {
  $("assessment-list").scrollTop = 0;
  populateAssessments();
}
function selectAssessment(id, from = "manual") {
  selection = id;
  manual = from === "manual";
  populateAssessments();
  syncSuggestionSelection();
  const a = catalogue.find((a) => a.id === id),
    area = $("selection-details");
  area.replaceChildren();
  $("assessment-dropdown-value").textContent = a?.title || "Choose an assessment…";
  $("prescription-result").replaceChildren();
  $("prescribe-button").disabled = !a?.runnable;
  $("selection-source").textContent = !a
    ? "Choose an assessment to continue."
    : from === "manual" ? "Selected assessment" : `Selected from ${from}`;
  if (a) {
    area.append(
      el("h3", a.title),
      el(
        "p",
        `${a.questionCount} questions · ${a.scoringEnabled ? "Scoring available" : a.draftScoringAvailable ? "Draft scores available · not clinically validated" : "Responses only · no validated score"}`,
        "tag",
      ),
    );
    if (a.description) {
      const details = el("details", undefined, "selected-assessment-description");
      details.append(el("summary", "Assessment details"), el("p", a.description));
      area.append(details);
    }
    if (!a.runnable) area.append(el("p", a.reason || "This assessment is unavailable.", "notice alert"));
  }
}
function syncSuggestionSelection() {
  document.querySelectorAll(".suggestion-card").forEach((card) => {
    const selected = card.dataset.assessmentId === selection;
    const a = catalogue.find((item) => item.id === card.dataset.assessmentId);
    const toggle = card.querySelector(".suggestion-toggle");
    const explanation = card.querySelector(".suggestion-explanation");
    const choose = card.querySelector(".suggestion-select");
    card.classList.toggle("selected", selected);
    explanation.hidden = !selected;
    toggle.hidden = selected;
    toggle.setAttribute("aria-expanded", String(selected));
    choose.textContent = selected ? "Selected" : a?.runnable ? "Select" : "Unavailable";
    choose.disabled = selected || !a?.runnable;
    choose.setAttribute("aria-label", `${selected ? "Selected" : "Select"} ${a?.title}`);
  });
}
function suggestionCards(result, area, source) {
  area.replaceChildren();
  area.scrollTop = 0;
  if (source === "patient history") area.append(el("p", result.reply));
  result.suggestions.forEach((s, index) => {
    const a = catalogue.find((a) => a.id === s.assessmentId);
    if (!a) return;
    const card = el("article", undefined, "suggestion-card");
    card.dataset.assessmentId = a.id;
    const heading = el("div", undefined, "suggestion-heading");
    if (index === 0) heading.append(el("span", "Suggested first", "tag"));
    heading.append(el("h3", a.title));
    const explanation = el("div", undefined, "suggestion-explanation");
    explanation.id = `${area.id}-explanation-${index}`;
    explanation.hidden = true;
    explanation.append(el("p", s.reason));
    if (s.caution) explanation.append(el("p", s.caution, "muted-text"));
    const actions = el("div", undefined, "suggestion-actions");
    const toggle = el("button", undefined, "suggestion-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-label", `Details for ${a.title}`);
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", explanation.id);
    const chevron = el("span", undefined, "suggestion-chevron");
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(el("span", "Details"), chevron);
    toggle.onclick = () => {
      explanation.hidden = !explanation.hidden;
      toggle.setAttribute("aria-expanded", String(!explanation.hidden));
    };
    const choose = el("button", a.runnable ? "Select" : "Unavailable", "button outline suggestion-select");
    choose.type = "button";
    choose.setAttribute("aria-label", `Select ${a.title}`);
    choose.disabled = !a.runnable;
    choose.onclick = () => {
      selectAssessment(a.id, source);
      manual = true;
      $("assessment-dropdown").open = false;
      $("assessment-dropdown-toggle").focus({ preventScroll: true });
      $("selection-details").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    actions.append(toggle, choose);
    card.append(heading, actions, explanation);
    area.append(card);
  });
  if (!manual) {
    const a = catalogue.find((a) => a.id === result.primaryAssessmentId);
    selectAssessment(a?.runnable ? a.id : "", source);
  } else {
    syncSuggestionSelection();
  }
}
function updateDiscussionControls() {
  const available = Boolean(config?.geminiConfigured);
  $("doctor-text").disabled = !available || recommendBusy;
  $("doctor-send").disabled = !available || recommendBusy || !$("doctor-text").value.trim();
  $("doctor-send").textContent = recommendBusy ? "Preparing suggestions…" : doctorMessages.length ? "Send follow-up" : "Suggest assessments";
  $("discussion-status").textContent = !available
    ? "Symptom discussion is unavailable right now. You can still select an assessment below."
    : recommendBusy ? "Reviewing the patient history and symptoms…" : "";
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
  area.scrollTop = 0;
  $("refresh-suggestions").disabled = true;
  updateDiscussionControls();
  if (source === "doctor") $("discussion-results").hidden = false;
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
          el("strong", m.role === "user" ? "You" : "Assessment assistant"),
          el("p", m.text),
        );
        $("doctor-messages").append(row);
      }
      $("doctor-text").value = "";
      $("doctor-messages").scrollTop = $("doctor-messages").scrollHeight;
    }
    suggestionCards(
      result,
      area,
      source === "history" ? "patient history" : "assessment discussion",
    );
  } catch (e) {
    if (token === version) error(area, e.message);
  } finally {
    if (token === version) {
      recommendBusy = false;
      $("refresh-suggestions").disabled = !config.geminiConfigured;
      updateDiscussionControls();
    }
  }
}
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
  window.scrollTo(0, 0);
  $("patient-summary").replaceChildren(el("p", "Loading patient…"));
  $("patient-recent-results").replaceChildren(el("p", "Loading saved sessions…"));
  $("suggestion-output").replaceChildren(el("p", "Loading suggestions…", "muted-text"));
  try {
    const p = await api(`patients/${selectedPatientId}`);
    if (token !== version) return;
    patient = p;
    loadRecentSessions(p.id, token);
    const box = $("patient-summary");
    const identity = el("div", undefined, "patient-identity");
    const initials = el("span", p.name.split(/\s+/).filter(Boolean).map((name) => name[0]).slice(0, 2).join(""), "patient-avatar");
    initials.setAttribute("aria-hidden", "true");
    const demographics = el("div");
    demographics.append(
      el("h2", p.name),
      el(
        "p",
        `${p.recordedAge == null ? "Age not recorded" : p.recordedAge + " years"} · ${p.gender || "Gender not recorded"}`,
        "muted-text",
      ),
    );
    identity.append(initials, demographics);
    box.replaceChildren(identity);
    const details = el("details", undefined, "patient-history");
    details.open = true;
    details.append(el("summary", "Patient history"));
    const lines = p.historySummary.split(/\n+/).filter(Boolean);
    const list = el("ul", undefined, "summary-list");
    lines.slice(0, 2).forEach((line) => list.append(el("li", line)));
    details.append(list);
    if (lines.length > 2) {
      const more = el("details");
      more.append(
        el("summary", `Show ${lines.length - 2} more history ${lines.length === 3 ? "entry" : "entries"}`),
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
    patientRecords.render(box, p);
    $("refresh-suggestions").disabled = !config.geminiConfigured;
    updateDiscussionControls();
    if (pendingLibrarySelection) {
      selectAssessment(pendingLibrarySelection);
      pendingLibrarySelection = "";
    }
    if (config.geminiConfigured && requestSuggestions) await suggest("history");
    else $("suggestion-output").replaceChildren(el(
      "p",
      config.geminiConfigured
        ? "Select Refresh to request suggestions for this patient."
        : "Suggestions are unavailable. Choose an assessment below to continue.",
      "muted-text",
    ));
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
        "Assessment prescribed. Language and response options are available within the assessment.",
        "notice",
      ),
    );
    const link = el("a", "Start assessment →", "button primary");
    link.href = `/workspace-session.html?prescriptionId=${rx.id}`;
    box.append(link);
  } catch (e) {
    if (token === version) error($("prescription-result"), e.message);
  } finally {
    if (token === version) $("prescribe-button").disabled = false;
  }
}
let reportRequest;
async function loadReports() {
  reportRequest?.abort();
  const controller = new AbortController();
  reportRequest = controller;
  const id = $("report-patient").value, area = $("report-content");
  if (!id) { area.replaceChildren(el("p", "Choose a patient to view reports.", "empty-state")); return; }
  area.replaceChildren(el("p", "Loading reports…"));
  try {
    const prescriptions = await api(`patients/${encodeURIComponent(id)}/prescriptions`, { signal: controller.signal });
    if (reportRequest !== controller) return;
    const completed = prescriptions.filter(p => p.status === "completed").length;
    area.replaceChildren(el("h2", `${completed} assessment ${completed === 1 ? "report" : "reports"}`, "wa-report-heading"));
    if (!prescriptions.length) {
      area.append(el("p", "No prescribed tests or completed reports for this patient yet.", "empty-state")); return;
    }
    const list = el("div", undefined, "wa-report-list");
    for (const rx of prescriptions) {
      const row = el("article", undefined, "wa-report-row"), detail = el("div", undefined, "wa-report-detail");
      const label = { completed: "Completed", "in-progress": "In progress", assigned: "Awaiting start" }[rx.status];
      detail.append(el("span", label, `wa-status wa-status-${rx.status}`), el("h3", rx.title));
      for (const m of rx.metrics || []) detail.append(el("p", `${m.label}: ${m.value} (range ${m.min}–${m.max})${m.status === "draft_unvalidated" ? " · Draft score — not clinically validated" : ""}`));
      if (rx.score !== null) detail.append(el("p", `Score: ${rx.score} / ${rx.max}`));
      detail.append(el("p", `Prescribed ${date(rx.createdAt)}${rx.completedAt ? ` · Completed ${date(rx.completedAt)}` : ""}`, "wa-caption"));
      row.append(detail);
      if (rx.status === "completed") row.append(reportLinks(rx.sessionId));
      else {
        const link = el("a", rx.status === "assigned" ? "Start assessment" : "Resume assessment", "button outline");
        link.href = `/workspace-session.html?prescriptionId=${encodeURIComponent(rx.id)}`;
        row.append(link);
      }
      list.append(row);
    }
    area.append(list);
  } catch (e) {
    if (!controller.signal.aborted && reportRequest === controller) {
      error(area, "Could not load reports. Please try again.");
      const retry = el("button", "Retry reports", "button outline");
      retry.type = "button"; retry.onclick = loadReports; area.append(retry);
    }
  }
}
const analyticsOverview = createAnalyticsOverview($("analytics-overview"));
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
  analyticsOverview.hide();
  reportRequest?.abort();
  pageAnalytics.destroy();
  dialogAnalytics.destroy();
});
for (const name of ["prescribe", "reports", "analytics", "library"])
  $(`nav-${name}`).onclick = () => view(name);
$("patient-search").oninput = () => changePatientPage(0);
$("patient-previous").onclick = () => changePatientPage(patientPage - 1);
$("patient-next").onclick = () => changePatientPage(patientPage + 1);
$("patient-page").onchange = (event) => changePatientPage(Number(event.target.value));
$("next-step").onclick = () => {
  if (!selectedPatientId) return;
  setSidebarCollapsed(true);
  openPatient();
};
$("back-step").onclick = backToPatients;
$("workspace-back").onclick = backToPatients;
$("assessment-dropdown").addEventListener("toggle", () => {
  if (!$("assessment-dropdown").open) return;
  $("assessment-search").focus({ preventScroll: true });
  document.querySelector(".assessment-dropdown-menu").scrollIntoView({ block: "nearest" });
});
$("assessment-dropdown").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    $("assessment-dropdown").open = false;
    $("assessment-dropdown-toggle").focus({ preventScroll: true });
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!$("assessment-dropdown").contains(event.target)) $("assessment-dropdown").open = false;
});
$("doctor-text").oninput = updateDiscussionControls;
$("assessment-search").oninput = filterAssessments;
$("assessment-category").onchange = filterAssessments;
$("assessment-reset").onclick = () => {
  $("assessment-search").value = "";
  $("assessment-category").value = "";
  filterAssessments();
  $("assessment-search").focus();
};
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
function rememberPatient(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("patient", id); else url.searchParams.delete("patient");
  url.searchParams.delete("session");
  history.replaceState({}, "", url);
}
$("report-patient").onchange = () => { rememberPatient($("report-patient").value); loadReports(); };
$("analytics-patient").onchange = () => { rememberPatient($("analytics-patient").value); loadAnalytics(); };
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
    showSelectedPatientPage();
    $("next-step").disabled = false;
    e.target.reset();
    $("patient-dialog").close();
  } catch (err) {
    $("patient-form-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
};
const patientRecords = setupPatientRecords({
  onSaved: async (saved) => {
    selectedPatientId = saved.id;
    rememberPatient(saved.id);
    await loadPatients();
    showSelectedPatientPage();
    $("next-step").disabled = false;
    view("prescribe");
    await openPatient(false);
  },
});
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
    showSelectedPatientPage();
  }
  view(
    ["reports", "analytics", "library"].includes(q.get("view"))
      ? q.get("view")
      : "prescribe",
    selectedPatientId,
  );
} catch (e) {
  error($("patient-list"), e.message);
}
