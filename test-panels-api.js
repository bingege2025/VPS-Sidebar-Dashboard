/**
 * API integration mock tests for all panel frameworks
 * Run: node test-panels-api.js
 */

const fs = require('fs');
const { createHash } = require('crypto');
const bgSrc = fs.readFileSync(__dirname + '/background.js', 'utf8');

// ─── Mock globals ────────────────────────────────────────────

let mockResponses = {};
let fetchLog = [];

global.fetch = async (url, opts = {}) => {
  const key = `${opts.method || 'GET'} ${url}`;
  fetchLog.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
  const mock = mockResponses[key];
  if (mock) {
    return {
      ok: mock.ok !== false,
      status: mock.status || 200,
      text: async () => typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body),
      json: async () => typeof mock.body === 'string' ? JSON.parse(mock.body) : mock.body
    };
  }
  // Try prefix match
  for (const [pattern, resp] of Object.entries(mockResponses)) {
    if (pattern.includes('*') && key.startsWith(pattern.replace('*', '')) || pattern.includes('*') && url.includes(pattern.replace(/\*/g, ''))) {
      return {
        ok: resp.ok !== false,
        status: resp.status || 200,
        text: async () => typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body),
        json: async () => typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
      };
    }
  }
  console.error(`  UNMOCKED fetch: ${key}`);
  return { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
};

global.crypto = {
  subtle: {
    digest: async (algo, buf) => {
      const hash = createHash('sha256').update(Buffer.from(buf)).digest('hex');
      return Buffer.from(hash, 'hex');
    },
    importKey: async () => ({}),
    sign: async () => new Uint8Array(32).fill(0x42)
  }
};
global.TextEncoder = require('util').TextEncoder;

global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb && cb({}),
      set: (data, cb) => cb && cb(),
      remove: (keys, cb) => cb && cb()
    }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} }
  }
};

// ─── Load shared + background functions ──────────────────────

// Extract function from background.js
function extractFunc(name) {
  const re = new RegExp(`(?:async )?function ${name}[^{]*\\{[\\s\\S]*?\\n(?=\\n(?:async )?function |\\n\\/\\/ |\\nconst |$)`);
  const m = bgSrc.match(re);
  if (!m) throw new Error(`Function not found: ${name}`);
  return m[0];
}

// Load shared.js first
const sharedSrc = fs.readFileSync(__dirname + '/shared.js', 'utf8');
eval(sharedSrc);

// Load dependencies in order
const depFuncs = [
  'pickFirstDefined', 'bytesResource',
  // Virtualizor
  'requireVirtualizorConfig', 'normalizeVirtualizorBaseUrl', 'fetchVirtualizor', 'normalizeVirtualizorServer', 'getVirtualizorSingle',
  // Proxmox
  'requireProxmoxConfig', 'normalizeProxmoxBaseUrl', 'fetchProxmox', 'normalizeProxmoxServer', 'getProxmoxNodes', 'getProxmoxSingle',
  // Hetzner
  'requireHetznerConfig', 'normalizeHetznerBaseUrl', 'fetchHetzner', 'normalizeHetznerServer', 'getHetznerSingle',
  // DigitalOcean
  'requireDOConfig', 'normalizeDOBaseUrl', 'fetchDO', 'normalizeDOServer', 'getDOSingle',
  // Lightsail
  'sha256', 'hmacSign', 'hmacHex', 'getSignatureKey', 'signAWSRequest', 'requireLightsailConfig', 'normalizeLightsailServer', 'getLightsailSingle',
  // EC2
  'getEC2MemoryMB'
];

for (const fn of depFuncs) {
  try {
    eval(extractFunc(fn));
  } catch (e) {
    // Some functions might be inline, skip
    if (!e.message.includes('not found')) throw e;
  }
}

// ─── Test runner ─────────────────────────────────────────────

let passed = 0, failed = 0;
function test(name, fn) {
  fetchLog = [];
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    console.log(`     fetchLog: ${JSON.stringify(fetchLog.map(f => f.url).slice(-3))}`);
    failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

// ─── Virtualizor API mock test ───────────────────────────────

console.log('\n═══ Virtualizor API ────────────────────────────────');

test('getVirtualizorSingle — single VPS', async () => {
  mockResponses = {
    'GET https://panel.example.com/index.php?api=json&apikey=test-key&apipass=test-pass&act=listvs': {
      ok: true, body: {
        vps: {
          '42': { vpsid: '42', hostname: 'my-vps', status: '1', ips: '1.2.3.4', os_name: 'Ubuntu 22.04', ram: '2048', disk_space: '50', bandwidth: '2000', bandwidth_used: '150' }
        }
      }
    }
  };
  const config = { apiUrl: 'https://panel.example.com/', apiKey: 'test-key', apiHash: 'test-pass' };
  const result = await getVirtualizorSingle(config);
  assertEq(result.id, '42');
  assertEq(result.status, 'online');
  assertEq(result.hostname, 'my-vps');
});

test('getVirtualizorSingle — no VPS', async () => {
  mockResponses = {
    'GET https://panel.example.com/index.php?api=json&apikey=test-key&apipass=test-pass&act=listvs': {
      ok: true, body: { vps: {} }
    }
  };
  try {
    await getVirtualizorSingle({ apiUrl: 'https://panel.example.com/', apiKey: 'test-key', apiHash: 'test-pass' });
    throw new Error('should have thrown');
  } catch (e) {
    assert(e.message.includes('No VPS'), 'should say no VPS');
  }
});

test('getVirtualizorSingle — url with index.php', async () => {
  mockResponses = {
    'GET https://panel.example.com/index.php?api=json&apikey=k&apipass=p&act=listvs': {
      ok: true, body: { vps: { '1': { vpsid: '1', hostname: 'h', status: '0', ips: '', ram: '512', disk_space: '10', bandwidth: '500', bandwidth_used: '0' } } }
    }
  };
  const result = await getVirtualizorSingle({ apiUrl: 'https://panel.example.com/index.php', apiKey: 'k', apiHash: 'p' });
  assertEq(result.status, 'offline');
});

test('callVirtualizorAction — includes do=1', async () => {
  mockResponses = {
    'GET https://panel.example.com/index.php?api=json&apikey=k&apipass=p&act=listvs': {
      ok: true, body: { vps: { '1': { vpsid: '1', hostname: 'h', status: '1', ips: '', ram: '512', disk_space: '10', bandwidth: '500', bandwidth_used: '0' } } }
    },
    'GET https://panel.example.com/index.php?api=json&apikey=k&apipass=p&act=restart&svs=1&do=1': {
      ok: true, body: { done: { msg: 'ok' } }
    }
  };
  await callVirtualizorAction('reboot', { apiUrl: 'https://panel.example.com', apiKey: 'k', apiHash: 'p' });
});

// ─── Proxmox API mock test ───────────────────────────────────

console.log('\n═══ Proxmox API ────────────────────────────────────');

test('getProxmoxSingle — single VM', async () => {
  mockResponses = {
    'GET https://pve.example.com:8006/api2/json/nodes': {
      ok: true, body: { data: [{ node: 'pve1' }] }
    },
    'GET https://pve.example.com:8006/api2/json/nodes/pve1/qemu': {
      ok: true, body: { data: [{ vmid: 100, name: 'web', status: 'running', maxmem: 2147483648, maxdisk: 32212254720 }] }
    },
    'GET https://pve.example.com:8006/api2/json/nodes/pve1/lxc': {
      ok: true, body: { data: [] }
    },
    'GET https://pve.example.com:8006/api2/json/nodes/pve1/qemu/100/status/current': {
      ok: true, body: { data: { vmid: 100, name: 'web', status: 'running', qmpstatus: 'running', maxmem: 2147483648, maxdisk: 32212254720, ip: '10.0.0.5' } }
    }
  };
  const config = { apiUrl: 'https://pve.example.com:8006/', apiKey: 'root@pam!token=abc' };
  const result = await getProxmoxSingle(config);
  assertEq(result.id, '100');
  assertEq(result.status, 'online');
  assertEq(result.ipaddress, '10.0.0.5');
});

test('getProxmoxSingle — url already has /api2/json', async () => {
  mockResponses = {
    'GET https://pve.example.com/api2/json/nodes': {
      ok: true, body: { data: [{ node: 'node1' }] }
    },
    'GET https://pve.example.com/api2/json/nodes/node1/qemu': {
      ok: true, body: { data: [{ vmid: 200, name: 'db', status: 'stopped', maxmem: 0, maxdisk: 0 }] }
    },
    'GET https://pve.example.com/api2/json/nodes/node1/lxc': {
      ok: true, body: { data: [] }
    },
    'GET https://pve.example.com/api2/json/nodes/node1/qemu/200/status/current': {
      ok: true, body: { data: { vmid: 200, name: 'db', status: 'stopped', maxmem: 0, maxdisk: 0 } }
    }
  };
  const result = await getProxmoxSingle({ apiUrl: 'https://pve.example.com/api2/json', apiKey: 'token' });
  assertEq(result.status, 'offline');
});

test('getProxmoxSingle — no VMs', async () => {
  mockResponses = {
    'GET https://pve.example.com:8006/api2/json/nodes': { ok: true, body: { data: [{ node: 'empty' }] } },
    'GET https://pve.example.com:8006/api2/json/nodes/empty/qemu': { ok: true, body: { data: [] } },
    'GET https://pve.example.com:8006/api2/json/nodes/empty/lxc': { ok: true, body: { data: [] } }
  };
  try {
    await getProxmoxSingle({ apiUrl: 'https://pve.example.com:8006/', apiKey: 'token' });
    throw new Error('should throw');
  } catch (e) {
    assert(e.message.includes('No VMs'), 'should say no VMs');
  }
});

// ─── Hetzner API mock test ───────────────────────────────────

console.log('\n═══ Hetzner Cloud API ──────────────────────────────');

test('getHetznerSingle — single server', async () => {
  mockResponses = {
    'GET https://api.hetzner.cloud/v1/servers': {
      ok: true, body: {
        servers: [{
          id: 123456, name: 'my-hetzner', status: 'running',
          public_net: { ipv4: { ip: '116.203.1.1' } },
          server_type: { memory: 4, disk: 40 },
          image: { name: 'ubuntu-22.04' }
        }]
      }
    }
  };
  const result = await getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud', apiKey: 'token' });
  assertEq(result.id, '123456');
  assertEq(result.status, 'online');
  assertEq(result.hostname, 'my-hetzner');
  assertEq(result.ipaddress, '116.203.1.1');
});

test('getHetznerSingle — url with /v1', async () => {
  mockResponses = {
    'GET https://api.hetzner.cloud/v1/servers': {
      ok: true, body: {
        servers: [{ id: 1, name: 's', status: 'off', public_net: { ipv4: {} }, server_type: { memory: 0, disk: 0 }, image: {} }]
      }
    }
  };
  const result = await getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud/v1', apiKey: 't' });
  assertEq(result.status, 'offline');
});

test('getHetznerSingle — no servers', async () => {
  mockResponses = { 'GET https://api.hetzner.cloud/v1/servers': { ok: true, body: { servers: [] } } };
  try {
    await getHetznerSingle({ apiUrl: 'https://api.hetzner.cloud', apiKey: 't' });
    throw new Error('should throw');
  } catch (e) {
    assert(e.message.includes('No Hetzner'), 'should say no servers');
  }
});

// ─── DigitalOcean API mock test ──────────────────────────────

console.log('\n═══ DigitalOcean API ───────────────────────────────');

test('getDOSingle — single droplet', async () => {
  mockResponses = {
    'GET https://api.digitalocean.com/v2/droplets': {
      ok: true, body: {
        droplets: [{
          id: 55555555, name: 'do-web', status: 'active', memory: 1024, disk: 25,
          networks: { v4: [{ type: 'public', ip_address: '167.99.1.1' }] },
          image: { distribution: 'Ubuntu', name: '22.04 x64' }
        }]
      }
    }
  };
  const result = await getDOSingle({ apiUrl: 'https://api.digitalocean.com', apiKey: 'token' });
  assertEq(result.id, '55555555');
  assertEq(result.status, 'online');
  assertEq(result.ipaddress, '167.99.1.1');
});

test('getDOSingle — url with /v2', async () => {
  mockResponses = {
    'GET https://api.digitalocean.com/v2/droplets': {
      ok: true, body: {
        droplets: [{ id: 1, name: 'd', status: 'off', memory: 0, disk: 0, networks: { v4: [] }, image: {} }]
      }
    }
  };
  const result = await getDOSingle({ apiUrl: 'https://api.digitalocean.com/v2', apiKey: 't' });
  assertEq(result.status, 'offline');
});

// ─── AWS Lightsail API mock test ─────────────────────────────

console.log('\n═══ AWS Lightsail API ──────────────────────────────');

test('getLightsailSingle — single instance', async () => {
  // Override fetch for Lightsail SigV4 POST
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    fetchLog.push({ url, method: opts.method });
    if (url.includes('lightsail.us-east-1.amazonaws.com') && opts.method === 'POST') {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          instances: [{
            name: 'my-lightsail',
            arn: 'arn:aws:lightsail:us-east-1:123:Instance/abc',
            state: { name: 'running' },
            publicIpAddress: '3.90.1.1',
            blueprintName: 'ubuntu_22_04',
            hardware: { ramSizeInGb: 1, disks: [{ sizeInGb: 40 }] }
          }]
        }),
        json: async () => ({
          instances: [{
            name: 'my-lightsail',
            state: { name: 'running' },
            publicIpAddress: '3.90.1.1',
            blueprintName: 'ubuntu_22_04',
            hardware: { ramSizeInGb: 1, disks: [{ sizeInGb: 40 }] }
          }]
        })
      };
    }
    return origFetch(url, opts);
  };
  
  const result = await getLightsailSingle({ apiUrl: 'us-east-1', apiKey: 'AKID1234', apiHash: 'secret' });
  assertEq(result.id, 'my-lightsail');
  assertEq(result.status, 'online');
  assertEq(result.ipaddress, '3.90.1.1');
  // Verify SigV4 was used
  assert(fetchLog.some(f => f.url.includes('lightsail.us-east-1.amazonaws.com')), 'should call Lightsail endpoint');
  const lightsailCall = fetchLog.find(f => f.url.includes('lightsail'));
  assert(lightsailCall.method === 'POST', 'should use POST');
  
  global.fetch = origFetch;
});

// ─── AWS EC2 API mock test ─────────────────────────────────────

console.log('\n═══ AWS EC2 API ─────────────────────────────────────');

// Load EC2 functions
eval(extractFunc('parseAWSRegion'));
eval(extractFunc('parseEC2RegionAndInstance'));
eval(extractFunc('signEC2Request'));
eval(extractFunc('requireEC2Config'));
eval(extractFunc('normalizeEC2Server'));
eval(extractFunc('fetchEC2'));
eval(extractFunc('getEC2Single'));
eval(extractFunc('callEC2Action'));

test('parseEC2RegionAndInstance — various inputs', () => {
  assertEq(parseAWSRegion('ap-northeast-2'), 'ap-northeast-2');
  assertEq(parseAWSRegion('https://ec2.ap-northeast-2.amazonaws.com'), 'ap-northeast-2');
  
  const res1 = parseEC2RegionAndInstance('https://ec2.ap-northeast-2.amazonaws.com/i-0123456789abcdef0');
  assertEq(res1.region, 'ap-northeast-2');
  assertEq(res1.targetInstanceId, 'i-0123456789abcdef0');

  const res2 = parseEC2RegionAndInstance('us-west-2/i-999');
  assertEq(res2.region, 'us-west-2');
  assertEq(res2.targetInstanceId, 'i-999');
});

test('getEC2Single — single instance', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    fetchLog.push({ url, method: opts.method, body: opts.body });
    if (url.includes('ec2.us-east-1.amazonaws.com')) {
      return {
        ok: true, status: 200,
        text: async () => `<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <reservationSet>
    <item>
      <instancesSet>
        <item>
          <instanceId>i-0123456789abcdef0</instanceId>
          <imageId>ami-0abcdef1234567890</imageId>
          <instanceState>
            <code>16</code>
            <name>running</name>
          </instanceState>
          <privateDnsName>ip-10-0-0-5.ec2.internal</privateDnsName>
          <dnsName>ec2-54-1-2-3.compute-1.amazonaws.com</dnsName>
          <ipAddress>54.1.2.3</ipAddress>
          <instanceType>t3.micro</instanceType>
          <tagSet>
            <item><key>Name</key><value>my-ec2-server</value></item>
          </tagSet>
        </item>
      </instancesSet>
    </item>
  </reservationSet>
</DescribeInstancesResponse>`,
        json: async () => ({})
      };
    }
    return origFetch(url, opts);
  };

  const result = await getEC2Single({ apiUrl: 'us-east-1', apiKey: 'AKID1234', apiHash: 'secret' });
  assertEq(result.id, 'i-0123456789abcdef0');
  assertEq(result.status, 'online');
  assertEq(result.hostname, 'my-ec2-server');
  assertEq(result.ipaddress, '54.1.2.3');
  assert(result.os.includes('t3.micro'), 'should show instance type');
  assert(fetchLog.some(f => f.url.includes('ec2.us-east-1.amazonaws.com')), 'should call EC2 endpoint');

  global.fetch = origFetch;
});

test('normalizeEC2Server — stopped', () => {
  const result = normalizeEC2Server({
    InstanceId: 'i-stop',
    State: { Name: 'stopped' },
    PublicIpAddress: '',
    InstanceType: '',
    Tags: []
  });
  assertEq(result.status, 'offline');
  assertEq(result.hostname, 'i-stop'); // fallback to InstanceId when no Name tag
});

// ─── Result ──────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
