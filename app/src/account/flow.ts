// Signing the TV in to a TMDB account (the Android launcher's SignInFlow), as a state machine that makes no calls itself:
// the driver (account.ts) asks `due(now, visible)` for the next call, sends it, and hands back the reply or the error.
//
// TMDB's v4 sign-in: the TV gets a request token, shows a QR code of the approve page, and polls for the access token
// every few seconds while the code shows, until the person approves it on their phone; then the access token becomes a
// v3 session and the account's number and name are read. Codes last 15 minutes. Polling only happens while the screen
// is visible; the last two steps finish even when it isn't, so an approved sign-in is never thrown away.
//
// Nothing here logs or shows a token. Pure, tested with a fake clock (tests/account-flow.test.mjs).

import * as api from './api';
import { type Call, type Reply } from './api';
import { type Access, type Problem, Failure } from './parse';
import * as parse from './parse';
import { type Session, complete } from './session';

export type Phase = 'signedOut' | 'requesting' | 'waiting' | 'finishing' | 'signedIn' | 'expired' | 'failed';

/** How long a request token can be approved, by TMDB. */
export const TOKEN_LIFETIME = 15 * 60_000;
/** How often the TV asks whether the code is approved yet. */
export const POLL = 5_000;
/** The longest wait between tries after a network failure. */
export const RETRY_MAX = 60_000;
export const MAX_RETRIES_REQUESTING = 2;
export const MAX_RETRIES = 5;

export class SignInFlow {
  private ph: Phase;
  private requestToken: string | null = null;
  private approve: string | null = null;
  private expiresAt = 0;
  private access: Access | null = null;
  private sessionId: string | null = null;
  private sess: Session | null = null;
  private next = 0;
  private backoff = 0;
  private retries = 0;
  private inFlight: Call | null = null;
  private problem: Problem | null = null;

  constructor(saved: Session | null) {
    if (saved && complete(saved)) {
      this.sess = saved;
      this.ph = 'signedIn';
    } else {
      this.ph = 'signedOut';
    }
  }

  phase(): Phase {
    return this.ph;
  }
  /** The page the QR code opens, while waiting for approval. */
  approveUrl(): string | null {
    return this.ph === 'waiting' ? this.approve : null;
  }
  /** How long the code shown has left. */
  remaining(now: number): number {
    return this.ph === 'waiting' ? Math.max(0, this.expiresAt - now) : 0;
  }
  session(): Session | null {
    return this.ph === 'signedIn' ? this.sess : null;
  }
  failure(): Problem | null {
    return this.ph === 'failed' ? this.problem : null;
  }
  /** Whether calls go on while the screen is hidden: only the last steps, after the person approved. */
  runsHidden(): boolean {
    return this.ph === 'finishing';
  }

  /** Asks TMDB for a new code. */
  start(now: number): void {
    if (this.ph !== 'signedOut' && this.ph !== 'expired' && this.ph !== 'failed') return;
    this.clearAttempt();
    this.ph = 'requesting';
    this.next = now;
  }

  /** Back, while a code shows or after it failed: nothing was signed in. An approved sign-in is let finish. */
  cancel(): void {
    if (this.ph === 'requesting' || this.ph === 'waiting' || this.ph === 'expired' || this.ph === 'failed') {
      this.clearAttempt();
      this.ph = 'signedOut';
    }
  }

  /** Forgets the account; returns the calls that revoke its token and session on TMDB, best-effort. */
  signOut(): Call[] {
    const calls: Call[] = [];
    if (this.sess) {
      calls.push(api.logout(this.sess.accessToken));
      calls.push(api.deleteSession(this.sess.sessionId));
    }
    this.sess = null;
    this.clearAttempt();
    this.ph = 'signedOut';
    return calls;
  }

  /** The call to make now, or null. A code that ran out turns the flow to expired. */
  due(now: number, visible: boolean): Call | null {
    if (this.ph === 'waiting' && now >= this.expiresAt) {
      this.ph = 'expired';
      this.requestToken = null;
      this.approve = null;
      return null;
    }
    if (this.inFlight || now < this.next) return null;
    if (!visible && !this.runsHidden()) return null;
    let c: Call;
    switch (this.ph) {
      case 'requesting':
        c = api.requestToken();
        break;
      case 'waiting':
        c = api.accessToken(this.requestToken as string);
        break;
      case 'finishing':
        c = this.sessionId == null ? api.session((this.access as Access).accessToken) : api.account(this.sessionId);
        break;
      default:
        return null;
    }
    this.inFlight = c;
    return c;
  }

  /** When `due` next has something to do (or a code runs out); Infinity for never. */
  nextAt(): number {
    if (this.inFlight) return Infinity;
    switch (this.ph) {
      case 'requesting':
      case 'finishing':
        return this.next;
      case 'waiting':
        return Math.min(this.next, this.expiresAt);
      default:
        return Infinity;
    }
  }

  onReply(c: Call, reply: Reply, now: number): void {
    if (!c || c !== this.inFlight) return;
    this.inFlight = null;
    try {
      switch (this.ph) {
        case 'requesting':
          this.requestToken = parse.requestToken(reply);
          this.approve = api.approveUrl(this.requestToken);
          this.expiresAt = now + TOKEN_LIFETIME;
          this.ph = 'waiting';
          this.succeeded(now + POLL);
          break;
        case 'waiting':
          this.access = parse.access(reply);
          this.requestToken = null;
          this.approve = null;
          this.ph = 'finishing';
          this.succeeded(now);
          break;
        case 'finishing':
          if (this.sessionId == null) {
            this.sessionId = parse.sessionId(reply);
            this.succeeded(now);
          } else {
            const a = parse.account(reply);
            const access = this.access as Access;
            this.sess = { accessToken: access.accessToken, accountObjectId: access.accountObjectId, sessionId: this.sessionId, accountId: a.id, username: a.username };
            this.clearAttempt();
            this.ph = 'signedIn';
          }
          break;
        default:
          break;
      }
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      this.fail(e.problem, now);
    }
  }

  /** No answer at all (the network). */
  onError(c: Call, now: number): void {
    if (!c || c !== this.inFlight) return;
    this.inFlight = null;
    this.fail('retry', now);
  }

  private fail(problem: Problem, now: number): void {
    if (this.ph === 'waiting' && problem === 'notApproved') {
      this.succeeded(now + POLL);
      return;
    }
    const max = this.ph === 'requesting' ? MAX_RETRIES_REQUESTING : MAX_RETRIES;
    if (problem === 'retry' && (this.ph === 'waiting' || ++this.retries <= max)) {
      this.backoff = this.backoff === 0 ? POLL : Math.min(this.backoff * 2, RETRY_MAX);
      this.next = now + this.backoff;
      return;
    }
    if (problem === 'expired' && (this.ph === 'waiting' || this.ph === 'finishing')) {
      this.clearAttempt();
      this.ph = 'expired';
      return;
    }
    this.clearAttempt();
    this.problem = problem;
    this.ph = 'failed';
  }

  private succeeded(next: number): void {
    this.next = next;
    this.backoff = 0;
    this.retries = 0;
  }

  private clearAttempt(): void {
    this.requestToken = null;
    this.approve = null;
    this.expiresAt = 0;
    this.access = null;
    this.sessionId = null;
    this.next = 0;
    this.backoff = 0;
    this.retries = 0;
    this.inFlight = null;
    this.problem = null;
  }
}
