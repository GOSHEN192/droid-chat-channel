#!/usr/bin/env node
/**
 * 一键配置脚本
 *
 * 用法: node setup.js
 *
 * 交互式引导用户配置：
 * 1. 选择平台
 * 2. 填写 Token / 凭证
 * 3. 配置 Droid 路径和模型
 * 4. 生成 .env 文件
 * 5. 生成 systemd service 文件（可选）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

async function main() {
  console.log('='.repeat(50));
  console.log('  droid-chat-channel Setup');
  console.log('='.repeat(50));
  console.log();

  // 1. Platform
  console.log('Available platforms: telegram, whatsapp');
  const platform = (await question('Platform [telegram]: ') || 'telegram').toLowerCase();
  if (!['telegram', 'whatsapp'].includes(platform)) {
    console.error('Unsupported platform.'); process.exit(1);
  }

  // 2. Credentials
  let botToken = '';
  if (platform === 'telegram') {
    botToken = await question('Telegram Bot Token (from @BotFather): ');
    if (!botToken) { console.error('Token is required.'); process.exit(1); }
  } else {
    console.log('WhatsApp will show a QR code on first start. No token needed.');
  }

  // 3. Allowed users
  const allowedUsers = await question('Allowed user IDs/phones (comma separated, empty = all): ');

  // 4. Droid
  const droidPath = (await question('Droid CLI path [droid]: ') || 'droid');
  const droidModel = (await question('Default model [custom:minimax-m2.7]: ') || 'custom:minimax-m2.7');
  const timeout = (await question('Timeout seconds [120]: ') || '120');

  // 5. Data dir
  const dataDir = (await question('Data directory [./data]: ') || './data');

  // 6. API Keys
  const minimaxKey = await question('MiniMax API Key (optional): ');
  const zaiKey = await question('ZAI/GLM API Key (optional): ');
  const xfyunKey = await question('XFYUN API Key (optional): ');

  // 7. Context map
  console.log('\nContext routing (map group chats to workspaces):');
  console.log('Format: groupChatId=/path/to/workspace,Label');
  console.log('Example: -123456=/home/user/family,Family');
  console.log('Leave empty to skip.');
  const contextInput = await question('Context mappings (semicolon separated): ');
  let contextMap = '';
  if (contextInput) {
    const groups = {};
    contextInput.split(';').forEach(item => {
      const [mapping, label] = item.split(',');
      const [chatId, cwd] = mapping.split('=');
      if (chatId && cwd) groups[chatId.trim()] = { cwd: cwd.trim(), label: (label || 'Group').trim() };
    });
    const privateCwd = await question(`Private chat workspace [${process.cwd()}]: `) || process.cwd();
    const privateLabel = await question('Private chat label [Default]: ') || 'Default';
    contextMap = JSON.stringify({ groups, private: { cwd: privateCwd, label: privateLabel } });
  }

  // Write .env
  const envContent = [
    `PLATFORM=${platform}`,
    platform === 'telegram' ? `TELEGRAM_BOT_TOKEN=${botToken}` : '',
    allowedUsers ? `ALLOWED_USERS=${allowedUsers}` : '',
    `DROID_PATH=${droidPath}`,
    `DROID_MODEL=${droidModel}`,
    `DROID_TIMEOUT=${timeout}`,
    `DATA_DIR=${dataDir}`,
    minimaxKey ? `MINIMAX_API_KEY=${minimaxKey}` : '',
    zaiKey ? `ZAI_API_KEY=${zaiKey}` : '',
    xfyunKey ? `XFYUN_API_KEY=${xfyunKey}` : '',
    contextMap ? `CONTEXT_MAP=${contextMap}` : '',
  ].filter(Boolean).join('\n') + '\n';

  const envPath = path.join(__dirname, 'config', '.env');
  if (!fs.existsSync(path.join(__dirname, 'config'))) fs.mkdirSync(path.join(__dirname, 'config'), { recursive: true });
  fs.writeFileSync(envPath, envContent);
  console.log(`\n✅ Config saved to ${envPath}`);

  // Generate systemd service
  const wantSystemd = (await question('\nGenerate systemd service? [y/N]: ')).toLowerCase() === 'y';
  if (wantSystemd) {
    const serviceName = `droid-chat-${platform}`;
    const nodePath = process.execPath;

    let tpl = fs.readFileSync(path.join(__dirname, 'templates', 'droid-chat-channel.service.tpl'), 'utf8');
    const replacements = {
      '%NAME%': serviceName,
      '%PLATFORM%': platform,
      '%USER%': process.env.USER || 'root',
      '%WORKDIR%': path.resolve(__dirname),
      '%TELEGRAM_BOT_TOKEN%': botToken,
      '%ALLOWED_USERS%': allowedUsers || '',
      '%DROID_MODEL%': droidModel,
      '%DROID_PATH%': droidPath,
      '%DROID_TIMEOUT%': timeout,
      '%DATA_DIR%': path.resolve(dataDir),
      '%MINIMAX_API_KEY%': minimaxKey || '',
      '%ZAI_API_KEY%': zaiKey || '',
      '%XFYUN_API_KEY%': xfyunKey || '',
      '%CONTEXT_MAP%': contextMap || '',
      '%NODE_PATH%': nodePath,
    };
    for (const [k, v] of Object.entries(replacements)) {
      tpl = tpl.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v);
    }

    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    console.log(`\nRun the following commands to install the service:\n`);
    console.log(`  sudo tee ${servicePath} << 'SERVICEEOF'`);
    console.log(tpl);
    console.log('SERVICEOF');
    console.log(`  sudo systemctl daemon-reload`);
    console.log(`  sudo systemctl enable ${serviceName}`);
    console.log(`  sudo systemctl start ${serviceName}`);
    console.log(`\nLogs: journalctl -u ${serviceName} -f`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Setup complete!');
  console.log('='.repeat(50));
  console.log(`\nStart manually:\n  node index.js --platform ${platform}`);
  console.log(`\nOr with .env:\n  node index.js`);

  rl.close();
}

main().catch(err => { console.error(err); rl.close(); process.exit(1); });
