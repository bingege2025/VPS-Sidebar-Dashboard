const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadShared() {
  const context = {
    console,
    URL,
    Date
  };
  vm.createContext(context);
  const sharedPath = path.join(__dirname, '..', 'shared.js');
  vm.runInContext(fs.readFileSync(sharedPath, 'utf8'), context, { filename: sharedPath });
  return context;
}

function run() {
  const ctx = loadShared();

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('solusvm', 'panel.example.com'),
    'https://panel.example.com/api/client/command.php',
    'SolusVM v1 should accept a bare host'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('virtualizor', 'https://panel.example.com'),
    'https://panel.example.com/index.php',
    'Virtualizor should append index.php'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('proxmox', 'https://pve.example.com:8006'),
    'https://pve.example.com:8006/api2/json',
    'Proxmox should append api2/json'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('solusvm2', 'panel.example.com/servers/123'),
    'https://panel.example.com/api/v1/servers/123',
    'SolusVM 2 should accept a server path without api/v1'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('proxmox', 'https://pve.example.com:8006/nodes/pve/qemu/100/status/current'),
    'https://pve.example.com:8006/api2/json/nodes/pve/qemu/100/status/current',
    'Proxmox should insert api2/json before a nodes path'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('hetzner', ''),
    'https://api.hetzner.cloud/v1',
    'Hetzner should have a default API endpoint'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('hetzner', '42'),
    'https://api.hetzner.cloud/v1/servers/42',
    'Hetzner should accept a server ID'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('digitalocean', '99'),
    'https://api.digitalocean.com/v2/droplets/99',
    'DigitalOcean should accept a droplet ID'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('digitalocean', 'https://api.digitalocean.com/droplets/99'),
    'https://api.digitalocean.com/v2/droplets/99',
    'DigitalOcean should insert v2 before a droplet path'
  );

  assert.strictEqual(
    ctx.normalizeProviderEndpoint('ec2', 'https://ec2.us-east-1.amazonaws.com/i-0abc123def4567890'),
    'us-east-1/i-0abc123def4567890',
    'EC2 should extract region and instance ID from a pasted endpoint'
  );

  assert.strictEqual(ctx.providerNeedsApiHash('digitalocean'), false, 'DigitalOcean should not need Hash');
  assert.strictEqual(ctx.providerNeedsApiHash('solusvm'), true, 'SolusVM v1 should need Hash');
  assert.strictEqual(ctx.isValidProviderEndpoint('ec2', 'us-east-1/i-0abc123def4567890'), true, 'EC2 region/instance should validate');
  assert.strictEqual(ctx.isValidProviderEndpoint('ec2', 'not-a-region'), false, 'Invalid AWS region should fail');

  console.log('provider-endpoint-normalizer tests passed');
}

run();
