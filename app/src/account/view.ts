// What the TMDB account screen says in each state, as plain text and buttons, so the tests can check every word without a
// page (tests/account-flow.test.mjs: no token in any of it). The words are the Android launcher's sign-in screen's.
// The QR holds the approve link, whose request token is the one thing the person needs; it is never written out.

import { type AccountState } from './account';

export type ActionId = 'start' | 'retry' | 'signOut' | 'confirmSignOut' | 'keepSignedIn';

export interface View {
  heading: string;
  lines: string[];
  /** The link for the QR code, or null. */
  qr: string | null;
  /** The short address shown beside the QR. */
  address: string;
  buttons: { id: ActionId; label: string }[];
}

const minutes = (ms: number) => {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? 'less than a minute' : `${m} minutes`;
};

export function view(s: AccountState, confirmingSignOut = false): View {
  const v: View = { heading: 'TMDB account', lines: [], qr: null, address: '', buttons: [] };
  const local = 'Not signed in: My list, Favorites and Seen are kept on this TV only.';
  if (s.phase === 'signedIn') {
    if (confirmingSignOut) {
      v.heading = 'Sign out of TMDB?';
      v.lines.push('My list, Favorites and Seen stay on this TV, and stop following the account.');
      v.buttons.push({ id: 'confirmSignOut', label: 'Sign out' }, { id: 'keepSignedIn', label: 'Stay signed in' });
      return v;
    }
    v.heading = 'Signed in to TMDB';
    v.lines.push(s.username ? `As ${s.username}.` : 'Signed in.');
    v.lines.push('My list, Favorites and Seen follow the account: changes made here go to TMDB, and TMDB’s come here.');
    v.lines.push(s.syncing ? 'Syncing…' : s.lastSync);
    if (s.queued > 0) v.lines.push(s.queued === 1 ? '1 change waits to go up.' : `${s.queued} changes wait to go up.`);
    v.buttons.push({ id: 'signOut', label: 'Sign out' });
    return v;
  }
  if (s.needsToken) {
    v.heading = 'Sign in with your phone';
    v.lines.push('Signing in needs TMDB’s API Read Access Token (the long key) on the API keys page, not the short API key.');
    v.lines.push(local);
    return v;
  }
  switch (s.phase) {
    case 'requesting':
      v.heading = 'Sign in with your phone';
      v.lines.push('Getting a code from TMDB…');
      break;
    case 'waiting':
      v.heading = 'Sign in with your phone';
      v.qr = s.approveUrl;
      v.address = s.approveShort;
      v.lines.push('Scan the code with your phone, sign in to TMDB there and approve this TV.');
      v.lines.push('The link is too long to type; use the camera.');
      v.lines.push(`The code works for ${minutes(s.remaining)} more.`);
      v.buttons.push({ id: 'start', label: 'New code' });
      break;
    case 'finishing':
      v.heading = 'Approved on your phone';
      v.lines.push('Signing in…');
      break;
    case 'expired':
      v.heading = 'That code has expired';
      v.lines.push('Codes last 15 minutes. Nothing changed on this TV; get a new code and scan again.');
      v.buttons.push({ id: 'start', label: 'New code' });
      break;
    case 'failed':
      v.heading = 'Sign in with your phone';
      v.lines.push(
        s.failure === 'retry'
          ? 'Can’t reach TMDB. Check the internet connection and try again.'
          : s.failure === 'rejected'
            ? 'TMDB didn’t sign this TV in: the code wasn’t approved, or TMDB refused it. Try again with a new code.'
            : 'TMDB didn’t sign this TV in. Try again with a new code.',
      );
      v.buttons.push({ id: 'retry', label: 'Try again' });
      break;
    default:
      v.heading = 'Sign in with your phone';
      v.lines.push('Sign in to your TMDB account so My list, Favorites and Seen follow it, on this TV and on themoviedb.org.');
      v.lines.push(s.follows ? 'Signed out: the lists stay on this TV, and changes wait for the next sign-in.' : local);
      v.buttons.push({ id: 'start', label: 'Sign in' });
  }
  return v;
}
