const form = document.querySelector('#recommend-form');
const output = document.querySelector('#recommend-output');

const availability = {
  available: 'Available to prescribe',
  not_implemented: 'Questionnaire not implemented here',
  separate_prototype: 'DASS-21 is not available for prescription here',
  requires_trauma_review: 'Review trauma exposure first',
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = {
    ageGroup: document.querySelector('#age-group').value,
    concerns: [...form.querySelectorAll('input[name="concern"]:checked')].map((input) => input.value),
    traumaExposure: document.querySelector('#trauma-exposure').value,
    safetyStatus: document.querySelector('#safety-status').value,
  };
  output.replaceChildren();
  try {
    const response = await fetch('/api/recommendations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(context),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not prepare suggestions.');
    const message = document.createElement('p');
    message.className = result.status === 'safety_review' ? 'recommend-alert' : 'recommend-info';
    message.textContent = result.message;
    output.append(message);
    for (const item of result.recommendations) {
      const card = document.createElement('article'); card.className = 'recommend-result';
      const title = document.createElement('h3'); title.textContent = item.title;
      const tag = document.createElement('span'); tag.className = 'recommend-tag'; tag.textContent = availability[item.availability];
      const reason = document.createElement('p'); reason.textContent = item.reason;
      const note = document.createElement('small'); note.textContent = item.note || '';
      const source = document.createElement('a'); source.href = item.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Clinical source';
      card.append(title, tag, reason);
      if (item.note) card.append(note);
      card.append(source);
      if (item.id === 'phq9') {
        const link = document.createElement('p'); const anchor = document.createElement('a');
        anchor.href = '/'; anchor.textContent = 'Open assessments'; link.append(anchor); card.append(link);
      } else if (item.id === 'dass21') {
        const link = document.createElement('p'); const anchor = document.createElement('a');
        anchor.href = 'http://127.0.0.1:4173'; anchor.textContent = 'Open DASS-21 assessment (if available)'; link.append(anchor); card.append(link);
      }
      output.append(card);
    }
  } catch (error) { const message = document.createElement('p'); message.className = 'recommend-alert'; message.textContent = error.message; output.append(message); }
});
