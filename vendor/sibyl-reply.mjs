// From susyimes/sibyl, evolve/learn_core.mjs at 2f6fb986d143dfb78b1f9c82733adc05d1d167fe. MIT, see ../LICENSE.
const norm = (s) => String(s).toLowerCase().replace(/[\s"'`“”‘’「」『』。，,.!！?？;；:：、()（）]+/g, '');

/** What kind of reply the user gave to a set of suggestions (evolve/SPEC.md §4). */
export function classifyReply(prompt, suggestions) {
  const p = String(prompt ?? '').trim();
  const m = /^s([1-9])(?![0-9a-z])\s*[,，、:：.。;；!！-]?\s*([\s\S]*)$/i.exec(p);
  if (m && suggestions.some((s) => s.label === `s${m[1]}`)) {
    const extra = m[2].trim();
    return extra ? { kind: 'pick_plus', label: `s${m[1]}`, extra } : { kind: 'pick', label: `s${m[1]}` };
  }
  const same = suggestions.find((s) => norm(s.text) && norm(s.text) === norm(p));
  if (same) return { kind: 'pick', label: same.label, typed: true };
  if (/^\d+(?!\d)/.test(p)) return { kind: 'own_option' };
  return { kind: 'other' };
}
