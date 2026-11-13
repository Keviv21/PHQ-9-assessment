import { $, el, api, date, reportLinks } from "./workspace-common.js";
let patients = [],
  catalogue = [],
  selectedPatientId = "",
  patient = null,
  selection = "",
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
}
function view(name, patientId = selectedPatientId) {
  clearConsultation();
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
    for (const a of catalogue.filter((a) => a.runnable === available)) {
      const option = new Option(
        a.title + (available ? "" : " — needs review"),
        a.id,
      );
      group.append(option);
    }
    select.append(group);
  }
  select.disabled = false;
}
function selectAssessment(id, from = "manual") {
  selection = id;
  manual = from === "manual";
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
async function openPatient() {
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
    details.append(
      el("summary", "Patient history summary"),
      el("p", p.historySummary, "summary-text"),
    );
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
    if (config.geminiConfigured) await suggest("history");
    else
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
function completionBar(title, count, max) {
  const row = el("div", undefined, "completion-bar");
  row.append(el("strong", `${title}: ${count} completed`));
  const bar = el("progress");
  bar.max = Math.max(1, max);
  bar.value = count;
  bar.setAttribute("aria-label", `${title}: ${count} completed`);
  row.append(bar);
  return row;
}
async function loadAnalytics() {
  const id = $("analytics-patient").value,
    area = $("analytics-patient-content");
  $("analytics-summary").replaceChildren();
  $("analytics-months").replaceChildren();
  $("analytics-by-form").replaceChildren();
  if (!id) {
    area.replaceChildren(el("p", "Choose a patient to view their progress."));
    return;
  }
  try {
    const data = await api(`patients/${id}/analytics`);
    if ($("analytics-patient").value !== id) return;
    area.replaceChildren();
    $("analytics-summary").append(
      el("div", `${data.completed} completed assessments`, "panel"),
      el("div", `${data.drafts} in-progress assessments`, "panel"),
    );
    const groups = data.groups
      .map((g) => ({
        ...g,
        results: g.results.filter(
          (r) =>
            $("analytics-range").value === "all" ||
            Date.now() - Date.parse(r.completedAt) <=
              Number($("analytics-range").value) * 86400000,
        ),
      }))
      .filter((g) => g.results.length);
    const monthly = new Map();
    for (const g of groups) {
      $("analytics-by-form").append(
        completionBar(
          g.title,
          g.results.length,
          Math.max(...groups.map((item) => item.results.length)),
        ),
      );
      for (const r of g.results) {
        const month = r.completedAt.slice(0, 7);
        monthly.set(month, (monthly.get(month) || 0) + 1);
      }
      const card = el("section", undefined, "panel");
      card.append(
        el("h3", g.title),
        el(
          "p",
          `${g.version} · ${g.language} · ${g.results.length} visit(s)`,
          "muted-text",
        ),
      );
      if (g.scored) {
        const valid = g.results.filter(
          (r) => Number.isFinite(r.score) && r.max > 0,
        );
        if (valid.length) {
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.setAttribute("viewBox", "0 0 600 160");
          svg.setAttribute("role", "img");
          svg.setAttribute(
            "aria-label",
            "Score trend; exact values are in the table below.",
          );
          const line = document.createElementNS(svg.namespaceURI, "polyline");
          line.setAttribute(
            "points",
            valid
              .map(
                (r, i) =>
                  `${30 + (i * 540) / Math.max(1, valid.length - 1)},${140 - (r.score / r.max) * 120}`,
              )
              .join(" "),
          );
          line.setAttribute("fill", "none");
          line.setAttribute("stroke", "#138aff");
          line.setAttribute("stroke-width", "3");
          svg.append(line);
          card.append(svg);
        }
      } else
        card.append(
          el(
            "p",
            "Response history only. The source disables scoring, so no clinical score or severity trend is calculated.",
            "notice",
          ),
        );
      const table = el("table");
      const head = el("tr");
      ["Completed", "Responses", "Score", "Report"].forEach((t) =>
        head.append(el("th", t)),
      );
      table.append(head);
      for (const r of g.results) {
        const tr = el("tr");
        tr.append(
          el("td", date(r.completedAt)),
          el("td", `${r.questionCount} saved`),
          el("td", r.score == null ? "Not scored" : `${r.score} / ${r.max}`),
        );
        const td = el("td");
        const link = el("a", "View report");
        link.href = `/api/workspace/sessions/${r.id}/report`;
        link.target = "_blank";
        link.rel = "noopener";
        td.append(link);
        tr.append(td);
        table.append(tr);
      }
      const scroll = el("div", undefined, "table-scroll");
      scroll.append(table);
      card.append(scroll);
      area.append(card);
    }
    for (const [month, count] of [...monthly].sort())
      $("analytics-months").append(
        completionBar(month, count, Math.max(...monthly.values())),
      );
    if (!groups.length)
      area.append(
        el(
          "p",
          "No completed assessments in this period. Complete an assessment to see its history here.",
          "empty-state",
        ),
      );
  } catch (e) {
    error(area, e.message);
  }
}
for (const name of ["prescribe", "reports", "analytics", "library"])
  $(`nav-${name}`).onclick = () => view(name);
$("patient-search").oninput = renderPatients;
$("next-step").onclick = openPatient;
$("back-step").onclick = () => {
  clearConsultation();
  step(1);
};
$("assessment-select").onchange = () =>
  selectAssessment($("assessment-select").value);
$("refresh-suggestions").onclick = () => suggest("history", true);
$("doctor-form").onsubmit = (e) => {
  e.preventDefault();
  suggest("doctor");
};
$("prescribe-button").onclick = prescribe;
$("patient-analytics").onclick = () => view("analytics");
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
