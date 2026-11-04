// A pretend rooted TV's shell, for the backup and restore tests: answers `id -u`, `luna-send -n 1` to the settings
// service, the database, system properties, the software version and the app manager, and `tar` of the preferences
// folder. Everything it is asked is logged. Two ways in:
//   fakeShell(state)                  in the same process: { run, log, state }
//   node tests/fake-shell.mjs …       as `ssh` (HOMETV_SSH): the command is the last argument; the state is kept in
//                                     the JSON file FAKE_TV_STATE and every command appended to FAKE_TV_LOG.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function freshState() {
  return {
    uid: '0',
    model: '43UT8000AUA',
    sdk: '10.3.1',
    sw: { major_ver: '33', minor_ver: '31.61', product_name: 'webOSTV 10.3.1', device_id: 'aa:bb:cc:dd:ee:ff' },
    foreground: 'com.webos.app.home',
    settings: {
      picture: { pictureMode: 'standard', backlight: '80', contrast: '85' },
      sound: { soundMode: 'standard', soundOutput: 'tv_speaker' },
      network: { deviceName: 'SECRET-TV-NAME', allowMobileDeviceAccess: true },
      lock: { parentalPin: '1234' },
      option: { country: 'US', eulaAgreed: 'true', localeInfo: { locales: { UI: 'en-US', TV: 'en-US' }, clock: '12' } }
    },
    db8: {
      'com.webos.settings.system:1': [
        { category: 'picture$hdmi1.standard.x', app_id: '', value: { backlight: '80' } },
        { category: 'picture', app_id: '', value: { pictureMode: 'standard' } },
        { category: 'aiSound', app_id: '', value: { mode: 'on' } }
      ]
    },
    tar: 'TARDATA',
    failSet: '',
    failReadBack: ''
  };
}

function unquote(s) {
  return s.slice(1, -1).replace(/'\\''/g, "'");
}

export function answer(state, cmd) {
  if (cmd === 'id -u') return { code: 0, stdout: state.uid + '\n' };
  if (/^tar -cf - /.test(cmd)) return { code: 0, stdout: state.tar };
  const m = /^luna-send -n 1 -w \d+ ('[^']*') ('(?:[^']|'\\'')*')$/.exec(cmd);
  if (!m) return { code: 127, stdout: '', stderr: 'sh: not found' };
  const uri = unquote(m[1]).replace('luna://', '');
  const p = JSON.parse(unquote(m[2]));
  const out = (o) => ({ code: 0, stdout: JSON.stringify(o, null, 4) + '\n' });
  const s = state.settings;
  switch (uri) {
    case 'com.webos.settingsservice/getSystemSettings': {
      if (!s[p.category]) return out({ returnValue: false, errorText: 'no such category' });
      const all = { ...s[p.category] };
      if (state.failReadBack === p.category && state.written && state.written.includes(p.category)) for (const k of Object.keys(all)) all[k] = 'changed';
      const settings = p.keys ? Object.fromEntries(p.keys.filter((k) => k in all).map((k) => [k, all[k]])) : all;
      return out({ returnValue: true, category: p.category, settings });
    }
    case 'com.webos.settingsservice/setSystemSettings': {
      if (state.failSet === p.category) return out({ returnValue: false, errorText: 'refused by the settings service' });
      s[p.category] = { ...(s[p.category] || {}), ...p.settings };
      state.written = [...(state.written || []), p.category];
      return out({ returnValue: true, method: 'setSystemSettings' });
    }
    case 'com.webos.service.tv.systemproperty/getSystemInfo':
      return out({ returnValue: true, modelName: state.model, sdkVersion: state.sdk, serialNumber: 'SECRET123' });
    case 'com.webos.service.update/getCurrentSWInformation':
      return out({ returnValue: true, ...state.sw });
    case 'com.webos.applicationManager/getForegroundAppInfo':
      return out({ returnValue: true, appId: state.foreground });
    case 'com.webos.service.db/find': {
      const all = state.db8[p.query.from];
      if (!all) return out({ returnValue: false, errorCode: -3970, errorText: 'kind not registered' });
      // two records a page, to exercise paging
      const start = p.query.page ? Number(p.query.page) : 0;
      return out({ returnValue: true, results: all.slice(start, start + 2), ...(start + 2 < all.length ? { next: String(start + 2) } : {}) });
    }
    default:
      return out({ returnValue: false, errorText: 'Unknown method' });
  }
}

export function fakeShell(state = freshState()) {
  const log = [];
  return {
    state, log,
    async run(cmd) {
      log.push(cmd);
      return { stderr: '', ...answer(state, cmd) };
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[process.argv.length - 1];
  const file = process.env.FAKE_TV_STATE;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.appendFileSync(process.env.FAKE_TV_LOG, JSON.stringify({ args: process.argv.slice(2, -1), cmd }) + '\n');
  const r = answer(state, cmd);
  fs.writeFileSync(file, JSON.stringify(state));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
