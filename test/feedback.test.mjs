import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedbackStore } from '../src/feedback.mjs';

const first = {
  sessionId: 'chat-a', answerId: 'a1', topic: 'refund.status', version: 'v1',
  question: '退款到哪了？', answer: '通常需要几个工作日。',
};

test('两步建议、重复投递和异步回答仍然对应同一份原答', (t) => {
  const store = new FeedbackStore(':memory:');
  t.after(() => store.close());
  const receive = (messageId, text, replyTo) => store.receive({ sessionId: first.sessionId, messageId, text, replyTo });
  store.recordAnswer(first);
  receive('vote', 'S2');
  const ask = receive('start', 's3');
  store.recordAnswer({ ...first, answerId: 'a2', version: 'v2', question: '怎么看进度？', answer: '打开进度页。' });
  const literal = '  我的建议\n- 先给查询入口\n- 再解释时效  ';
  assert.equal(receive('body', literal).answerId, 'a1');
  assert.deepEqual(receive('start', 's3'), ask);
  assert.equal(receive('body', literal).answerId, 'a1');
  store.recordAnswer(first); // A retry of the old completion must not move the menu back.
  assert.equal(receive('next', 's1').answerId, 'a2');
  receive('quoted-vote', 's2', 'a1');
  assert.equal(receive('extra', 's3 - 保留列表格式').answerId, 'a1');
  const [one, two] = [...store.samples({ topic: first.topic })];
  assert.equal(one.answer, first.answer);
  assert.equal(one.rating, 'bad');
  assert.deepEqual(one.suggestions.map((entry) => entry.text), [literal, '- 保留列表格式']);
  assert.equal(two.rating, 'good');
  assert.deepEqual(two.suggestions, []);
  assert.throws(() => receive('body', '同一消息 ID 的不同正文'), /messageId/);
});

test('问题和版本统计把未评价、仅建议、改评分计入各自的分母', (t) => {
  const store = new FeedbackStore(':memory:');
  t.after(() => store.close());
  for (const id of ['a1', 'a2', 'a3', 'a4']) store.recordAnswer({ ...first, answerId: id });
  store.recordAnswer({ ...first, answerId: 'v2-only', version: 'v2' });
  const receive = (id, text, replyTo) => store.receive({ sessionId: first.sessionId, messageId: id, text, replyTo });
  receive('vote-1', 's2', 'a1');
  receive('update', 's1', 'a1');
  receive('vote-2', 's2', 'a2');
  receive('note-2', 'S3，先给入口', 'a2');
  receive('note-3', 's3 说得更简短些', 'a3');
  const [v1, v2] = store.stats({ topic: first.topic });
  assert.deepEqual({ ...v1 }, {
    topic: first.topic, version: 'v1', answers: 4, rated: 2, good: 1, bad: 1, suggested: 2, withFeedback: 3, badRate: 0.5,
  });
  assert.equal(v2.badRate, null);
  assert.equal(v2.withFeedback, 0);
});

test('普通消息继续交给客服，引用和填写状态受会话约束', (t) => {
  const store = new FeedbackStore(':memory:');
  t.after(() => store.close());
  store.recordAnswer(first);
  const receive = (sessionId, messageId, text, replyTo) => store.receive({ sessionId, messageId, text, replyTo });
  assert.equal(receive('chat-b', '1', 's2', 'a1').handled, false);
  assert.equal(receive('chat-a', '1', 'S3存储桶如何计费？').handled, false);
  assert.equal(receive('chat-a', '2', 's2').handled, false);
  assert.equal(receive('chat-a', '3', 's3', 'a1').action, 'ask');
  assert.equal(receive('chat-b', '2', '普通问题').handled, false);
  assert.equal(receive('chat-a', '4', '/cancel').action, 'cancel');
  assert.equal(receive('chat-a', '5', '2').handled, false);
  const [sample] = [...store.samples()];
  assert.equal(sample.rating, null);
  assert.deepEqual(sample.suggestions, []);
});
