import { classifyReply } from '../vendor/sibyl-reply.mjs';

const choices = [
  { label: 's1', text: '答得好' },
  { label: 's2', text: '答得差' },
  { label: 's3', text: '我希望你这样答' },
];

export const FEEDBACK_MENU = choices.map(({ label, text }) => {
  const hint = label === 's3' ? '（直接发 s3 加建议，或先发 s3 再写）' : '';
  return label + '. ' + text + hint;
}).join('\n\n');

// Only explicit shortcuts consume a chat message. Sibyl also recognises a choice
// typed out in full, which in a support conversation may be an ordinary message.
export function shortcut(text) {
  if (!/^\s*s[123]/i.test(text)) return null;
  const result = classifyReply(text, choices);
  if (!result.label || result.typed) return null;
  if (result.kind === 'pick') {
    return { action: { s1: 'good', s2: 'bad', s3: 'ask' }[result.label] };
  }
  if (result.label !== 's3') return null;
  const tail = text.trimStart().slice(2);
  // Require a separator so product names like “S3存储桶” pass through. Preserve a
  // leading list marker or quote in the actual suggestion after that separator.
  const separator = /^(?:[,，、:：.。;；!！-][ \t]?|\r\n|\s)/u.exec(tail);
  if (!separator) return null;
  return { action: 'suggestion', suggestion: tail.slice(separator[0].length) };
}

const acknowledgements = {
  good: '已记下好评。',
  bad: '已记下差评。',
  ask: '请直接发你希望的回答或改进建议。发 /cancel 可以取消。',
  suggestion: '已记下你的建议。',
  cancel: '已取消填写建议。',
};

export function replyResult(action, answerId) {
  if (action === 'pass') return { handled: false, action };
  return { handled: true, action, answerId, reply: acknowledgements[action] };
}
