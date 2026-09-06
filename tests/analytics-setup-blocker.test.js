const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAnalytics() {
  const store = {};
  const sent = [];
  const context = {
    console,
    crypto: { randomUUID: () => 'test-client-id' },
    fetch: async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return { json: async () => ({ validationMessages: [] }) };
    },
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            if (Array.isArray(keys)) {
              const out = {};
              keys.forEach(key => { if (key in store) out[key] = store[key]; });
              callback(out);
              return;
            }
            callback(keys in store ? { [keys]: store[keys] } : {});
          },
          set(value, callback) {
            Object.assign(store, value);
            if (callback) callback();
          }
        }
      }
    }
  };
  vm.createContext(context);
  const analyticsPath = path.join(__dirname, '..', 'analytics.js');
  vm.runInContext(fs.readFileSync(analyticsPath, 'utf8'), context, { filename: analyticsPath });
  return { Analytics: context.Analytics, sent };
}

async function run() {
  const { Analytics, sent } = loadAnalytics();

  await Analytics.setupBlocker('ec2', 'credentials_not_found');
  assert.strictEqual(sent[0].body.events[0].name, 'setup_blocker');
  assert.strictEqual(sent[0].body.events[0].params.provider, 'aws_ec2');
  assert.strictEqual(sent[0].body.events[0].params.reason, 'credentials_not_found');
  assert.strictEqual('apiUrl' in sent[0].body.events[0].params, false);
  assert.strictEqual('apiKey' in sent[0].body.events[0].params, false);

  await Analytics.setupBlocker('unknown-panel', 'typed free text should not pass through');
  assert.strictEqual(sent[1].body.events[0].params.provider, 'unknown');
  assert.strictEqual(sent[1].body.events[0].params.reason, 'other');

  await Analytics.connectionTestFailed('solusvm', 'CORS blocked by access-control-allow-origin');
  assert.strictEqual(sent[2].body.events[0].name, 'connection_test_failed');
  assert.strictEqual(sent[2].body.events[0].params.provider, 'solusvm_v1');
  assert.strictEqual(sent[2].body.events[0].params.error_type, 'cors');

  console.log('analytics-setup-blocker tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
