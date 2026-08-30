const fs = require('fs');
const path = require('path');
const ROOT = '/Users/renyb/projects/servermanger';

const shared = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// 1) PROVIDER_META keys
const metaBlock = shared.match(/const PROVIDER_META = \{([\s\S]*?)\};/);
const metaKeys = [];
if (metaBlock) {
  const re = /(\w+):\s*\{\s*name:/g;
  let m;
  while ((m = re.exec(metaBlock[1])) !== null) metaKeys.push(m[1]);
}

// 2) options.html dropdown values
const selBlock = optionsHtml.match(/<select id="panelType">([\s\S]*?)<\/select>/);
const dropdown = [];
if (selBlock) {
  const re = /<option value="([^"]+)"/g;
  let m;
  while ((m = re.exec(selBlock[1])) !== null) dropdown.push(m[1]);
}

// 3) popup.js onboarding providers
const onbBlock = popupJs.match(/const ONBOARDING_PROVIDERS = \[([^\]]+)\]/);
const onboarding = onbBlock ? (onbBlock[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, '')) : [];

// 4) background.js dispatch coverage (withActivePanel blocks)
const dispatchBlocks = [];
const reDispatch = /withActivePanel\(\{([\s\S]*?)\}\);/g;
let dm;
while ((dm = reDispatch.exec(bg)) !== null) {
  const keys = [];
  const kr = /(\w+):\s*config\s*=>/g;
  let km;
  while ((km = kr.exec(dm[1])) !== null) keys.push(km[1]);
  dispatchBlocks.push(keys);
}

// 5) logos
const logos = metaKeys.map(k => {
  const m = metaBlock[1].match(new RegExp(k + ':\\s*\\{\\s*name:[^}]*logo:\\s*\'([^\']+)\''));
  return m ? m[1] : null;
});

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

console.log('PROVIDER_META (' + metaKeys.length + '): ' + metaKeys.join(', '));
console.log('');

console.log('[1] dropdown covers every provider');
metaKeys.forEach(k => ok(dropdown.includes(k), 'dropdown has "' + k + '"'));
ok(dropdown.length === metaKeys.length, 'dropdown has no extras beyond PROVIDER_META (' + dropdown.length + ' vs ' + metaKeys.length + ')');

console.log('');
console.log('[2] onboarding covers every provider');
metaKeys.forEach(k => ok(onboarding.includes(k), 'onboarding has "' + k + '"'));
ok(onboarding.length === metaKeys.length, 'onboarding has no extras (' + onboarding.length + ' vs ' + metaKeys.length + ')');

console.log('');
console.log('[3] background dispatch covers every provider on every operation');
console.log('  (found ' + dispatchBlocks.length + ' withActivePanel blocks)');
dispatchBlocks.forEach((keys, i) => {
  const missing = metaKeys.filter(k => !keys.includes(k));
  ok(missing.length === 0, 'block #' + (i + 1) + ' covers all ' + metaKeys.length + (missing.length ? ' — MISSING: ' + missing.join(', ') : ''));
});

console.log('');
console.log('[4] logos exist on disk');
metaKeys.forEach((k, i) => {
  const p = logos[i];
  ok(p && fs.existsSync(path.join(ROOT, p)), k + ' -> ' + p);
});

console.log('');
console.log('[5] regression guards');
ok(!/if \(!guidePath\)[\s\S]{0,200}return;/.test(optionsJs), 'updatePanelHelp no longer returns early when a guide is missing');
ok(/pendingPanel && PROVIDER_META\[pendingPanel\]/.test(optionsJs), 'pendingPanelType deep-link accepts all providers (not just guided ones)');

console.log('');
console.log(fail === 0 ? '✅ ALL CHECKS PASSED' : '❌ ' + fail + ' CHECK(S) FAILED');
process.exit(fail === 0 ? 0 : 1);
