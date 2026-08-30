// Tests for the providers released in 1.6.3: Proxmox, Hetzner, DigitalOcean,
// and AWS Lightsail. These drivers were already implemented but hidden from
// the panel-type selector, so they had no coverage. Each test mocks the real
// provider API response shape and verifies the normalize pipeline.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GB = 1024 * 1024 * 1024;

function makeFetch(handler) {
  return async (url, options) => {
    const body = handler(String(url), options || {});
    return {
      ok: true,
      status: 200,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
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

async function assertThrowsAsync(fn, matcher, label) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    assert.ok(matcher.test(e.message), label + ' — unexpected message: ' + e.message);
  }
  assert.ok(threw, label + ' — should have thrown');
}

// ─── Proxmox VE ────────────────────────────────────────────────

async function testProxmoxNormalize() {
  const seen = [];
  const ctx = loadBackground(makeFetch(url => {
    seen.push(url);
    if (/\/nodes$/.test(url)) return { data: [{ node: 'pve' }] };
    if (/\/nodes\/pve\/qemu$/.test(url)) return { data: [{ vmid: 100, name: 'my-vm', type: 'qemu' }] };
    if (/\/nodes\/pve\/lxc$/.test(url)) return { data: [] };
    if (/status\/current$/.test(url)) {
      return {
        data: {
          vmid: 100, name: 'my-vm', status: 'running', qmpstatus: 'running',
          ip: '10.0.0.5', os: 'Linux',
          maxmem: 2 * GB,      // bytes
          maxdisk: 40 * GB     // bytes
        }
      };
    }
    return {};
  }));

  const s = await ctx.getProxmoxSingle({ apiUrl: 'https://pve.example.com', apiKey: 'user@realm!token=secret' });

  assert.strictEqual(s.id, '100', 'proxmox id');
  assert.strictEqual(s.hostname, 'my-vm', 'proxmox hostname');
  assert.strictEqual(s.status, 'online', 'proxmox running -> online');
  assert.strictEqual(s.ipaddress, '10.0.0.5', 'proxmox ip');
  assert.strictEqual(s.os, 'Linux', 'proxmox os');
  // maxmem 2GB -> 2048 MB ; maxdisk 40GB -> 40960 MB
  assert.strictEqual(s.mem, '0,2048,2048,0', 'proxmox mem bytes->MB');
  assert.strictEqual(s.hdd, '0,40960,40960,0', 'proxmox disk bytes->MB');
  assert.strictEqual(s.bw, '0,0,0,0', 'proxmox bw');
}

async function testProxmoxStoppedStatus() {
  const ctx = loadBackground(makeFetch(url => {
    if (/\/nodes$/.test(url)) return { data: [{ node: 'pve' }] };
    if (/\/qemu$/.test(url)) return { data: [{ vmid: 101 }] };
    if (/\/lxc$/.test(url)) return { data: [] };
    return { data: { vmid: 101, name: 'off-vm', status: 'stopped', maxmem: GB, maxdisk: 10 * GB } };
  }));
  const s = await ctx.getProxmoxSingle({ apiUrl: 'https://pve.example.com', apiKey: 'k' });
  assert.strictEqual(s.status, 'offline', 'proxmox stopped -> offline');
}

async function testProxmoxActionMapping() {
  const seen = [];
  const ctx = loadBackground(makeFetch(url => {
    seen.push(url);
    if (/\/nodes$/.test(url)) return { data: [{ node: 'pve' }] };
    if (/\/qemu$/.test(url)) return { data: [{ vmid: 100 }] };
    if (/\/lxc$/.test(url)) return { data: [] };
    return { data: {} };
  }));

  await ctx.callProxmoxAction('boot', { apiUrl: 'https://pve.example.com', apiKey: 'k' });
  const bootUrl = seen.find(u => /status\/(start|reboot|stop)$/.test(u));
  assert.ok(bootUrl, 'proxmox action should hit a status endpoint');
  assert.ok(/\/status\/start$/.test(bootUrl), 'proxmox boot -> start, got: ' + bootUrl);
}

async function testProxmoxMissingConfig() {
  const ctx = loadBackground(makeFetch(() => ({})));
  await assertThrowsAsync(
    () => ctx.getProxmoxSingle({ apiUrl: '', apiKey: '' }),
    /configuration is incomplete/i,
    'proxmox missing config'
  );
}

async function testProxmoxNoVms() {
  const ctx = loadBackground(makeFetch(url => {
    if (/\/nodes$/.test(url)) return { data: [{ node: 'pve' }] };
    return { data: [] };
  }));
  await assertThrowsAsync(
    () => ctx.getProxmoxSingle({ apiUrl: 'https://pve.example.com', apiKey: 'k' }),
    /No VMs\/containers found/,
    'proxmox no vms'
  );
}

// ─── Hetzner Cloud ─────────────────────────────────────────────

async function testHetznerNormalize() {
  const ctx = loadBackground(makeFetch(() => ({
    servers: [{
      id: 42, name: 'hetzner-1', status: 'running',
      public_net: { ipv4: { ip: '1.2.3.4' } },
      server_type: { memory: 4, disk: 40 },
      image: { name: 'Ubuntu 22.04', os_flavor: 'ubuntu' },
      outgoing_traffic: 512 * 1024 * 1024,
      ingoing_traffic: 1024 * 1024 * 1024
    }]
  })));

  const s = await ctx.getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud', apiKey: 'token' });

  assert.strictEqual(s.id, '42', 'hetzner id');
  assert.strictEqual(s.hostname, 'hetzner-1', 'hetzner hostname');
  assert.strictEqual(s.status, 'online', 'hetzner running -> online');
  assert.strictEqual(s.ipaddress, '1.2.3.4', 'hetzner ipv4');
  assert.strictEqual(s.os, 'Ubuntu 22.04', 'hetzner os');
  assert.strictEqual(s.mem, `0,${4 * GB},${4 * GB},0`, 'hetzner memory GB -> bytes');
  assert.strictEqual(s.hdd, `0,${40 * GB},${40 * GB},0`, 'hetzner disk GB -> bytes');
  // outgoing + ingoing traffic summed
  assert.strictEqual(s.bw, `0,${1536 * 1024 * 1024},${1536 * 1024 * 1024},0`, 'hetzner traffic summed');
}

async function testHetznerOffStatus() {
  const ctx = loadBackground(makeFetch(() => ({
    servers: [{ id: 7, name: 'h', status: 'off', server_type: {}, image: {} }]
  })));
  const s = await ctx.getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud', apiKey: 't' });
  assert.strictEqual(s.status, 'offline', 'hetzner off -> offline');
}

async function testHetznerActionMapping() {
  const seen = [];
  const ctx = loadBackground(makeFetch(url => {
    seen.push(url);
    return { servers: [{ id: 42, name: 'h' }] };
  }));
  await ctx.callHetznerAction('boot', { apiUrl: 'https://api.hetzner.cloud', apiKey: 't' });
  const url = seen.find(u => /\/actions\//.test(u));
  assert.ok(url, 'hetzner action endpoint called');
  assert.ok(/\/actions\/poweron$/.test(url), 'hetzner boot -> poweron, got: ' + url);
}

async function testHetznerMissingConfig() {
  const ctx = loadBackground(makeFetch(() => ({})));
  await assertThrowsAsync(
    () => ctx.getHetznerSingle({ apiUrl: '', apiKey: '' }),
    /configuration is incomplete/i,
    'hetzner missing config'
  );
}

async function testHetznerMultipleServers() {
  const ctx = loadBackground(makeFetch(() => ({
    servers: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
  })));
  await assertThrowsAsync(
    () => ctx.getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud', apiKey: 't' }),
    /only single-server setups/i,
    'hetzner multiple servers'
  );
}

// ─── DigitalOcean ──────────────────────────────────────────────

async function testDONormalize() {
  const ctx = loadBackground(makeFetch(() => ({
    droplets: [{
      id: 99, name: 'droplet-1', status: 'active',
      networks: { v4: [{ type: 'public', ip_address: '5.6.7.8' }] },
      image: { distribution: 'Ubuntu', name: 'ubuntu-22-04-x64' },
      memory: 2048,  // MB
      disk: 50       // GB
    }]
  })));

  const s = await ctx.getDOSingle({ apiUrl: 'https://api.digitalocean.com', apiKey: 'token' });

  assert.strictEqual(s.id, '99', 'do id');
  assert.strictEqual(s.hostname, 'droplet-1', 'do hostname');
  assert.strictEqual(s.status, 'online', 'do active -> online');
  assert.strictEqual(s.ipaddress, '5.6.7.8', 'do public ipv4');
  assert.strictEqual(s.os, 'Ubuntu', 'do os');
  assert.strictEqual(s.mem, '0,2048,2048,0', 'do memory MB kept as-is');
  assert.strictEqual(s.hdd, `0,${50 * 1024},${50 * 1024},0`, 'do disk GB -> MB');
}

async function testDOActionMapping() {
  const seen = [];
  const ctx = loadBackground(makeFetch((url, options) => {
    seen.push({ url, body: options.body });
    return { droplets: [{ id: 99, name: 'd' }] };
  }));
  await ctx.callDOAction('shutdown', { apiUrl: 'https://api.digitalocean.com', apiKey: 't' });
  const call = seen.find(c => /\/actions$/.test(c.url));
  assert.ok(call, 'do action endpoint called');
  // fetchDO JSON.stringifies the body before calling fetch(), so parse it back.
  const parsed = typeof call.body === 'string' ? JSON.parse(call.body) : call.body;
  assert.strictEqual(parsed.type, 'shutdown', 'do shutdown action type');
}

async function testDOMissingConfig() {
  const ctx = loadBackground(makeFetch(() => ({})));
  await assertThrowsAsync(
    () => ctx.getDOSingle({ apiUrl: '', apiKey: '' }),
    /configuration is incomplete/i,
    'do missing config'
  );
}

// ─── AWS Lightsail ─────────────────────────────────────────────

async function testLightsailNormalize() {
  const ctx = loadBackground(makeFetch(() => ({
    instances: [{
      name: 'ls-1',
      arn: 'arn:aws:lightsail:us-east-1:123:Instance/abc',
      state: { name: 'running' },
      publicIpAddress: '9.9.9.9',
      blueprintName: 'Ubuntu 22.04 LTS',
      hardware: { ramSizeInGb: 2, disks: [{ sizeInGb: 60 }] },
      networking: { monthlyTransfer: { gbAllowed: 1024 } }
    }]
  })));

  const s = await ctx.getLightsailSingle({
    apiUrl: 'us-east-1', apiKey: 'AKIAEXAMPLE', apiHash: 'secret'
  });

  assert.strictEqual(s.id, 'ls-1', 'lightsail id');
  assert.strictEqual(s.hostname, 'ls-1', 'lightsail hostname');
  assert.strictEqual(s.status, 'online', 'lightsail running -> online');
  assert.strictEqual(s.ipaddress, '9.9.9.9', 'lightsail public ip');
  assert.strictEqual(s.os, 'Ubuntu 22.04 LTS', 'lightsail blueprint as os');
  assert.strictEqual(s.mem, `0,${2 * GB},${2 * GB},0`, 'lightsail ram GB -> bytes');
  assert.strictEqual(s.hdd, `0,${60 * GB},${60 * GB},0`, 'lightsail disk GB -> bytes');
  assert.strictEqual(s.bw, `0,${1024 * GB},${1024 * GB},0`, 'lightsail transfer quota -> bytes');
}

async function testLightsailStoppedStatus() {
  const ctx = loadBackground(makeFetch(() => ({
    instances: [{ name: 'ls-2', state: { name: 'stopped' }, hardware: {}, networking: {} }]
  })));
  const s = await ctx.getLightsailSingle({ apiUrl: 'eu-west-1', apiKey: 'AK', apiHash: 'SH' });
  assert.strictEqual(s.status, 'offline', 'lightsail stopped -> offline');
}

async function testLightsailMissingConfig() {
  const ctx = loadBackground(makeFetch(() => ({})));
  await assertThrowsAsync(
    () => ctx.getLightsailSingle({ apiUrl: '', apiKey: '', apiHash: '' }),
    /configuration is incomplete/i,
    'lightsail missing config'
  );
}

async function testLightsailMultipleInstances() {
  const ctx = loadBackground(makeFetch(() => ({
    instances: [{ name: 'a', state: { name: 'running' } }, { name: 'b', state: { name: 'running' } }]
  })));
  await assertThrowsAsync(
    () => ctx.getLightsailSingle({ apiUrl: 'us-east-1', apiKey: 'AK', apiHash: 'SH' }),
    /only single-instance accounts/i,
    'lightsail multiple instances'
  );
}

async function run() {
  await testProxmoxNormalize();
  await testProxmoxStoppedStatus();
  await testProxmoxActionMapping();
  await testProxmoxMissingConfig();
  await testProxmoxNoVms();

  await testHetznerNormalize();
  await testHetznerOffStatus();
  await testHetznerActionMapping();
  await testHetznerMissingConfig();
  await testHetznerMultipleServers();

  await testDONormalize();
  await testDOActionMapping();
  await testDOMissingConfig();

  await testLightsailNormalize();
  await testLightsailStoppedStatus();
  await testLightsailMissingConfig();
  await testLightsailMultipleInstances();

  console.log('released-providers tests passed (18 assertions groups: proxmox, hetzner, digitalocean, lightsail)');
}

run().catch(err => { console.error(err); process.exit(1); });
