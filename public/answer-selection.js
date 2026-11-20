const minimumHighlightMs = 400;

export function answerSelection() {
  let selected = null;
  let highlight = null;

  return {
    show(button) {
      if (selected) return false;
      selected = button;
      button.classList.add('selected');
      button.setAttribute('aria-pressed', 'true');
      highlight = new Promise((resolve) => setTimeout(resolve, minimumHighlightMs));
      return true;
    },
    get visible() { return highlight; },
    clear() {
      if (!selected) return;
      selected.classList.remove('selected');
      selected.setAttribute('aria-pressed', 'false');
      selected = null;
      highlight = null;
    },
  };
}
