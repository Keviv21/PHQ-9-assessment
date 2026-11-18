import { renderPatientActivity } from "./analytics-overview.js";
import { createDistributionChartSvg, createResponseChartSvg, responseCounts, trendData } from "./analytics-charts.js";
import { el as node, api, reportLinks, date } from "../shared/api.js";
const colors = ["#245bd5", "#9844a8", "#087b70"];
const duration = (seconds) =>
  seconds == null
    ? "Not recorded"
    : seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)} min ${seconds % 60}s`;
const modes = { screen: "On-screen", chat: "Chat", voice: "Voice" };
// Sagar's patient analytics interaction and trend renderer, adapted to saved workspace sessions.
export function createPatientAnalytics(root) {
  root.classList.add("pa-dashboard");
  root.innerHTML = `<dl class="pa-overview" data-part="overview"></dl>
 <div class="pa-refresh"><p data-part="status" role="status" class="pa-status"></p><button type="button" class="button outline" data-part="retry">Refresh history</button></div>
 <section data-part="activity" class="wa-activity" hidden></section>
 <div data-part="content" hidden>
  <div class="pa-toolbar"><label>Assessment<select data-part="assessment"></select></label><p class="pa-completed" data-part="completed"></p></div>
  <dl class="pa-scores" data-part="scores"></dl>
  <section class="pa-chart"><div class="pa-chart-header"><h3 data-part="trend-title">Score trend</h3><div class="pa-legend" data-part="legend"></div></div><p class="pa-note" data-part="note"></p><canvas data-part="plot" role="img" aria-label="Assessment scores by visit. Exact values are listed in Assessment history."></canvas></section>
  <section class="pa-history"><h3>Assessment history</h3><div class="pa-table-scroll"><table data-part="table" aria-label="Assessment history"></table></div></section>
  <section class="pa-history"><div class="pa-toolbar"><h3>Visit details</h3><label>Visit<select data-part="visit"></select></label></div><div data-part="details"></div></section>
 </div>`;
  const find = (part) => root.querySelector(`[data-part="${part}"]`);
  const assessment = find("assessment"),
    plot = find("plot"),
    content = find("content"),
    status = find("status"),
    retry = find("retry");
  let patientId = "",
    groups = [],
    request,
    timer,
    active = false,
    period = "all",
    completion = null,
    revision = 0;
  const selectedGroup = () => groups.find((g) => g.key === assessment.value);
  function scoreText(v, max) {
    return v == null ? "Not scored" : `${v} / ${max}`;
  }
  function card(title, value, detail, index = 0) {
    const box = node("div", undefined, "pa-score");
    box.style.setProperty("--series-color", colors[index % colors.length]);
    const dd = node("dd");
    dd.append(node("strong", value), node("small", detail));
    box.append(node("dt", title), dd);
    return box;
  }
  function renderScores(group) {
    const latest = group.results.at(-1),
      previous = group.results.at(-2);
    const cards = group.metrics.map((metric, i) => {
      const value = latest.values[i],
        prior = previous?.values[i];
      let detail = "Score unavailable for the latest visit";
      if (value != null) {
        detail = "First recorded visit";
        if (previous) {
          detail =
            prior == null
              ? "Previous score unavailable"
              : value === prior
                ? "No change from previous visit"
                : `${value - prior > 0 ? "+" : "−"}${Math.abs(value - prior)} points from previous visit`;
        }
      }
      return card(metric.name, scoreText(value, metric.max), group.draftScores ? `Draft score — not clinically validated. ${detail}` : detail, i);
    });
    if (!cards.length)
      cards.push(
        card(
          "Latest responses",
          `${latest.answeredCount} / ${latest.questionCount}`,
          "Saved answers; no clinical score",
        ),
      );
    cards.push(
      card(
        "Completed visits",
        String(group.results.length),
        "For this assessment and selected period",
        1,
      ),
      card(
        "Latest elapsed time",
        duration(latest.elapsedSeconds),
        "From start to completion, including breaks",
        2,
      ),
    );
    find("scores").replaceChildren(...cards);
  }
  function renderHistory(group) {
    const header = node("tr");
    [
      "Visit",
      "Completed",
      "Mode",
      ...(group.scored ? group.metrics.map((m) => m.name) : ["Responses"]),
      "Report",
    ].forEach((t) => {
      const th = node("th", t);
      th.scope = "col";
      header.append(th);
    });
    const head = node("thead");
    head.append(header);
    const body = node("tbody");
    for (const [i, r] of group.results.entries()) {
      const tr = node("tr"),
        visit = node("th", String(i + 1));
      visit.scope = "row";
      tr.append(
        visit,
        node("td", date(r.completedAt)),
        node("td", modes[r.sessionMode] || "Not recorded"),
      );
      if (group.scored)
        r.values.forEach((v, j) =>
          tr.append(node("td", scoreText(v, group.metrics[j].max))),
        );
      else tr.append(node("td", `${r.answeredCount} / ${r.questionCount}`));
      const td = node("td"),
        link = node("a", "Open report");
      link.href = `/api/workspace/sessions/${encodeURIComponent(r.id)}/report`;
      link.target = "_blank";
      link.rel = "noopener";
      link.setAttribute("aria-label", `Open report for visit ${i + 1}`);
      td.append(link);
      tr.append(td);
      body.prepend(tr);
    }
    find("table").replaceChildren(head, body);
  }
  function renderVisit() {
    const group = selectedGroup(),
      r = group?.results.find((r) => r.id === find("visit").value);
    if (!r) return;
    const detail = find("details");
    detail.replaceChildren();
    const frame = node("iframe");
    frame.title = `Assessment report for visit completed ${date(r.completedAt)}`;
    frame.src = `/api/workspace/sessions/${encodeURIComponent(r.id)}/report`;
    frame.className = "pa-report-preview";
    frame.setAttribute("sandbox", "allow-same-origin allow-modals allow-downloads allow-scripts");
    detail.append(reportLinks(r.id), frame);
  }

  function drawTrend(group) {
    const width = plot.clientWidth;
    const height = plot.clientHeight;
    if (!width || !height) return;
    const pixelRatio = window.devicePixelRatio || 1;
    plot.width = Math.round(width * pixelRatio);
    plot.height = Math.round(height * pixelRatio);
    const ctx = plot.getContext("2d");
    ctx.scale(pixelRatio, pixelRatio);
    const { results, metrics } = trendData(group);
    const max = metrics[0].max;
    const min = metrics[0].min || 0;
    const left = 36;
    const right = width - 18;
    const top = 14;
    const bottom = height - 40;
    const x = (index) =>
      results.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / (results.length - 1);
    const y = (score) =>
      bottom - ((score - min) * (bottom - top)) / (max - min);

    ctx.font = "12px system-ui";
    ctx.fillStyle = "#52627a";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const tick of new Set(
      Array.from({ length: 5 }, (_, index) =>
        Math.round(min + ((max - min) * index) / 4),
      ),
    )) {
      ctx.strokeStyle = "#dbe5f2";
      ctx.beginPath();
      ctx.moveTo(left, y(tick));
      ctx.lineTo(right, y(tick));
      ctx.stroke();
      ctx.fillText(tick, left - 9, y(tick));
    }

    ctx.textAlign = "center";
    const labelCount = Math.min(
      results.length,
      Math.max(2, Math.floor((right - left) / 53)),
    );
    for (let label = 0; label < labelCount; label++) {
      const index =
        labelCount === 1
          ? 0
          : Math.round((label * (results.length - 1)) / (labelCount - 1));
      ctx.fillText(index + 1, x(index), bottom + 13);
    }
    ctx.fillText("Visit", (left + right) / 2, bottom + 30);

    metrics.forEach((_, series) => {
      ctx.strokeStyle = colors[series];
      ctx.fillStyle = colors[series];
      ctx.lineWidth = 2.4;
      ctx.setLineDash([[], [7, 4], [2, 3]][series]);
      ctx.beginPath();
      let connected = false;
      results.forEach(({ values }, index) => {
        const value = values[series];
        if (value === null) {
          connected = false;
        } else {
          if (connected) ctx.lineTo(x(index), y(value));
          else ctx.moveTo(x(index), y(value));
          connected = true;
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const markerStride = Math.max(1, Math.ceil(results.length / 60));
      results.forEach(({ values }, index) => {
        const value = values[series];
        if (
          value === null ||
          (index % markerStride !== 0 && index !== results.length - 1)
        )
          return;
        ctx.beginPath();
        ctx.arc(x(index), y(value), 3.3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  function renderGroup() {
    const group = selectedGroup();
    if (!group) return;
    find("completed").textContent =
      `${group.results.length} completed ${group.results.length === 1 ? "visit" : "visits"}`;
    renderScores(group);
    renderHistory(group);
    find("legend").replaceChildren(
      ...trendData(group).metrics.map((m, i) => {
        const item = node("span", m.name);
        item.style.setProperty("--series-color", colors[i]);
        return item;
      }),
    );
    const scored = group.scored && group.results.some((r) => r.values.some((v) => v !== null));
    const canChart = !group.scored || scored;
    plot.hidden = !canChart;
    find("trend-title").textContent = group.scored ? "Score trend" : "Response completion by visit";
    plot.setAttribute("aria-label", group.scored
      ? "Recorded scores by visit. Exact values are in Assessment history."
      : "Number of answered questions by visit. Exact counts are in Assessment history.");
    find("note").textContent = group.draftScores ? "Draft score — not clinically validated. Numeric changes do not establish clinical improvement." : !group.scored
      ? "Answered questions per completed visit. This shows response completion, not symptom severity."
      : !scored ? "No recorded scores available for these visits."
      : group.results.length === 1
        ? "One recorded visit. Complete another visit to compare scores."
        : "Recorded scores by visit; changes alone do not establish clinical improvement or deterioration.";
    if (canChart) drawTrend(group);
    const previous = find("visit").value;
    find("visit").replaceChildren(
      ...group.results
        .map(
          (r, i) => new Option(`Visit ${i + 1} · ${date(r.completedAt)}`, r.id),
        )
        .reverse(),
    );
    if (group.results.some((r) => r.id === previous))
      find("visit").value = previous;
    renderVisit();
  }
  function overview(data, completed) {
    const box = find("overview");
    box.replaceChildren();
    for (const [label, n, hint] of [
      [
        "Completed",
        completed,
        period === "all" ? "All time" : "Selected period",
      ],
      ["In progress", data.drafts, "All time"],
      ["Awaiting start", data.assigned, "All time"],
    ])
      box.append(card(label, String(n ?? 0), hint));
  }
  async function refresh() {
    if (!active || !patientId) return;
    request?.abort();
    const controller = new AbortController(),
      current = ++revision;
    request = controller;
    const selection = assessment.value;
    retry.disabled = true;
    status.textContent = content.hidden ? "Loading assessment history…" : "";
    try {
      const data = await api(
        `patients/${encodeURIComponent(patientId)}/analytics`,
        { signal: controller.signal },
      );
      if (!active || current !== revision) return;
      groups = data.groups
        .map((g) => ({
          ...g,
          results: g.results.filter(
            (r) =>
              period === "all" ||
              Date.now() - Date.parse(r.completedAt) <=
                Number(period) * 86400000,
          ),
        }))
        .filter((g) => g.results.length);
      renderPatientActivity(find("activity"), groups);
      overview(
        data,
        groups.reduce((n, g) => n + g.results.length, 0),
      );
      assessment.replaceChildren(
        ...groups.map(
          (g) =>
            new Option(
              `${g.title} · ${g.language.toUpperCase()} · ${g.version}${groups.filter((x) => x.formId === g.formId && x.language === g.language && x.version === g.version).length > 1 ? " · ending " + date(g.results.at(-1).completedAt) : ""}`,
              g.key,
            ),
        ),
      );
      const completedGroup =
        completion &&
        groups.find((g) => g.results.some((r) => r.id === completion));
      if (completedGroup) {
        assessment.value = completedGroup.key;
        find("visit").value = "";
        completion = null;
      } else if (groups.some((g) => g.key === selection))
        assessment.value = selection;
      content.hidden = !groups.length;
      status.textContent = groups.length
        ? "Updated just now · refreshes every 30 seconds while open."
        : "No completed assessments for this patient in the selected period.";
      if (groups.length) renderGroup();
    } catch (e) {
      if (!controller.signal.aborted && current === revision) {
        content.hidden = true;
        find("activity").hidden = true;
        status.textContent =
          "Could not load assessment history. Use Refresh history to try again.";
      }
    } finally {
      if (current === revision) retry.disabled = false;
    }
  }
  function hide() {
    active = false;
    revision++;
    request?.abort();
    clearInterval(timer);
    retry.disabled = false;
  }
  assessment.onchange = () => {
    find("visit").replaceChildren();
    renderGroup();
  };
  find("visit").onchange = renderVisit;
  retry.onclick = refresh;
  const observer = new ResizeObserver(() => {
    if (active && !plot.hidden && selectedGroup()) drawTrend(selectedGroup());
  });
  observer.observe(plot);
  const focus = () => {
    if (active) refresh();
  };
  window.addEventListener("focus", focus);
  return {
    show(id, { range = "all", sessionId = null } = {}) {
      const changed = id !== patientId;
      hide();
      patientId = id;
      period = range;
      active = true;
      completion = sessionId;
      if (changed) {
        groups = [];
        find("activity").replaceChildren();
        find("activity").hidden = true;
        assessment.replaceChildren();
        find("visit").replaceChildren();
        content.hidden = true;
        find("overview").replaceChildren();
      }
      if (!id) {
        content.hidden = true;
        find("overview").replaceChildren();
        status.textContent = "Choose a patient to view assessment history.";
        return;
      }
      refresh();
      timer = setInterval(() => {
        if (!document.hidden) refresh();
      }, 30000);
    },
    hide,
    refresh,
    destroy() {
      hide();
      observer.disconnect();
      window.removeEventListener("focus", focus);
    },
  };
}
