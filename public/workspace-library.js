import { $, el, api } from "./workspace-common.js";
let records = [],
  page = 0,
  detailVersion = 0;
const pageSize = 12;
function filtered() {
  const query = $("library-search").value.trim().toLowerCase(),
    category = $("library-category").value,
    filter = $("library-filter").value;
  return records.filter(
    (a) =>
      (!category || category === a.category) &&
      (filter === "all" || (filter === "preview" ? a.runnable : !a.runnable)) &&
      `${a.title} ${a.description} ${a.id}`.toLowerCase().includes(query),
  );
}
function choose(id) {
  window.dispatchEvent(
    new CustomEvent("choose-library-assessment", { detail: id }),
  );
}
function render() {
  const matches = filtered();
  page = Math.max(0, Math.min(page, Math.ceil(matches.length / pageSize) - 1));
  $("library-count").textContent =
    `${matches.length} of ${records.length} assessments`;
  $("library-list").replaceChildren();
  for (const a of matches.slice(page * pageSize, (page + 1) * pageSize)) {
    const card = el("article", undefined, "panel catalogue-card");
    card.append(
      el("span", a.category, "tag"),
      el("h3", a.title),
      el("p", a.description),
      el(
        "p",
        `${a.questionCount} questions · ${a.runnable ? "Available" : "Needs source review"}`,
        "muted-text",
      ),
    );
    const preview = el("button", "Preview questions", "button outline");
    preview.onclick = () => openDetail(a.id);
    const select = el("button", "Select for patient", "button primary");
    select.disabled = !a.runnable;
    select.onclick = () => choose(a.id);
    const actions = el("div", undefined, "report-actions");
    actions.append(preview, select);
    card.append(actions);
    $("library-list").append(card);
  }
  if (!matches.length)
    $("library-list").append(
      el(
        "p",
        "No matching assessments. Try a different category or search.",
        "empty-state",
      ),
    );
  $("library-page").textContent = matches.length
    ? `Page ${page + 1} of ${Math.ceil(matches.length / pageSize)}`
    : "No results";
  $("library-previous").disabled = page === 0;
  $("library-next").disabled = (page + 1) * pageSize >= matches.length;
}
async function openDetail(id) {
  const version = ++detailVersion,
    area = $("library-detail");
  area.hidden = false;
  area.replaceChildren(el("p", "Loading questionnaire…"));
  area.scrollIntoView({ block: "start", behavior: "smooth" });
  try {
    const d = await api(`catalogue/${encodeURIComponent(id)}`);
    if (version !== detailVersion) return;
    const close = el("button", "Close preview", "button outline");
    close.onclick = () => {
      detailVersion++;
      area.hidden = true;
    };
    area.replaceChildren(
      close,
      el("h2", d.title),
      el("p", d.instructions),
      el("p", d.referencePeriod || "Reference period not specified"),
    );
    if (!d.runnable) area.append(el("p", d.availabilityReason, "notice alert"));
    area.append(
      el("p", "Question preview only. No answers are recorded.", "notice"),
    );
    const list = el("ol", undefined, "catalogue-questions");
    for (const q of d.questions) {
      const item = el("li");
      item.append(el("strong", q.text));
      const opts = el("ul");
      q.options.forEach((o) => opts.append(el("li", o.label)));
      item.append(opts);
      list.append(item);
    }
    area.append(list);
    const select = el(
      "button",
      "Select this assessment for patient",
      "button primary",
    );
    select.disabled = !d.runnable;
    select.onclick = () => choose(id);
    area.append(select);
  } catch (e) {
    if (version === detailVersion)
      area.replaceChildren(el("p", e.message, "notice alert"));
  }
}
for (const id of ["library-search", "library-category", "library-filter"])
  $(id).addEventListener(id === "library-search" ? "input" : "change", () => {
    page = 0;
    render();
  });
$("library-previous").onclick = () => {
  page--;
  render();
};
$("library-next").onclick = () => {
  page++;
  render();
};
$("library-sessions").closest("section").hidden = true;
try {
  records = (await api("catalogue")).catalogue;
  [...new Set(records.map((a) => a.category))]
    .sort()
    .forEach((c) => $("library-category").add(new Option(c, c)));
  render();
} catch (e) {
  $("library-count").textContent = e.message;
}
