'use strict';
// Validates every GA4 event name used in analytics.js against the
// Measurement Protocol naming rules: ^[A-Za-z][A-Za-z0-9_]*$ and <=40 chars.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'analytics.js');
const src = fs.readFileSync(file, 'utf8');

// Extract all track('NAME' ...) occurrences (single-quoted names),
// plus the `|| 'NAME'` fallback strings used by dynamic serverAction/batchAction.
const re = /track\(\s*'([^']+)'/g;
const names = new Set();
let m;
while ((m = re.exec(src)) !== null) {
  names.add(m[1]);
}
const fallbackRe = /\|\|\s*'([A-Za-z][A-Za-z0-9_]*)'/g;
while ((m = fallbackRe.exec(src)) !== null) {
  names.add(m[1]);
}

const GA4 = /^[A-Za-z][A-Za-z0-9_]*$/;
const problems = [];
const ok = [];
for (const n of names) {
  if (!GA4.test(n)) {
    problems.push(`${n}  — 含非法字符（只允许字母/数字/下划线，且以字母开头）`);
  } else if (n.length > 40) {
    problems.push(`${n}  —  长度 ${n.length} 超过 40 上限`);
  } else {
    ok.push(n);
  }
}

console.log(`检测到 ${names.size} 个去重后的 GA4 事件名：`);
ok.sort().forEach(n => console.log('  ✓ ' + n));

if (problems.length) {
  console.error('\n✗ 不合规的事件名：');
  problems.forEach(p => console.error('  ✗ ' + p));
  process.exit(1);
}

// Also assert the expected funnel names exist end-to-end.
const required = [
  'extension_opened',
  'onboarding_shown', 'onboarding_provider_picked', 'onboarding_skip', 'onboarding_guide_opened',
  'configuration_started', 'connection_test_started', 'connection_test_succeeded', 'connection_test_failed',
  'server_saved', 'server_save_failed', 'configuration_completed', 'first_server_viewed',
  'server_action', 'batch_action', 'export_ics', 'export_config',
  'config_import_started', 'config_import_succeeded', 'config_import_failed',
  'view_guide', 'expiry_reminder_enabled', 'expiry_reminder_fired',
  'request_provider', 'report_bug', 'contact_dev'
];
const missing = required.filter(r => !names.has(r));
if (missing.length) {
  console.error('\n✗ 缺失关键漏斗事件：' + missing.join(', '));
  process.exit(1);
}

console.log(`\n✅ 全部 ${ok.length} 个事件名合规，关键漏斗事件齐全。`);
