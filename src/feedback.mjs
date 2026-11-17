import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FEEDBACK_MENU, replyResult, shortcut } from './protocol.mjs';

export { FEEDBACK_MENU };
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a nonempty string');
  return value;
}

function filterAnswers({ topic, version } = {}) {
  const terms = [];
  const args = [];
  for (const [name, value] of Object.entries({ topic, version })) {
    if (value === undefined) continue;
    terms.push('a.' + name + ' = ?');
    args.push(required(value, name));
  }
  return { where: terms.length ? 'WHERE ' + terms.join(' AND ') : '', args };
}

function interpret(text, current, pending) {
  if (!text.trim()) return { action: 'pass' };
  if (pending !== null) {
    if (text.trim() === '/cancel') return { action: 'cancel', target: pending };
    return { action: 'suggestion', target: pending, suggestion: text };
  }
  const choice = current === null ? null : shortcut(text);
  return choice ? { ...choice, target: current } : { action: 'pass' };
}

export class FeedbackStore {
  #db;

  constructor(path = process.env.SIBYL_FEEDBACK_DB || join(homedir(), '.sibyl-feedback', 'feedback.sqlite3')) {
    required(path, 'database path');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
      this.#write(() => this.#db.exec(schema));
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  close() { this.#db.close(); }

  #write(work) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  recordAnswer({ sessionId, answerId, question, answer, topic, version = 'unversioned' }) {
    required(sessionId, 'sessionId');
    required(answerId, 'answerId');
    required(question, 'question');
    required(answer, 'answer');
    if (topic === undefined) topic = question.trim();
    required(topic, 'topic');
    required(version, 'version');
    return this.#write(() => {
      const old = this.#db.prepare(
        'SELECT question, answer, topic, version FROM answers WHERE session_id = ? AND answer_id = ?'
      ).get(sessionId, answerId);
      if (old) {
        if (old.question !== question || old.answer !== answer || old.topic !== topic || old.version !== version) {
          throw new Error('answerId already belongs to a different answer in this session');
        }
      } else {
        const saved = this.#db.prepare(`
          INSERT INTO answers (session_id, answer_id, question, answer, topic, version)
          VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, answerId, question, answer, topic, version);
        this.#db.prepare(`
          INSERT INTO sessions (session_id, current_id) VALUES (?, ?)
          ON CONFLICT (session_id) DO UPDATE SET current_id = excluded.current_id`).run(sessionId, saved.lastInsertRowid);
      }
      return { answerId, text: answer + '\n\n' + FEEDBACK_MENU };
    });
  }

  receive({ sessionId, messageId, text, replyTo = null }) {
    required(sessionId, 'sessionId');
    required(messageId, 'messageId');
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (replyTo !== null) required(replyTo, 'replyTo');
    const fingerprint = createHash('sha256').update(JSON.stringify([replyTo, text])).digest('hex');
    return this.#write(() => {
      const previous = this.#db.prepare(`
        SELECT r.action, r.fingerprint, a.answer_id FROM replies r
        LEFT JOIN answers a ON a.id = r.answer_row
        WHERE r.session_id = ? AND r.message_id = ?`).get(sessionId, messageId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('messageId was reused with different input');
        return replyResult(previous.action, previous.answer_id);
      }

      const session = this.#db.prepare('SELECT current_id, pending_id FROM sessions WHERE session_id = ?').get(sessionId);
      const current = replyTo === null ? session?.current_id ?? null : this.#db.prepare(
        'SELECT id FROM answers WHERE session_id = ? AND answer_id = ?'
      ).get(sessionId, replyTo)?.id ?? null;
      const pending = replyTo === null || current === session?.pending_id ? session?.pending_id ?? null : null;
      const event = interpret(text, current, pending);

      if (replyTo !== null && event.target !== undefined) {
        // An explicit selection moves the conversation to this answer. A later
        // unquoted “s3 ...” after a quoted “s2” belongs to the same answer.
        this.#db.prepare('UPDATE sessions SET current_id = ?, pending_id = NULL WHERE session_id = ?')
          .run(event.target, sessionId);
      }
      if (event.action === 'pass' && text.trim() && current !== null) {
        // A new support question ends the previous unthreaded feedback menu.
        this.#db.prepare('UPDATE sessions SET current_id = NULL WHERE session_id = ? AND current_id = ?')
          .run(sessionId, current);
      } else if (event.action === 'good' || event.action === 'bad') {
        this.#db.prepare('UPDATE answers SET rating = ? WHERE id = ?').run(event.action, event.target);
      } else if (event.action === 'ask') {
        this.#db.prepare('UPDATE sessions SET pending_id = ? WHERE session_id = ?').run(event.target, sessionId);
      } else if (event.action === 'suggestion' || event.action === 'cancel') {
        this.#db.prepare('UPDATE sessions SET pending_id = NULL WHERE session_id = ? AND pending_id = ?')
          .run(sessionId, event.target);
      }

      this.#db.prepare(`
        INSERT INTO replies (session_id, message_id, fingerprint, answer_row, action, suggestion)
        VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, messageId, fingerprint, event.target ?? null, event.action, event.suggestion ?? null);
      const target = event.target == null ? null : this.#db.prepare('SELECT answer_id FROM answers WHERE id = ?').get(event.target);
      return replyResult(event.action, target?.answer_id);
    });
  }

  stats(filters = {}) {
    const { where, args } = filterAnswers(filters);
    return this.#db.prepare(`
      WITH per_answer AS (
        SELECT a.topic, a.version, a.rating,
          EXISTS(SELECT 1 FROM replies r WHERE r.answer_row = a.id AND r.action = 'suggestion') AS suggested
        FROM answers a ${where}
      )
      SELECT topic, version, COUNT(*) AS answers, COUNT(rating) AS rated,
        COUNT(CASE WHEN rating = 'good' THEN 1 END) AS good,
        COUNT(CASE WHEN rating = 'bad' THEN 1 END) AS bad,
        SUM(suggested) AS suggested, SUM(rating IS NOT NULL OR suggested) AS withFeedback,
        ROUND(1.0 * COUNT(CASE WHEN rating = 'bad' THEN 1 END) / NULLIF(COUNT(rating), 0), 4) AS badRate
      FROM per_answer GROUP BY topic, version ORDER BY topic, version`).all(...args);
  }

  *samples(filters = {}) {
    const { where, args } = filterAnswers(filters);
    const rows = this.#db.prepare(`
      SELECT a.session_id AS sessionId, a.answer_id AS answerId, a.topic, a.version,
        a.question, a.answer, a.rating, a.created_at AS createdAt,
        (SELECT json_group_array(json_object('text', r.suggestion, 'at', r.created_at) ORDER BY r.id)
         FROM replies r WHERE r.answer_row = a.id AND r.action = 'suggestion') AS suggestions
      FROM answers a ${where} ORDER BY a.id`).iterate(...args);
    for (const row of rows) yield { ...row, suggestions: JSON.parse(row.suggestions) };
  }
}
