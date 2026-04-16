/**
 * WhatsApp 适配器 — 使用 @whiskeysockets/baileys
 *
 * 环境变量:
 *   WHATSAPP_ALLOWED_USERS  (可选, 逗号分隔的手机号如 8613800138000)
 *
 * 首次启动需要扫码认证，auth 信息保存在 data/whatsapp-auth/ 目录
 */

const fs = require('fs');
const path = require('path');
const DroidExec = require('../core/droid-exec');
const SessionManager = require('../core/session');
const ContextRouter = require('../core/context');
const { ReminderManager, localDateTimeStr } = require('../core/reminders');
const { CUSTOM_MODELS, BUILTIN_MODELS, MODEL_REASONING } = require('../core/models');
const { parseRemindArgs, formatRemindResult, buildHelpText } = require('../core/commands');

const ALL_MODELS = { ...CUSTOM_MODELS, ...BUILTIN_MODELS };

class WhatsAppAdapter {
  constructor(config) {
    this.config = config;
    this.sock = null;

    this.allowedUsers = process.env.WHATSAPP_ALLOWED_USERS
      ? process.env.WHATSAPP_ALLOWED_USERS.split(',').map(s => s.trim())
      : null;

    const dataDir = config.dataDir || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.authDir = path.join(dataDir, 'whatsapp-auth');
    if (!fs.existsSync(this.authDir)) fs.mkdirSync(this.authDir, { recursive: true });

    this.context = new ContextRouter(config.contextMap);
    this.droid = new DroidExec({
      droidPath: config.droidPath || 'droid',
      env: config.droidEnv || process.env,
      timeout: config.timeout || 120000,
    });
    this.sessions = new SessionManager({
      filePath: path.join(dataDir, 'sessions.json'),
      defaultModel: config.defaultModel || 'custom:minimax-m2.7',
    });
    this.reminders = new ReminderManager({
      filePath: path.join(dataDir, 'reminders.json'),
      sendMessage: (chatId, text) => this.sendMessage(chatId, text),
      callDroid: (prompt, session, cwd) => this.droid.call(prompt, session, cwd),
      getCwd: (chatId) => this.context.getCwd(chatId),
      defaultModel: config.defaultModel || 'custom:minimax-m2.7',
    });
  }

  _isAllowed(jid) {
    if (!this.allowedUsers) return true;
    const phone = jid.split('@')[0];
    return this.allowedUsers.includes(phone);
  }

  _chatId(jid) {
    // Normalize: use jid directly as chatId for context routing
    // Group JIDs look like: 123456789-1234567890@g.us
    // Private JIDs look like: 8613800138000@s.whatsapp.net
    return jid;
  }

  _userId(jid) {
    return jid.split('@')[0];
  }

  async sendMessage(chatId, text) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    // Split long messages (WhatsApp limit ~65536, but keep 4000 for consistency)
    if (text.length > 4000) {
      for (let i = 0; i < text.length; i += 4000) {
        await this.sock.sendMessage(chatId, { text: text.slice(i, i + 4000) });
      }
    } else {
      await this.sock.sendMessage(chatId, { text });
    }
  }

  async sendTyping(chatId) {
    if (!this.sock) return;
    try { await this.sock.sendPresenceUpdate('composing', chatId); } catch (e) {}
  }

  async stopTyping(chatId) {
    if (!this.sock) return;
    try { await this.sock.sendPresenceUpdate('paused', chatId); } catch (e) {}
  }

  _parseCommand(text) {
    if (!text.startsWith('/')) return null;
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    return { cmd, args, raw: text };
  }

  async _handleCommand(cmd, args, chatId, userId) {
    const s = this.sessions.get(userId, chatId);

    switch (cmd) {
      case '/start':
        await this.sendMessage(chatId, `Welcome to Droid Bot!\n\nContext: ${this.context.getLabel(chatId)}\nSend a message to chat.\n/help for commands.`);
        break;

      case '/help':
        await this.sendMessage(chatId, buildHelpText(this.context.getLabel(chatId)));
        break;

      case '/new':
        this.sessions.clearSessionId(userId, chatId);
        await this.sendMessage(chatId, `Session cleared (${this.context.getLabel(chatId)}).`);
        break;

      case '/session':
        await this.sendMessage(chatId,
          `Context: ${this.context.getLabel(chatId)}\n` +
          `Session: ${s.sessionId || 'None'}\n` +
          `Model: ${s.model}\nAuto: ${s.autoLevel}\n` +
          `Spec: ${s.useSpec ? 'On' : 'Off'}\nMission: ${s.useMission ? 'On' : 'Off'}\n` +
          `Reasoning: ${s.reasoning || 'Default'}`
        );
        break;

      case '/stop':
        if (!s.processing) { await this.sendMessage(chatId, 'No active task.'); return; }
        s.processing = false; s.sessionId = null; this.sessions.save();
        await this.sendMessage(chatId, 'Stopped, session reset.');
        break;

      case '/model': {
        if (!args.length) {
          const cl = Object.entries(CUSTOM_MODELS).map(([k, v]) => `  ${k} ${v === s.model ? '✅' : ''}`).join('\n');
          const bl = Object.entries(BUILTIN_MODELS).map(([k, v]) => `  ${k} ${v === s.model ? '✅' : ''}`).join('\n');
          await this.sendMessage(chatId, `Current: ${s.model}\n\nCustom:\n${cl}\n\nBuilt-in:\n${bl}\n\nUsage: /model <name>`);
          return;
        }
        const m = args[0].toLowerCase();
        if (ALL_MODELS[m]) {
          s.sessionId = null; s.model = ALL_MODELS[m]; this.sessions.save();
          await this.sendMessage(chatId, `Switched: ${m} (${s.model})`);
        } else await this.sendMessage(chatId, `Unknown: ${m}\nAvailable: ${Object.keys(ALL_MODELS).join(', ')}`);
        break;
      }

      case '/auto': {
        if (!args.length) { await this.sendMessage(chatId, `Current: ${s.autoLevel}\nUsage: /auto <low|medium|high>`); return; }
        const l = args[0].toLowerCase();
        if (['low', 'medium', 'high'].includes(l)) { s.autoLevel = l; await this.sendMessage(chatId, `Permission: ${l}`); }
        else await this.sendMessage(chatId, `Unknown: ${l}`);
        break;
      }

      case '/timeout': {
        if (!args.length) { await this.sendMessage(chatId, `Current: ${this.droid.timeout / 1000}s\nUsage: /timeout <10-600>`); return; }
        const sec = parseInt(args[0]);
        if (isNaN(sec) || sec < 10 || sec > 600) { await this.sendMessage(chatId, 'Range: 10-600'); return; }
        this.droid.setTimeout(sec * 1000);
        await this.sendMessage(chatId, `Timeout: ${sec}s`);
        break;
      }

      case '/tools': {
        await this.sendMessage(chatId, 'Querying...');
        try {
          const { stdout, stderr } = await this.droid.runCli(
            ['exec', '-m', s.model, '--auto', s.autoLevel, '--list-tools', '-o', 'json'], 15000
          );
          const out = (stdout || stderr).trim();
          try {
            const tools = JSON.parse(out);
            const lines = tools.map(t => `${t.currentlyAllowed ? '✅' : '❌'} ${t.displayName}`);
            const allowed = tools.filter(t => t.currentlyAllowed).length;
            await this.sendMessage(chatId, `Tools (${allowed}/${tools.length}):\n\n${lines.join('\n')}`);
          } catch (e) { await this.sendMessage(chatId, out.slice(0, 4000) || 'Failed'); }
        } catch (e) { await this.sendMessage(chatId, `Failed: ${e.message}`); }
        break;
      }

      case '/version': {
        try {
          const { stdout, stderr } = await this.droid.runCli(['--version'], 5000);
          await this.sendMessage(chatId, `Droid CLI: ${(stdout || stderr).trim()}`);
        } catch (e) { await this.sendMessage(chatId, `Failed: ${e.message}`); }
        break;
      }

      case '/spec': {
        if (!args.length) { await this.sendMessage(chatId, `Spec: ${s.useSpec ? '✅ On' : '❌ Off'}\nUsage: /spec on|off`); return; }
        const v = args[0].toLowerCase();
        if (v === 'on') { s.useSpec = true; s.sessionId = null; this.sessions.save(); await this.sendMessage(chatId, '✅ Spec on (session cleared)'); }
        else if (v === 'off') { s.useSpec = false; this.sessions.save(); await this.sendMessage(chatId, '❌ Spec off'); }
        break;
      }

      case '/mission': {
        if (!args.length) { await this.sendMessage(chatId, `Mission: ${s.useMission ? '✅ On' : '❌ Off'}\nUsage: /mission on|off`); return; }
        const v = args[0].toLowerCase();
        if (v === 'on') { s.useMission = true; s.sessionId = null; this.sessions.save(); await this.sendMessage(chatId, '✅ Mission on (auto high)'); }
        else if (v === 'off') { s.useMission = false; this.sessions.save(); await this.sendMessage(chatId, '❌ Mission off'); }
        break;
      }

      case '/reason': {
        const supported = MODEL_REASONING[s.model] || [];
        if (!args.length) {
          let info = `Reasoning: ${s.reasoning || 'Default'}\nModel: ${s.model}\n`;
          info += supported.length > 0 ? `Supported: ${supported.join(', ')}` : 'Not adjustable';
          info += '\n\nUsage: /reason <level> | /reason default';
          await this.sendMessage(chatId, info); return;
        }
        const v = args[0].toLowerCase();
        if (v === 'default' || v === 'reset') { s.reasoning = null; this.sessions.save(); await this.sendMessage(chatId, 'Reset.'); return; }
        if (supported.length === 0) { await this.sendMessage(chatId, `Model ${s.model} does not support this.`); return; }
        if (!supported.includes(v)) { await this.sendMessage(chatId, `Not supported.\nSupported: ${supported.join(', ')}`); return; }
        s.reasoning = v; this.sessions.save(); await this.sendMessage(chatId, `Reasoning: ${v}`);
        break;
      }

      case '/status':
        await this.sendMessage(chatId,
          `Context: ${this.context.getLabel(chatId)}\n` +
          `CWD: ${this.context.getCwd(chatId)}\n` +
          `Model: ${s.model}\nAuto: ${s.autoLevel}\n` +
          `Session: ${s.sessionId ? s.sessionId.slice(0, 8) + '...' : 'New'}\n` +
          `Spec: ${s.useSpec ? 'On' : 'Off'}\nMission: ${s.useMission ? 'On' : 'Off'}\n` +
          `Reasoning: ${s.reasoning || 'Default'}\nTimeout: ${this.droid.timeout / 1000}s\n` +
          `Reminders: ${this.reminders.getForChat(chatId).length}\n` +
          `Processing: ${s.processing ? 'Yes' : 'No'}`
        );
        break;

      case '/remind': {
        if (args.length < 2) {
          await this.sendMessage(chatId,
            'Usage:\n/remind HH:MM content\n/remind YYYY-MM-DD HH:MM content\n' +
            '/remind daily HH:MM content\n/remind 30m content\n\n' +
            'Exec task:\n/remind 30m exec:check server status'
          ); return;
        }
        const parsed = parseRemindArgs(args);
        if (parsed.error) { await this.sendMessage(chatId, `Error: ${parsed.error}`); return; }
        const r = this.reminders.add(chatId, parsed.time, parsed.text, parsed.type, parsed.exec, parsed.day);
        await this.sendMessage(chatId, formatRemindResult(r, this.context.getLabel(chatId)));
        break;
      }

      case '/list': {
        const r = this.reminders.getForChat(chatId);
        if (!r.length) { await this.sendMessage(chatId, 'No reminders.'); return; }
        const lines = r.map((x, i) => {
          const cycle = x.type === 'daily' ? 'Daily' : x.type === 'weekly' ? 'Weekly' :
            (x.type === 'monthly' ? `Monthly ${x.day}th` : 'Once');
          return `${i + 1}. [${cycle}] ${x.exec ? '[Task]' : '[Reminder]'} ${x.time} - ${x.text} (${x.id})`;
        });
        await this.sendMessage(chatId, `Reminders:\n\n${lines.join('\n')}\n\nDelete: /delete <ID or #>`);
        break;
      }

      case '/delete': {
        if (!args.length) { await this.sendMessage(chatId, 'Usage: /delete <ID or #>'); return; }
        const cr = this.reminders.getForChat(chatId);
        const idx = parseInt(args[0]) - 1;
        if (idx >= 0 && idx < cr.length) { const t = cr[idx]; this.reminders.delete(t.id); await this.sendMessage(chatId, `Deleted: ${t.time} - ${t.text}`); return; }
        const t = cr.find(x => x.id === args[0]);
        if (t) { this.reminders.delete(t.id); await this.sendMessage(chatId, `Deleted: ${t.time} - ${t.text}`); }
        else await this.sendMessage(chatId, 'Not found. /list to view.');
        break;
      }

      // MCP commands
      case '/mcp': {
        const sub = (args[0] || '').toLowerCase();
        if (!sub || sub === 'help') {
          await this.sendMessage(chatId, 'MCP:\n  /mcp list\n  /mcp add <name> <url>\n  /mcp remove <name>');
          return;
        }
        if (sub === 'list') {
          const cwd = this.context.getCwd(chatId);
          let mcps = [];
          const pmp = path.join(cwd, '.mcp.json');
          if (fs.existsSync(pmp)) { try { const d = JSON.parse(fs.readFileSync(pmp, 'utf8')); if (d.mcpServers) for (const [n, c] of Object.entries(d.mcpServers)) mcps.push({ n, u: c.url || '-' }); } catch (e) {} }
          if (!mcps.length) { await this.sendMessage(chatId, 'No MCP configured.'); return; }
          await this.sendMessage(chatId, `MCP:\n\n${mcps.map(m => `• ${m.n} ${m.u}`).join('\n')}`);
          return;
        }
        if (sub === 'add') {
          if (args.length < 3) { await this.sendMessage(chatId, '/mcp add <name> <url>'); return; }
          await this.sendMessage(chatId, `Adding: ${args[1]}...`);
          try {
            const { code, stdout, stderr } = await this.droid.runCli(['mcp', 'add', args[1], args[2], '--type', 'http'], 15000);
            await this.sendMessage(chatId, code === 0 ? `✅ Added.` : `❌ Failed.`);
          } catch (e) { await this.sendMessage(chatId, `❌ Error: ${e.message}`); }
          return;
        }
        if (sub === 'remove' || sub === 'rm') {
          if (args.length < 2) { await this.sendMessage(chatId, '/mcp remove <name>'); return; }
          try {
            const { code } = await this.droid.runCli(['mcp', 'remove', args[1]], 15000);
            await this.sendMessage(chatId, code === 0 ? `✅ Removed.` : `❌ Failed.`);
          } catch (e) { await this.sendMessage(chatId, `❌ Error: ${e.message}`); }
          return;
        }
        break;
      }

      // Plugin commands
      case '/plugin': {
        const sub = (args[0] || '').toLowerCase();
        if (!sub || sub === 'help') {
          await this.sendMessage(chatId, 'Plugin:\n  /plugin list\n  /plugin install <name>\n  /plugin remove <name>\n  /plugin update');
          return;
        }
        if (sub === 'list') {
          try { const { stdout, stderr } = await this.droid.runCli(['plugin', 'list'], 15000); await this.sendMessage(chatId, `Plugins:\n\n${(stdout || stderr).trim() || 'None'}`); } catch (e) { await this.sendMessage(chatId, `Failed: ${e.message}`); }
          return;
        }
        if (sub === 'install' || sub === 'i') {
          if (args.length < 2) { await this.sendMessage(chatId, '/plugin install <name>'); return; }
          await this.sendMessage(chatId, `Installing: ${args[1]}...`);
          try { const { code, stdout, stderr } = await this.droid.runCli(['plugin', 'install', args[1]], 60000); await this.sendMessage(chatId, code === 0 ? '✅ Installed.' : '❌ Failed.'); } catch (e) { await this.sendMessage(chatId, `❌ Error: ${e.message}`); }
          return;
        }
        if (sub === 'remove' || sub === 'rm') {
          if (args.length < 2) { await this.sendMessage(chatId, '/plugin remove <name>'); return; }
          try { const { code } = await this.droid.runCli(['plugin', 'uninstall', args[1]], 30000); await this.sendMessage(chatId, code === 0 ? '✅ Removed.' : '❌ Failed.'); } catch (e) { await this.sendMessage(chatId, `❌ Error: ${e.message}`); }
          return;
        }
        break;
      }

      default:
        await this.sendMessage(chatId, `Unknown command: ${cmd}\n/help for available commands.`);
    }
  }

  async _handleMessage(chatId, userId, text) {
    // Check for command
    if (text.startsWith('/')) {
      const parsed = this._parseCommand(text);
      if (parsed) {
        await this._handleCommand(parsed.cmd, parsed.args, chatId, userId);
        return;
      }
    }

    // Regular message — chat with Droid
    const s = this.sessions.get(userId, chatId);
    if (s.processing) { await this.sendMessage(chatId, '⏳ Previous request still processing...'); return; }
    console.log(`[MSG] ${userId} @ ${this.context.getLabel(chatId)}: ${text}`);
    s.processing = true;
    const cwd = this.context.getCwd(chatId);
    let typingInterval = null;
    try {
      await this.sendTyping(chatId);
      typingInterval = setInterval(() => this.sendTyping(chatId), 5000);
      const { stdout } = await this.droid.call(text, s, cwd);
      const p = this.droid.parse(stdout);
      if (p.sessionId) { s.sessionId = p.sessionId; this.sessions.save(); }
      await this.sendMessage(chatId, p.text);
      console.log(`[REPLY] ${userId}: ${p.text.slice(0, 100)}...`);
    } catch (e) {
      console.error('[ERROR]', e.message);
      await this.sendMessage(chatId, `Error: ${e.message.slice(0, 500)}`);
    } finally {
      if (typingInterval) clearInterval(typingInterval);
      await this.stopTyping(chatId);
      s.processing = false;
    }
  }

  async start() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
    const P = require('pino');

    this.reminders.start();

    console.log('='.repeat(50));
    console.log('WhatsApp + Droid Bot');
    console.log('='.repeat(50));

    const { version } = await fetchLatestBaileysVersion();
    console.log(`Baileys version: ${version}`);

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: P({ level: 'silent' }),
      version,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('\n[QR] Scan the QR code above with WhatsApp > Linked Devices');
      }
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[WA] Connection closed. Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) {
          await this.start(); // Reconnect
        } else {
          console.error('[WA] Logged out. Delete whatsapp-auth/ directory and restart to re-authenticate.');
          process.exit(1);
        }
      }
      if (connection === 'open') {
        console.log('[WA] Connected!');
        console.log(`Model: ${this.config.defaultModel}`);
        console.log(`Private CWD: ${this.context.privateCwd}`);
        console.log('='.repeat(50));
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!text) return;

      const chatId = msg.key.remoteJid;
      const userId = this._userId(chatId);

      // For group messages, only respond when mentioned or to commands
      if (chatId.endsWith('@g.us')) {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const botJid = this.sock.user?.id;
        if (!text.startsWith('/') && !mentioned.includes(botJid)) return;
      }

      if (!this._isAllowed(chatId)) return;

      await this._handleMessage(chatId, userId, text);
    });

    console.log('[WA] Waiting for authentication...');
  }
}

module.exports = WhatsAppAdapter;
