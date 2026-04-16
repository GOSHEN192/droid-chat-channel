/**
 * Telegram 适配器 — 使用 Telegraf 框架
 *
 * 环境变量:
 *   TELEGRAM_BOT_TOKEN  (必填)
 *   ALLOWED_USERS       (可选, 逗号分隔的 user ID)
 */

const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');
const DroidExec = require('../core/droid-exec');
const SessionManager = require('../core/session');
const ContextRouter = require('../core/context');
const { ReminderManager, localDateTimeStr } = require('../core/reminders');
const { CUSTOM_MODELS, BUILTIN_MODELS, MODEL_REASONING } = require('../core/models');
const { parseRemindArgs, formatRemindResult, buildHelpText } = require('../core/commands');

const ALL_MODELS = { ...CUSTOM_MODELS, ...BUILTIN_MODELS };

class TelegramAdapter {
  constructor(config) {
    this.config = config;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

    this.bot = new Telegraf(token);
    this.allowedUsers = process.env.ALLOWED_USERS
      ? process.env.ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
      : null;

    const dataDir = config.dataDir || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

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
      sendMessage: (chatId, text) => this.bot.telegram.sendMessage(chatId, text),
      callDroid: (prompt, session, cwd) => this.droid.call(prompt, session, cwd),
      getCwd: (chatId) => this.context.getCwd(chatId),
      defaultModel: config.defaultModel || 'custom:minimax-m2.7',
    });

    this._registerCommands();
    this._registerMessageHandler();
  }

  _isAllowed(userId) {
    if (!this.allowedUsers) return true;
    return this.allowedUsers.includes(userId);
  }

  _cid(ctx) { return String(ctx.chat.id); }

  _registerCommands() {
    const bot = this.bot;

    // /start
    bot.command('start', async ctx => {
      if (!this._isAllowed(ctx.from.id)) return;
      const label = this.context.getLabel(this._cid(ctx));
      await ctx.reply(`Welcome to Droid Bot!\n\nContext: ${label}\nSend a message to chat.\n/help for commands.`);
    });

    // /help
    bot.command('help', async ctx => {
      if (!this._isAllowed(ctx.from.id)) return;
      await ctx.reply(buildHelpText(this.context.getLabel(this._cid(ctx))));
    });

    // /new
    bot.command('new', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      this.sessions.clearSessionId(uid, this._cid(ctx));
      await ctx.reply(`Session cleared (${this.context.getLabel(this._cid(ctx))}).`);
    });

    // /session
    bot.command('session', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      await ctx.reply(
        `Context: ${this.context.getLabel(this._cid(ctx))}\n` +
        `Session: ${s.sessionId || 'None'}\n` +
        `Model: ${s.model}\nAuto: ${s.autoLevel}\n` +
        `Spec: ${s.useSpec ? 'On' : 'Off'}\nMission: ${s.useMission ? 'On' : 'Off'}\n` +
        `Reasoning: ${s.reasoning || 'Default'}`
      );
    });

    // /stop
    bot.command('stop', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      if (!s.processing) { await ctx.reply('No active task.'); return; }
      s.processing = false; s.sessionId = null; this.sessions.save();
      await ctx.reply('Stopped, session reset.');
    });

    // /model
    bot.command('model', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) {
        const cl = Object.entries(CUSTOM_MODELS).map(([k, v]) => `  ${k} ${v === s.model ? '✅' : ''}`).join('\n');
        const bl = Object.entries(BUILTIN_MODELS).map(([k, v]) => `  ${k} ${v === s.model ? '✅' : ''}`).join('\n');
        await ctx.reply(`Current: ${s.model}\n\nCustom:\n${cl}\n\nBuilt-in:\n${bl}\n\nUsage: /model <name>`);
        return;
      }
      const m = args[0].toLowerCase();
      if (ALL_MODELS[m]) {
        s.sessionId = null; s.model = ALL_MODELS[m]; this.sessions.save();
        await ctx.reply(`Switched: ${m} (${s.model})`);
      } else await ctx.reply(`Unknown: ${m}\nAvailable: ${Object.keys(ALL_MODELS).join(', ')}`);
    });

    // /auto
    bot.command('auto', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) { await ctx.reply(`Current: ${s.autoLevel}\nUsage: /auto <low|medium|high>`); return; }
      const l = args[0].toLowerCase();
      if (['low', 'medium', 'high'].includes(l)) { s.autoLevel = l; await ctx.reply(`Permission: ${l}`); }
      else await ctx.reply(`Unknown: ${l}`);
    });

    // /timeout
    bot.command('timeout', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) { await ctx.reply(`Current: ${this.droid.timeout / 1000}s\nUsage: /timeout <10-600>`); return; }
      const sec = parseInt(args[0]);
      if (isNaN(sec) || sec < 10 || sec > 600) { await ctx.reply('Range: 10-600'); return; }
      this.droid.setTimeout(sec * 1000);
      await ctx.reply(`Timeout: ${sec}s`);
    });

    // /tools
    bot.command('tools', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      await ctx.reply('Querying...');
      try {
        const { code, stdout, stderr } = await this.droid.runCli(
          ['exec', '-m', s.model, '--auto', s.autoLevel, '--list-tools', '-o', 'json'],
          15000
        );
        const out = (stdout || stderr).trim();
        try {
          const tools = JSON.parse(out);
          const lines = tools.map(t => `${t.currentlyAllowed ? '✅' : '❌'} ${t.displayName}`);
          const allowed = tools.filter(t => t.currentlyAllowed).length;
          await ctx.reply(`Tools (${allowed}/${tools.length}, auto: ${s.autoLevel}):\n\n${lines.join('\n')}`);
        } catch (e) { await ctx.reply(out.slice(0, 4000) || 'Failed to parse'); }
      } catch (e) { await ctx.reply(`Failed: ${e.message}`); }
    });

    // /version
    bot.command('version', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      try {
        const { stdout, stderr } = await this.droid.runCli(['--version'], 5000);
        await ctx.reply(`Droid CLI: ${(stdout || stderr).trim()}`);
      } catch (e) { await ctx.reply(`Failed: ${e.message}`); }
    });

    // /spec
    bot.command('spec', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) { await ctx.reply(`Spec: ${s.useSpec ? '✅ On' : '❌ Off'}\nUsage: /spec on|off`); return; }
      const v = args[0].toLowerCase();
      if (v === 'on') { s.useSpec = true; s.sessionId = null; this.sessions.save(); await ctx.reply('✅ Spec on (session cleared)'); }
      else if (v === 'off') { s.useSpec = false; this.sessions.save(); await ctx.reply('❌ Spec off'); }
      else await ctx.reply('Usage: /spec on|off');
    });

    // /mission
    bot.command('mission', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) { await ctx.reply(`Mission: ${s.useMission ? '✅ On' : '❌ Off'}\nUsage: /mission on|off`); return; }
      const v = args[0].toLowerCase();
      if (v === 'on') { s.useMission = true; s.sessionId = null; this.sessions.save(); await ctx.reply('✅ Mission on (auto high)'); }
      else if (v === 'off') { s.useMission = false; this.sessions.save(); await ctx.reply('❌ Mission off'); }
      else await ctx.reply('Usage: /mission on|off');
    });

    // /reason
    bot.command('reason', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const args = ctx.message.text.split(' ').slice(1);
      const supported = MODEL_REASONING[s.model] || [];
      if (!args.length) {
        let info = `Reasoning: ${s.reasoning || 'Default'}\nModel: ${s.model}\n`;
        info += supported.length > 0 ? `Supported: ${supported.join(', ')}` : 'Not adjustable for this model';
        info += '\n\nUsage: /reason <level> | /reason default';
        await ctx.reply(info); return;
      }
      const v = args[0].toLowerCase();
      if (v === 'default' || v === 'reset') { s.reasoning = null; this.sessions.save(); await ctx.reply('Reset to default.'); return; }
      const valid = ['off', 'low', 'medium', 'high', 'max', 'xhigh', 'minimal'];
      if (!valid.includes(v)) { await ctx.reply(`Unknown: ${v}\nValid: ${valid.join(', ')}`); return; }
      if (supported.length === 0) { await ctx.reply(`Model ${s.model} does not support reasoning adjustment.`); return; }
      if (!supported.includes(v)) { await ctx.reply(`${v} not supported.\nSupported: ${supported.join(', ')}`); return; }
      s.reasoning = v; this.sessions.save(); await ctx.reply(`Reasoning: ${v}`);
    });

    // /status
    bot.command('status', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const s = this.sessions.get(uid, this._cid(ctx));
      const chatId = this._cid(ctx);
      await ctx.reply(
        `Context: ${this.context.getLabel(chatId)}\n` +
        `CWD: ${this.context.getCwd(chatId)}\n` +
        `Model: ${s.model}\nAuto: ${s.autoLevel}\n` +
        `Session: ${s.sessionId ? s.sessionId.slice(0, 8) + '...' : 'New'}\n` +
        `Spec: ${s.useSpec ? 'On' : 'Off'}\nMission: ${s.useMission ? 'On' : 'Off'}\n` +
        `Reasoning: ${s.reasoning || 'Default'}\nTimeout: ${this.droid.timeout / 1000}s\n` +
        `Reminders: ${this.reminders.getForChat(chatId).length}\n` +
        `Processing: ${s.processing ? 'Yes' : 'No'}`
      );
    });

    // /remind
    bot.command('remind', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const chatId = this._cid(ctx);
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 2) {
        await ctx.reply(
          'Usage:\n/remind HH:MM content\n/remind YYYY-MM-DD HH:MM content\n' +
          '/remind daily HH:MM content\n/remind weekly Mon HH:MM content\n' +
          '/remind monthly 15th HH:MM content\n/remind 30m content\n\n' +
          'Exec task (exec: prefix):\n/remind 30m exec:check server status'
        ); return;
      }
      const parsed = parseRemindArgs(args);
      if (parsed.error) { await ctx.reply(`Error: ${parsed.error}`); return; }
      const r = this.reminders.add(chatId, parsed.time, parsed.text, parsed.type, parsed.exec, parsed.day);
      await ctx.reply(formatRemindResult(r, this.context.getLabel(chatId)));
    });

    // /list
    bot.command('list', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const r = this.reminders.getForChat(this._cid(ctx));
      if (!r.length) { await ctx.reply('No reminders.'); return; }
      const lines = r.map((x, i) => {
        const cycle = x.type === 'daily' ? 'Daily' : x.type === 'weekly' ? `Weekly` :
          (x.type === 'monthly' ? `Monthly ${x.day}th` : 'Once');
        return `${i + 1}. [${cycle}] ${x.exec ? '[Task]' : '[Reminder]'} ${x.time} - ${x.text} (${x.id})`;
      });
      await ctx.reply(`Reminders (${this.context.getLabel(this._cid(ctx))}):\n\n${lines.join('\n')}\n\nDelete: /delete <ID or #>`);
    });

    // /delete
    bot.command('delete', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) { await ctx.reply('Usage: /delete <ID or #>'); return; }
      const cr = this.reminders.getForChat(this._cid(ctx));
      const idx = parseInt(args[0]) - 1;
      if (idx >= 0 && idx < cr.length) { const t = cr[idx]; this.reminders.delete(t.id); await ctx.reply(`Deleted: ${t.time} - ${t.text}`); return; }
      const t = cr.find(x => x.id === args[0]);
      if (t) { this.reminders.delete(t.id); await ctx.reply(`Deleted: ${t.time} - ${t.text}`); }
      else await ctx.reply('Not found. /list to view.');
    });

    // /mcp
    bot.command('mcp', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) {
        await ctx.reply(
          'MCP Management:\n\n' +
          '  /mcp list\n  /mcp add <name> <url>\n  /mcp add <name> <url> --header "Key: Value"\n  /mcp remove <name>'
        ); return;
      }
      const sub = args[0].toLowerCase();
      if (sub === 'list') {
        await ctx.reply('Querying...');
        try {
          const cwd = this.context.getCwd(this._cid(ctx));
          let mcps = [];
          const projectMcpPath = path.join(cwd, '.mcp.json');
          if (fs.existsSync(projectMcpPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(projectMcpPath, 'utf8'));
              if (data.mcpServers) for (const [name, cfg] of Object.entries(data.mcpServers))
                mcps.push({ name, type: cfg.type || 'stdio', url: cfg.url || cfg.command || '-', scope: 'Project' });
            } catch (e) {}
          }
          const globalPath = path.join(process.env.HOME || '/root', '.factory', 'settings.local.json');
          if (fs.existsSync(globalPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(globalPath, 'utf8'));
              if (data.mcpServers) for (const [name, cfg] of Object.entries(data.mcpServers))
                mcps.push({ name, type: cfg.type || 'stdio', url: cfg.url || cfg.command || '-', scope: 'Global' });
            } catch (e) {}
          }
          if (!mcps.length) { await ctx.reply('No MCP configured.'); return; }
          await ctx.reply(`MCP Servers:\n\n${mcps.map(m => `${m.scope === 'Project' ? '📂' : '🌐'} ${m.name} (${m.type}) ${m.url}`).join('\n')}`);
        } catch (e) { await ctx.reply(`Failed: ${e.message}`); }
        return;
      }
      if (sub === 'add') {
        if (args.length < 3) { await ctx.reply('Usage: /mcp add <name> <url> [--header "Key: Value"]'); return; }
        const cliArgs = ['mcp', 'add', args[1], args[2], '--type', 'http'];
        const rest = args.slice(3);
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '--header' && rest[i + 1]) { cliArgs.push('--header', rest[i + 1]); i++; }
        }
        await ctx.reply(`Adding MCP: ${args[1]}...`);
        try {
          const { code, stdout, stderr } = await this.droid.runCli(cliArgs, 15000);
          if (code === 0) await ctx.reply(`✅ MCP "${args[1]}" added.\n\n${(stdout || stderr).slice(0, 500)}`);
          else await ctx.reply(`❌ Failed:\n${(stderr || stdout || 'Unknown error').slice(0, 500)}`);
        } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
        return;
      }
      if (sub === 'remove' || sub === 'delete' || sub === 'rm') {
        if (args.length < 2) { await ctx.reply('Usage: /mcp remove <name>'); return; }
        await ctx.reply(`Removing MCP: ${args[1]}...`);
        try {
          const { code, stdout, stderr } = await this.droid.runCli(['mcp', 'remove', args[1]], 15000);
          if (code === 0) await ctx.reply(`✅ MCP "${args[1]}" removed.`);
          else await ctx.reply(`❌ Failed:\n${(stderr || stdout || 'Unknown error').slice(0, 500)}`);
        } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
        return;
      }
      await ctx.reply('Unknown sub-command. Available: list, add, remove');
    });

    // /plugin
    bot.command('plugin', async ctx => {
      const uid = ctx.from.id; if (!this._isAllowed(uid)) return;
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) {
        await ctx.reply(
          'Plugin Management:\n\n' +
          '  /plugin list\n  /plugin install <name@market>\n  /plugin remove <name>\n  /plugin update [name]\n' +
          '  /plugin marketplace list\n  /plugin marketplace add <Git URL>\n  /plugin marketplace update'
        ); return;
      }
      const sub = args[0].toLowerCase();

      if (sub === 'list') {
        try {
          const { code, stdout, stderr } = await this.droid.runCli(['plugin', 'list'], 15000);
          await ctx.reply(`Plugins:\n\n${(stdout || stderr).trim() || 'None'}`);
        } catch (e) { await ctx.reply(`Failed: ${e.message}`); }
        return;
      }
      if (sub === 'install' || sub === 'i') {
        if (args.length < 2) { await ctx.reply('Usage: /plugin install <name@market>'); return; }
        await ctx.reply(`Installing: ${args[1]}...`);
        try {
          const { code, stdout, stderr } = await this.droid.runCli(['plugin', 'install', args[1]], 60000);
          const out = (stdout || stderr).trim();
          if (code === 0) await ctx.reply(`✅ Installed.\n\n${out.slice(0, 1000)}`);
          else await ctx.reply(`❌ Failed:\n${out.slice(0, 500)}`);
        } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
        return;
      }
      if (sub === 'remove' || sub === 'uninstall' || sub === 'rm') {
        if (args.length < 2) { await ctx.reply('Usage: /plugin remove <name>'); return; }
        await ctx.reply(`Removing: ${args[1]}...`);
        try {
          const { code, stdout, stderr } = await this.droid.runCli(['plugin', 'uninstall', args[1]], 30000);
          const out = (stdout || stderr).trim();
          if (code === 0) await ctx.reply(`✅ Removed.\n\n${out.slice(0, 500)}`);
          else await ctx.reply(`❌ Failed:\n${out.slice(0, 500)}`);
        } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
        return;
      }
      if (sub === 'update') {
        const plugin = args[1] || null;
        await ctx.reply(plugin ? `Updating: ${plugin}...` : 'Updating all...');
        try {
          const cliArgs = ['plugin', 'update']; if (plugin) cliArgs.push(plugin);
          const { code, stdout, stderr } = await this.droid.runCli(cliArgs, 60000);
          const out = (stdout || stderr).trim();
          if (code === 0) await ctx.reply(`✅ Updated.\n\n${out.slice(0, 1000)}`);
          else await ctx.reply(`❌ Failed:\n${out.slice(0, 500)}`);
        } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
        return;
      }
      if (sub === 'marketplace' || sub === 'market') {
        const msub = (args[1] || '').toLowerCase();
        if (msub === 'list') {
          try {
            const { stdout, stderr } = await this.droid.runCli(['plugin', 'marketplace', 'list'], 15000);
            await ctx.reply(`Marketplace:\n\n${(stdout || stderr).trim() || 'None'}`);
          } catch (e) { await ctx.reply(`Failed: ${e.message}`); }
          return;
        }
        if (msub === 'add') {
          if (!args[2]) { await ctx.reply('Usage: /plugin marketplace add <Git URL>'); return; }
          await ctx.reply(`Adding marketplace: ${args[2]}...`);
          try {
            const { code, stdout, stderr } = await this.droid.runCli(['plugin', 'marketplace', 'add', args[2]], 30000);
            if (code === 0) await ctx.reply(`✅ Added.`);
            else await ctx.reply(`❌ Failed.`);
          } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
          return;
        }
        if (msub === 'update') {
          await ctx.reply('Updating marketplace...');
          try {
            const { code } = await this.droid.runCli(['plugin', 'marketplace', 'update'], 30000);
            await ctx.reply(code === 0 ? '✅ Updated.' : '❌ Failed.');
          } catch (e) { await ctx.reply(`❌ Error: ${e.message}`); }
          return;
        }
        await ctx.reply('Usage: /plugin marketplace <list|add|update>');
        return;
      }
      await ctx.reply('Unknown sub-command. Available: list, install, remove, update, marketplace');
    });
  }

  _registerMessageHandler() {
    this.bot.on('text', async ctx => {
      const uid = ctx.from.id, txt = ctx.message.text;
      if (!this._isAllowed(uid)) return;
      const chatId = this._cid(ctx);
      const s = this.sessions.get(uid, chatId);
      if (s.processing) { await ctx.reply('⏳ Previous request still processing...'); return; }
      console.log(`[MSG] ${uid} @ ${this.context.getLabel(chatId)}: ${txt}`);
      s.processing = true;
      const cwd = this.context.getCwd(chatId);
      let typingInterval = null;
      try {
        await ctx.sendChatAction('typing');
        typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 5000);
        const { stdout } = await this.droid.call(txt, s, cwd);
        const p = this.droid.parse(stdout);
        if (p.sessionId) { s.sessionId = p.sessionId; this.sessions.save(); }
        const r = p.text;
        if (r.length > 4000) { for (let i = 0; i < r.length; i += 4000) await ctx.reply(r.slice(i, i + 4000)); }
        else await ctx.reply(r);
        console.log(`[REPLY] ${uid}: ${r.slice(0, 100)}...`);
      } catch (e) {
        console.error('[ERROR]', e.message);
        await ctx.reply(`Error: ${e.message.slice(0, 500)}`);
      } finally {
        if (typingInterval) clearInterval(typingInterval);
        s.processing = false;
      }
    });
  }

  async start() {
    this.reminders.start();
    console.log('='.repeat(50));
    console.log('Telegram + Droid Bot');
    console.log('='.repeat(50));
    console.log(`Model: ${this.config.defaultModel}`);
    console.log(`Droid: ${this.config.droidPath || 'droid'}`);
    console.log(`Private CWD: ${this.context.privateCwd}`);
    for (const [k, v] of Object.entries(this.context.groups)) {
      console.log(`Group ${k} -> ${v.cwd} (${v.label})`);
    }
    console.log(`Timeout: ${(this.config.timeout || 120000) / 1000}s`);
    console.log(`Allowed: ${this.allowedUsers ? this.allowedUsers.join(', ') : 'All'}`);
    console.log('='.repeat(50));
    await this.bot.launch();
    console.log('[STARTED] Telegram bot is running');
  }

  stop(signal) {
    this.bot.stop(signal);
  }
}

module.exports = TelegramAdapter;
