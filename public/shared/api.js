export const $ = (id) => document.getElementById(id);
export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export async function api(path, options = {}) {
  const response = await fetch("/api/workspace/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export const date = (value) => new Date(value).toLocaleString();
export function reportLinks(id) {
  const box = el("div", undefined, "report-actions");
  for (const [title, suffix] of [
    ["View / print report", ""],
    ["Download PDF", "?format=pdf"],
  ]) {
    const a = el("a", title, "button outline");
    a.href = `/api/workspace/sessions/${encodeURIComponent(id)}/report${suffix}`;
    if (!suffix) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    box.append(a);
  }
  return box;
}
