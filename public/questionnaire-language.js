export async function fetchQuestionnaire(path, language) {
  const url = new URL(path, location.href);
  url.searchParams.set('language', language);
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load the questionnaire.');
  return result;
}

export function questionnaireLanguage(select, { load, note }) {
  let current = 'en';
  let machineTranslated = false;
  let pending = false;
  select.disabled = true;

  function restore() {
    pending = false;
    select.disabled = false;
    select.value = current;
    note.textContent = machineTranslated ? 'Questionnaire text is machine translated.' : '';
  }

  function accept(form) {
    current = form.language;
    machineTranslated = Boolean(form.machineTranslated);
    restore();
    const url = new URL(location.href);
    if (current === 'en') url.searchParams.delete('language');
    else url.searchParams.set('language', current);
    history.replaceState({}, '', url);
  }

  function fail(message) {
    restore();
    note.textContent = message;
  }

  async function change(code) {
    if (pending || code === current) return;
    pending = true;
    select.disabled = true;
    note.textContent = 'Loading questionnaire…';
    try {
      const form = await load(code);
      if (form) accept(form);
    } catch (error) { fail(error.message); }
  }

  select.addEventListener('change', () => change(select.value));
  return { accept, change, fail, restore, get code() { return current; }, get pending() { return pending; } };
}
