// A pretend LG TV page for the loader tests: runs the app's shell (app/loader/boot.js, update.js, TweetNaCl) in a fresh
// vm context per "start" of the app, with a tiny fake DOM, fake timers, a fake XMLHttpRequest, Blob and blob: URLs,
// and a fake IndexedDB (only what boot.js uses: open, transaction, get, put, a cursor). localStorage and the
// IndexedDB files survive from one start to the next, as on a TV. After hometv-tizen's tests/fake-browser.mjs.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where a Developer Mode app's page lives on a webOS TV. */
export const SHELL_BASE = 'file:///media/developer/apps/usr/palm/applications/com.hometv.app/';

export const SHELL_SCRIPTS = {
  'boot.js': fs.readFileSync(path.join(root, 'app', 'loader', 'boot.js'), 'utf8'),
  'update.js': fs.readFileSync(path.join(root, 'app', 'loader', 'update.js'), 'utf8'),
  'nacl-fast.min.js': fs.readFileSync(path.join(root, 'vendor', 'tweetnacl', 'nacl-fast.min.js'), 'utf8'),
};

class FakeElement {
  constructor(tag, page) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.page = page;
    this._html = '';
  }
  get firstChild() {
    return this.children[0] || null;
  }
  appendChild(child) {
    return this.insertBefore(child, null);
  }
  insertBefore(child, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    child.parentNode = this;
    this.page.connected(child);
    return child;
  }
  set innerHTML(html) {
    this._html = html;
    this.children = [];
  }
  get innerHTML() {
    return this._html;
  }
}

/**
 * The page's IndexedDB: `tv.files` (Map key -> Buffer) is what's stored. `tv.idb` changes how it behaves:
 * { missing: true } (no indexedDB at all), { hang: true } (open never answers), { failOpen: true }, { quota: bytes }.
 */
function fakeIndexedDb(tv, defer, calls) {
  const opt = tv.idb || {};
  if (opt.missing) return undefined;
  const size = () => [...tv.files.values()].reduce((n, b) => n + b.length, 0);

  function transaction(mode) {
    let pending = 0;
    let failed = null;
    let finished = false;
    const t = { error: null, oncomplete: null, onerror: null, onabort: null };
    const settle = () => {
      if (pending || finished) return;
      defer(() => {
        if (pending || finished) return;
        finished = true;
        if (failed) {
          t.error = failed;
          if (t.onerror) t.onerror({ type: 'error' });
          if (t.onabort) t.onabort({ type: 'abort' });
        } else if (t.oncomplete) t.oncomplete({ type: 'complete' });
      });
    };
    const request = (fn) => {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      pending++;
      defer(() => {
        pending--;
        if (failed) return settle();
        try {
          req.result = fn();
          if (req.onsuccess) req.onsuccess({ type: 'success' });
        } catch (e) {
          req.error = failed = e;
          if (req.onerror) req.onerror({ type: 'error' });
        }
        settle();
      });
      return req;
    };
    const writable = () => {
      if (mode !== 'readwrite') throw Object.assign(new Error('ReadOnlyError'), { name: 'ReadOnlyError' });
    };
    // A transaction with no request still completes.
    defer(settle);
    t.objectStore = () => ({
      get: (key) => request(() => {
        calls.push(['get', key]);
        const b = tv.files.get(key);
        return b ? Uint8Array.from(b).buffer : undefined;
      }),
      put: (value, key) => {
        writable();
        return request(() => {
          calls.push(['put', key]);
          const b = Buffer.from(new Uint8Array(value));
          if (opt.quota != null && size() + b.length > opt.quota) {
            throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
          }
          tv.files.set(key, b);
          return key;
        });
      },
      openCursor: () => {
        const keys = [...tv.files.keys()].sort();
        let i = 0;
        const req = { result: null, onsuccess: null, onerror: null };
        const step = () => {
          pending++;
          defer(() => {
            pending--;
            const key = keys[i];
            req.result =
              key === undefined
                ? null
                : {
                    key,
                    delete: () => {
                      writable();
                      calls.push(['delete', key]);
                      tv.files.delete(key);
                    },
                    continue: () => {
                      i++;
                      step();
                    },
                  };
            if (req.onsuccess) req.onsuccess({ type: 'success' });
            settle();
          });
        };
        step();
        return req;
      },
    });
    return t;
  }

  return {
    open(name, version) {
      calls.push(['open', name, version]);
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      if (opt.hang) return req;
      defer(() => {
        if (opt.failOpen) {
          req.error = new Error('UnknownError');
          if (req.onerror) req.onerror({ type: 'error' });
          return;
        }
        const db = {
          createObjectStore: (store) => {
            tv.stores.add(`${name}/${store}`);
          },
          transaction: (store, mode) => {
            if (!tv.stores.has(`${name}/${store}`)) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
            return transaction(mode || 'readonly');
          },
        };
        req.result = db;
        if (!tv.dbVersions.has(name)) {
          tv.dbVersions.set(name, version);
          if (req.onupgradeneeded) req.onupgradeneeded({ type: 'upgradeneeded' });
        }
        if (req.onsuccess) req.onsuccess({ type: 'success' });
      });
      return req;
    },
  };
}

/**
 * The TV: what lasts between starts (localStorage, IndexedDB) and the network it can reach.
 * `routes(url)` answers a request: { status, body } (Buffer or string), or null for no connection.
 */
export function createFakeTv({ shellConfig, bundled = {}, routes = () => null, idb = {} } = {}) {
  const tv = {
    storage: new Map(),
    files: new Map(),
    stores: new Set(),
    dbVersions: new Map(),
    idb,
    shellConfig,
    bundled,
    routes,
    starts: [],
  };
  tv.start = (opts = {}) => {
    const s = startApp(tv, opts);
    tv.starts.push(s);
    return s;
  };
  return tv;
}

function startApp(tv, { before } = {}) {
  let pending = 0;
  let now = 0;
  let timers = [];
  let timerId = 0;
  const errors = [];
  const requests = [];
  const dbCalls = [];
  const blobs = new Map();
  const app = { errors, requests, dbCalls, blobs, reloaded: 0, scriptsRun: [], styles: [], links: [], alive: true };

  const defer = (fn) => {
    pending++;
    setImmediate(() => {
      pending--;
      if (!app.alive) return;
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    });
  };

  const storage = {
    getItem: (k) => (tv.storage.has(k) ? tv.storage.get(k) : null),
    setItem: (k, v) => tv.storage.set(k, String(v)),
    removeItem: (k) => tv.storage.delete(k),
  };

  const listeners = { doc: {}, win: {} };
  const on = (where) => (type, fn) => (listeners[where][type] = listeners[where][type] || []).push(fn);
  const fire = (where, type, event) => (listeners[where][type] || []).slice().forEach((fn) => fn(event || { type }));

  // Scripts with src run one after another, in the order they were added (async=false keeps that on a TV).
  const scriptQueue = [];
  let scriptBusy = false;
  /** Runs a script as a browser does: a throw is reported, and the rest of the page carries on. */
  const runCode = (code, name) => {
    try {
      vm.runInContext(code, ctx, { filename: name });
      app.scriptsRun.push(name);
    } catch (e) {
      errors.push(e);
      app.scriptsRun.push(name + ' (threw)');
    }
  };
  const lookup = (rel) => {
    if (SHELL_SCRIPTS[rel] !== undefined) return SHELL_SCRIPTS[rel];
    return tv.bundled[rel] !== undefined ? String(tv.bundled[rel]) : null;
  };
  const pumpScripts = () => {
    if (scriptBusy || !scriptQueue.length) return;
    scriptBusy = true;
    const el = scriptQueue.shift();
    defer(() => {
      const code = el.src.startsWith(SHELL_BASE) ? lookup(el.src.slice(SHELL_BASE.length)) : null;
      if (code == null) {
        app.scriptsRun.push(el.src + ' (missing)');
        if (el.onerror) el.onerror({ type: 'error' });
      } else {
        runCode(code, el.src);
        if (el.onload) el.onload({ type: 'load' });
      }
      scriptBusy = false;
      pumpScripts();
    });
  };

  const page = {
    connected(el) {
      if (el.tagName === 'SCRIPT') {
        if (el.src) {
          scriptQueue.push(el);
          pumpScripts();
        } else {
          runCode(el.text || '', `inline #${app.scriptsRun.length}`);
        }
      } else if (el.tagName === 'LINK') {
        app.links.push(el.href);
        defer(() => {
          const ok = el.href.startsWith(SHELL_BASE) && tv.bundled[el.href.slice(SHELL_BASE.length)] !== undefined;
          const fn = ok ? el.onload : el.onerror;
          if (fn) fn({ type: ok ? 'load' : 'error' });
        });
      } else if (el.tagName === 'STYLE') {
        app.styles.push(el.textContent);
      }
    },
  };

  const document = {
    readyState: 'loading',
    head: new FakeElement('head', page),
    body: new FakeElement('body', page),
    createElement: (tag) => new FakeElement(tag, page),
    addEventListener: on('doc'),
    createEvent: () => ({
      initEvent(type) {
        this.type = type;
      },
    }),
  };

  class FakeXHR {
    open(method, url) {
      this.method = method;
      this.url = url;
      this.status = 0;
      this.responseType = '';
    }
    send() {
      requests.push({ url: this.url, at: now });
      defer(() => {
        const answer = tv.routes(this.url.replace(/[?#].*$/, ''), this.url);
        if (!answer) {
          if (this.onerror) this.onerror({ type: 'error' });
          return;
        }
        this.status = answer.status || 200;
        const body = Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(String(answer.body || ''), 'utf8');
        if (this.responseType === 'arraybuffer') {
          this.response = body.buffer.slice(body.byteOffset, body.byteOffset + body.length);
        } else {
          this.responseText = body.toString('utf8');
        }
        if (this.onload) this.onload({ type: 'load' });
      });
    }
  }

  class FakeBlob {
    constructor(parts, opts = {}) {
      this.data = Buffer.concat(parts.map((p) => Buffer.from(p.buffer ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : p)));
      this.type = opts.type || '';
    }
  }
  let blobId = 0;

  const indexedDB = fakeIndexedDb(tv, defer, dbCalls);
  const sandbox = {
    document,
    localStorage: storage,
    XMLHttpRequest: FakeXHR,
    Blob: FakeBlob,
    URL: {
      createObjectURL: (b) => {
        const url = `blob:file:///${++blobId}`;
        blobs.set(url, b);
        return url;
      },
      revokeObjectURL: (u) => blobs.delete(u),
    },
    location: {
      href: SHELL_BASE + 'index.html',
      reload: () => {
        app.reloaded++;
      },
    },
    setTimeout: (fn, ms) => {
      const id = ++timerId;
      timers.push({ id, at: now + (ms || 0), fn });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    addEventListener: on('win'),
    dispatchEvent: (e) => fire('win', e.type, e),
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    TextDecoder,
    console,
    HOMETV_SHELL: JSON.parse(JSON.stringify(tv.shellConfig)),
  };
  if (indexedDB) sandbox.indexedDB = indexedDB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = this; var self = this;', ctx);
  if (before) before(ctx);

  /** Lets every pending callback run (store, network, script loads). */
  app.idle = async () => {
    for (let i = 0; i < 100000 && pending > 0; i++) await new Promise((r) => setImmediate(r));
  };
  /** Moves the clock on, running the timers that fall due (and what they set off) in order. */
  app.tick = async (ms) => {
    const end = now + ms;
    await app.idle();
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      try {
        t.fn();
      } catch (e) {
        errors.push(e);
      }
      await app.idle();
    }
    now = end;
  };
  /** The app is closed: its callbacks and timers stop. */
  app.stop = () => {
    app.alive = false;
    timers = [];
  };
  app.ctx = ctx;
  app.win = ctx;
  app.document = document;
  app.status = () => JSON.parse(JSON.stringify(ctx.HomeTVBoot.status()));
  app.state = () => JSON.parse(tv.storage.get('hometv.pages') || 'null');

  // The page loads: boot.js runs during parsing, then DOMContentLoaded, then load.
  runCode(SHELL_SCRIPTS['boot.js'], SHELL_BASE + 'boot.js');
  app.ready = (async () => {
    await app.idle();
    document.readyState = 'interactive';
    fire('doc', 'DOMContentLoaded');
    await app.idle();
    document.readyState = 'complete';
    fire('win', 'load');
    await app.idle();
  })();
  return app;
}
