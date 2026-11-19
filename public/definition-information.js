const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
export function assessmentImages(form, questionId = null) {
  const area = el('div');
  for (const asset of (form.assets || []).filter(a => a.questionId === questionId)) {
    if (!/^\/api\/assessment-assets\/[a-f0-9]{64}\/[A-Za-z0-9_-]+$/.test(asset.url)) continue;
    const figure = el('figure'), image = el('img');
    image.src = asset.url; image.alt = asset.alt; image.loading = 'lazy'; image.style.maxWidth = '100%';
    figure.append(image);
    if (asset.caption) figure.append(el('figcaption', asset.caption));
    area.append(figure);
  }
  return area;
}
export function assessmentInformation(form) {
  const area = el('div'); area.className = 'assessment-information';
  if (form.description) area.append(el('p', form.description));
  const add = (title, text) => {
    if (!text) return;
    const details = el('details'), paragraph = el('p', text);
    paragraph.style.whiteSpace = 'pre-line';
    details.append(el('summary', title), paragraph); area.append(details);
  };
  add('Administration instructions', form.administration);
  const metadata = form.metadata || {};
  add('Assessment details', Object.entries(metadata).filter(([, v]) => v != null)
    .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
  for (const section of form.sections || []) add(section.title, section.text);
  for (const section of form.sourceGuidance || []) add(`${section.title} · Reference guidance, pending review`, section.text);
  for (const table of form.tables || []) {
    const rows = table.rows || table.data;
    if (Array.isArray(rows)) add(table.title || table.caption || 'Reference table', rows.map(row => Array.isArray(row) ? row.map(cell => typeof cell === 'string' ? cell : JSON.stringify(cell)).join(' | ') : JSON.stringify(row)).join('\n'));
  }
  add('Instrument references', form.references?.join('\n'));
  add('Review status', ['Draft definition; independent clinical review is pending.', ...(form.scoringLimitations || []), ...(form.remainingWork || [])].join('\n'));
  area.append(assessmentImages(form));
  return area;
}
