import { Store } from "express-session";
import type { SessionData } from "express-session";
import type { Database } from "better-sqlite3";

type Callback = (err?: unknown) => void;
type GetCallback = (err: unknown, session?: SessionData | null) => void;

// express-session Store backed by the `sessions` table in the same
// better-sqlite3 file as the rest of the app's data, so logins survive
// process restarts/redeploys without a separate session store dependency.
export class SqliteSessionStore extends Store {
  #db: Database;

  constructor(db: Database) {
    super();
    this.#db = db;
  }

  get(sid: string, callback: GetCallback): void {
    try {
      const row = this.#db
        .prepare<[string], { sess: string; expires: number }>(
          "SELECT sess, expires FROM sessions WHERE sid = ?",
        )
        .get(sid);
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expires < Date.now()) {
        this.#db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.sess) as SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, session: SessionData, callback?: Callback): void {
    try {
      const expires = session.cookie.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24;
      this.#db
        .prepare(
          `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        )
        .run(sid, JSON.stringify(session), expires);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: Callback): void {
    try {
      this.#db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, session: SessionData, callback?: Callback): void {
    try {
      const expires = session.cookie.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24;
      this.#db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?").run(expires, sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
