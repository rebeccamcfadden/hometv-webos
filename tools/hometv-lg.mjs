// hometv-lg: the laptop tool for HomeTV on LG, one Windows file (built with `npm run exe`).
//   hometv-lg check <tv address> [--backup] [--launch]
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'check') {
  process.argv = [process.argv[0], 'tv-check', ...rest];
  await import('./tv-check.mjs');
} else {
  console.log('HomeTV for LG\n\n  hometv-lg check <tv address> [--backup] [--launch] [--reach]\n\n' +
    'check   reads the TV (model, apps, inputs, what v0 needs) after its "Allow" prompt;\n' +
    '        --backup also saves the settings it can read; --launch opens Netflix and YouTube, asking first;\n' +
    '        --reach checks the TV can reach this laptop (the TV\'s browser opens for a moment).');
  process.exitCode = cmd ? 2 : 0;
}
