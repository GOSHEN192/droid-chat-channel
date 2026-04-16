#!/usr/bin/env node
/**
 * droid-chat-channel — 将 Droid CLI 桥接到聊天平台
 *
 * 用法:
 *   node index.js --platform telegram
 *   node index.js --platform whatsapp
 *   node index.js --config ./config.json
 *
 * 支持平台: telegram, whatsapp
 * 扩展: 在 adapters/ 下添加新文件，注册到下面的 PLATFORM_MAP 即可
 */

const fs = require('fs');
const path = require('path');

const PLATFORM_MAP = {
  telegram: './adapters/telegram',
  whatsapp: './adapters/whatsapp',
  // 预留: feishu, wechat, slack, discord, dingtalk, line
};

function loadConfig() {
  // 1. --config <path>
  const configIdx = process.argv.indexOf('--config');
  if (configIdx !== -1 && process.argv[configIdx + 1]) {
    const p = path.resolve(process.argv[configIdx + 1]);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    console.error(`Config file not found: ${p}`);
    process.exit(1);
  }

  // 2. config.json in project root
  const localConfig = path.join(__dirname, 'config.json');
  if (fs.existsSync(localConfig)) return JSON.parse(fs.readFileSync(localConfig, 'utf8'));

  // 3. Build from env vars
  const platform = getArg('--platform') || process.env.PLATFORM || 'telegram';
  const config = {
    platform,
    defaultModel: process.env.DROID_MODEL || 'custom:minimax-m2.7',
    droidPath: process.env.DROID_PATH || 'droid',
    timeout: parseInt(process.env.DROID_TIMEOUT) || 120000,
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  };

  // Context map from env
  if (process.env.CONTEXT_MAP) {
    try { config.contextMap = JSON.parse(process.env.CONTEXT_MAP); } catch (e) {
      console.error('Invalid CONTEXT_MAP JSON:', e.message);
    }
  }

  // Build DROID_ENV with explicit PATH
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  config.droidEnv = {
    ...process.env,
    PATH: process.env.PATH || `/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
  };

  return config;
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  const config = loadConfig();
  const platform = getArg('--platform') || config.platform || 'telegram';

  if (!PLATFORM_MAP[platform]) {
    console.error(`Unknown platform: ${platform}`);
    console.error(`Available: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  console.log(`Loading adapter: ${platform}`);
  const Adapter = require(PLATFORM_MAP[platform]);
  const adapter = new Adapter(config);

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n[${signal}] Shutting down...`);
    if (adapter.stop) adapter.stop(signal);
    setTimeout(() => process.exit(0), 1000);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await adapter.start();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
