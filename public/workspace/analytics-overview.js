import { api, el, date, reportLinks } from "../shared/api.js";

export function monthChart(months) {
  const chart = el("div", undefined, "wa-months");
  const maximum = Math.max(1, ...months.map(m => m.completed));
  for (const month of months) {
    const column = el("div", undefined, "wa-month");
    const track = el("div", undefined, "wa-month-track");
    const bar = el("span");
    bar.style.height = `${month.completed / maximum * 100}%`;
    track.append(bar);
    const label = new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
    column.append(el("strong", String(month.completed)), track, el("small", label));
    chart.append(column);
  }
  return chart;
}

export function createAnalyticsOverview(root) {
  root.innerHTML = `<div class="wa-heading"><p>All patients · all time</p><button class="button outline" type="button">Refresh overview</button></div><p role="status"></p><div data-overview></div>`;
  const content = root.querySelector("[data-overview]"), status = root.querySelector('[role="status"]'), button = root.querySelector("button");
  let request, active = false, timer;
  async function refresh() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    button.disabled = true;
    status.textContent = "Loading overview…";
    try {
      const data = await api("analytics/overview", { signal: controller.signal });
      if (!active || request !== controller) return;
      const t = data.totals, hours = t.medianCompletionHours;
      const cards = el("dl", undefined, "wa-summary");
      for (const [label, value, hint] of [
        ["Prescribed tests", t.prescribed, `${t.notStarted} awaiting start`],
        ["Completed tests", t.completed, `${t.inProgress} in progress`],
        ["Completion rate", t.completionRate === null ? "—" : `${t.completionRate}%`, "Of prescribed tests"],
        ["Median completion time", hours === null ? "—" : hours < 1 ? `${Math.round(hours * 60)} min` : hours < 24 ? `${hours.toFixed(1)} hr` : `${(hours / 24).toFixed(1)} days`, "From prescription to completed report"],
      ]) {
        const card = el("div", undefined, "panel wa-stat"), valueNode = el("dd");
        valueNode.append(el("strong", String(value)), el("small", hint));
        card.append(el("dt", label), valueNode); cards.append(card);
      }
      const charts = el("div", undefined, "wa-charts"), monthly = el("section", undefined, "panel"), forms = el("section", undefined, "panel");
      monthly.append(el("h2", "Completed assessments by month"), monthChart(data.months), el("p", "Last six calendar months (UTC).", "wa-caption"));
      forms.append(el("h2", "By assessment"));
      const list = el("div", undefined, "wa-forms");
      for (const form of data.byForm) {
        const row = el("div", undefined, "wa-form"), meter = el("progress");
        meter.max = form.prescribed; meter.value = form.completed;
        meter.setAttribute("aria-label", `${form.title}: ${form.completed} of ${form.prescribed} completed`);
        row.append(el("strong", form.title), el("small", `${form.completed} completed · ${form.prescribed} prescribed`), meter);
        list.append(row);
      }
      if (!data.byForm.length) list.append(el("p", "Prescribed tests will appear here.", "empty-state"));
      forms.append(list); charts.append(monthly, forms);
      content.replaceChildren(cards, charts);
      status.textContent = "";
    } catch (error) {
      if (!controller.signal.aborted && request === controller) {
        content.replaceChildren();
        status.textContent = "Could not load overview. Select Refresh overview to try again.";
      }
    } finally { if (request === controller) button.disabled = false; }
  }
  function hide() { active = false; request?.abort(); clearInterval(timer); }
  button.onclick = refresh;
  return {
    show() { hide(); active = true; refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000); },
    hide,
  };
}

export function renderPatientActivity(root, groups) {
  const visits = groups.flatMap(g => g.results.map(r => ({ ...r, title: g.title, draftScores: g.draftScores, metrics: g.metrics })))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  root.replaceChildren(); root.hidden = !visits.length;
  if (!visits.length) return;
  const counts = new Map();
  for (const visit of visits) {
    const key = new Date(visit.completedAt).toISOString().slice(0, 7);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = [...counts.keys()].sort(), months = [];
  const end = new Date(`${keys.at(-1)}-01T00:00:00Z`);
  for (const cursor = new Date(`${keys[0]}-01T00:00:00Z`); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const month = cursor.toISOString().slice(0, 7);
    months.push({ month, completed: counts.get(month) || 0 });
  }
  root.append(el("h3", "Completed assessments over time"),
    el("p", `${visits.length} completed · ${visits.filter(v => v.values?.some(Number.isFinite)).length} with recorded scores · selected period`, "wa-caption"), monthChart(months));
  const scroll = el("div", undefined, "pa-table-scroll wa-activity-table"), table = el("table"), head = el("thead"), row = el("tr"), body = el("tbody");
  table.setAttribute("aria-label", "Completed assessment activity");
  for (const label of ["Completed", "Assessment", "Result", "Report"]) { const cell = el("th", label); cell.scope = "col"; row.append(cell); }
  head.append(row);
  for (const visit of visits) {
    const row = el("tr"), actions = el("td");
    actions.append(reportLinks(visit.id));
    row.append(el("td", date(visit.completedAt)), el("td", visit.title), el("td", visit.values?.some(Number.isFinite)
      ? visit.metrics.map((m, i) => `${m.name}: ${visit.values[i] ?? "Unavailable"} / ${m.max}`).join("; ") + (visit.draftScores ? " · Draft score — not clinically validated" : "")
      : "Answers recorded"), actions);
    body.append(row);
  }
  table.append(head, body); scroll.append(table); root.append(scroll);
}
