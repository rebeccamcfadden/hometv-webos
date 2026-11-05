// The signed-in TMDB account, kept on the TV only (the Android launcher's TmdbSession and TmdbSessionStore): the v4 access
// token, the account's v4 id, the v3 session id, the v3 account number and the name shown. Saved in the page's own
// storage under one key, never logged, never shown, never sent anywhere but TMDB. Signing out clears it. Pure, tested.

export interface Session {
  accessToken: string;
  accountObjectId: string;
  sessionId: string;
  accountId: number;
  username: string;
}

/** The storage the session lives in: the page's localStorage on a TV, a Map in the tests. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_KEY = 'hometv-tmdb-account-v1';

/** Whether a session has everything the account calls need. */
export const complete = (s: Session | null | undefined): s is Session =>
  !!s && !!s.accessToken && !!s.accountObjectId && !!s.sessionId && typeof s.accountId === 'number' && s.accountId > 0;

export class SessionStore {
  constructor(private readonly kv: KeyValue | null) {}

  load(): Session | null {
    try {
      const raw = this.kv && this.kv.getItem(SESSION_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      const s: Session = {
        accessToken: str(o.accessToken),
        accountObjectId: str(o.accountObjectId),
        sessionId: str(o.sessionId),
        accountId: typeof o.accountId === 'number' ? o.accountId : 0,
        username: str(o.username),
      };
      return complete(s) ? s : null;
    } catch (e) {
      return null;
    }
  }

  save(s: Session): void {
    if (!complete(s) || !this.kv) return;
    try {
      this.kv.setItem(SESSION_KEY, JSON.stringify({ accessToken: s.accessToken, accountObjectId: s.accountObjectId, sessionId: s.sessionId, accountId: s.accountId, username: s.username }));
    } catch (e) {
      // Storage full or blocked: the account works until the app restarts.
    }
  }

  clear(): void {
    try {
      if (this.kv) this.kv.removeItem(SESSION_KEY);
    } catch (e) {
      // Nothing to clear.
    }
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
