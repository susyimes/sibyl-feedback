CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    answer_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    version TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    rating TEXT CHECK (rating IN ('good', 'bad')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (session_id, answer_id)
);
CREATE INDEX IF NOT EXISTS answers_topic_version ON answers (topic, version);

-- A two-message suggestion stays attached to the answer on which it was opened.
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    current_id INTEGER REFERENCES answers(id),
    pending_id INTEGER REFERENCES answers(id)
);

-- The host message ID makes retried deliveries replay their original result.
-- Only suggestions store the customer's message body here.
CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    answer_row INTEGER REFERENCES answers(id),
    action TEXT NOT NULL CHECK (action IN ('pass', 'good', 'bad', 'ask', 'suggestion', 'cancel')),
    suggestion TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (session_id, message_id)
);
CREATE INDEX IF NOT EXISTS replies_suggestions ON replies (answer_row, id) WHERE action = 'suggestion';
