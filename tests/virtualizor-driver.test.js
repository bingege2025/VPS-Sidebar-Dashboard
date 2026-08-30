// End-to-end test for the Virtualizor driver: mock the real listvs API
// response format and verify the full getVirtualizorSingle -> normalize pipeline.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function makeFetch(handler) {
  return async (url) => {
    const body = handler(url);
    return {
      ok: true,
      status: 200,
      text: async () => body
    };
  };
}

function loadBackground(fetchImpl) {
  const context = {
    console,
    URLSearchParams,
    TextEncoder,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    fetch: fetchImpl,
    importScripts(...files) {
      for (const f of files) {
        const p = path.join(__dirname, '..', f);
        vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: p });
      }
    },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        local: {
          get(_keys, callback) { callback({ servers: [], currentServerId: null }); },
          set(_value, callback) { if (callback) callback(); },
          remove(_keys, callback) { if (callback) callback(); }
        }
      }
    }
  };
  vm.createContext(context);
  const backgroundPath = path.join(__dirname, '..', 'background.js');
  vm.runInContext(fs.readFileSync(backgroundPath, 'utf8'), context, { filename: backgroundPath });
  return context;
}

// Realistic Virtualizor listvs response (single VPS account)
function listvsResponse() {
  return JSON.stringify({
    vps: [{
      vpsid: '12345',
      vps_name: 'my-vps',
      hostname: 'my-vps.example.com',
      status: '1',
      ips: '1.2.3.4, 5.6.7.8',
      os_name: 'CentOS 7 x86_64',
      os_distro: 'centos',
      ram: 2048,          // MB
      disk_space: 40,     // GB
      bandwidth: 2,       // GB (monthly quota)
      bandwidth_used: 1   // GB (used)
    }]
  });
}

async function testListvsSingleVps() {
  const ctx = loadBackground(makeFetch(() => listvsResponse()));
  const cfg = { apiUrl: 'https://panel.example.com', apiKey: 'AK', apiHash: 'AP' };
  const server = await ctx.getVirtualizorSingle(cfg);

  assert.strictEqual(server.id, '12345', 'id');
  assert.strictEqual(server.hostname, 'my-vps.example.com', 'hostname');
  assert.strictEqual(server.status, 'online', 'status mapped from 1');
  assert.strictEqual(server.vmstate, 'online', 'vmstate');
  assert.strictEqual(server.ipaddress, '1.2.3.4', 'first ip used');
  assert.strictEqual(server.os, 'CentOS 7 x86_64', 'os');
  // bytes: ram=2048MB, disk=40GB, bw used=1GB/total=2GB
  assert.strictEqual(server.mem, `0,${2048 * MB},${2048 * MB},0`, 'mem in bytes = 2GB');
  assert.strictEqual(server.hdd, `0,${40 * GB},${40 * GB},0`, 'hdd in bytes = 40GB');
  assert.strictEqual(server.bw, `${1 * GB},${2 * GB},${2 * GB},50`, 'bw used/total = 1/2 GB, 50%');
}

// Single-VPS response shape (data.vs object instead of vps array)
async function testVsObjectShape() {
  const ctx = loadBackground(makeFetch(() => JSON.stringify({
    vs: { vpsid: '77', hostname: 'solo', status: '1', ips: '9.9.9.9', os_name: 'Ubuntu', ram: 1024, disk_space: 20, bandwidth: 1, bandwidth_used: 0 }
  })));
  const server = await ctx.getVirtualizorSingle({ apiUrl: 'https://p.example.com', apiKey: 'k', apiHash: 'h' });
  assert.strictEqual(server.id, '77');
  assert.strictEqual(server.mem, `0,${1024 * MB},${1024 * MB},0`, 'solo mem = 1GB');
  assert.strictEqual(server.bw, `0,${1 * GB},${1 * GB},0`, 'solo bw = 0/1GB');
}

// Error path: API returns error body
async function testApiError() {
  const ctx = loadBackground(makeFetch(() => JSON.stringify({ error: 'Invalid API Key' })));
  let threw = false;
  try {
    await ctx.getVirtualizorSingle({ apiUrl: 'https://p.example.com', apiKey: 'k', apiHash: 'h' });
  } catch (e) {
    threw = true;
    assert.ok(/Invalid API Key/.test(e.message), 'error message forwarded');
  }
  assert.ok(threw, 'should throw on API error');
}

// Error path: missing config
async function testMissingConfig() {
  const ctx = loadBackground(makeFetch(() => '{}'));
  let threw = false;
  try {
    await ctx.getVirtualizorSingle({ apiUrl: '', apiKey: '', apiHash: '' });
  } catch (e) {
    threw = true;
    assert.ok(/configuration is incomplete/i.test(e.message), 'config validation');
  }
  assert.ok(threw, 'should throw on missing config');
}

async function testActionAddsDoParameter() {
  const seen = [];
  const ctx = loadBackground(makeFetch(url => {
    seen.push(String(url));
    if (String(url).includes('act=listvs')) return listvsResponse();
    return JSON.stringify({ done: { msg: 'ok' } });
  }));

  await ctx.callVirtualizorAction('reboot', { apiUrl: 'https://panel.example.com', apiKey: 'AK', apiHash: 'AP' });

  const actionUrl = seen.find(url => url.includes('act=restart'));
  assert.ok(actionUrl, 'restart action should be called');
  assert.ok(actionUrl.includes('svs=12345'), 'action should include VPS id');
  assert.ok(actionUrl.includes('do=1'), 'Virtualizor power actions require do=1');
}

async function run() {
  await testListvsSingleVps();
  await testVsObjectShape();
  await testApiError();
  await testMissingConfig();
  await testActionAddsDoParameter();
  console.log('virtualizor-driver tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
