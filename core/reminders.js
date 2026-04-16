/**
 * 定时提醒/任务 — 平台无关
 * 支持 once/daily/weekly/monthly + exec 任务
 */

const fs = require('fs');

const WINDOW_MS = 3 * 60 * 1000;
const EXPIRE_MS = 5 * 60 * 1000;

function localDateTimeStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'),
    dd = String(d.getDate()).padStart(2, '0'), h = String(d.getHours()).padStart(2, '0'),
    mn = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${h}:${mn}`;
}
function localDateStr(d) { return localDateTimeStr(d).slice(0, 10); }
function localTimeStr(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function parseReminderTargetTime(r, now) {
  if (r.type === 'daily' || r.type === 'weekly' || r.type === 'monthly') {
    const [h, mn] = r.time.split(':').map(Number);
    const t = new Date(now);
    t.setHours(h, mn, 0, 0);
    return t;
  }
  if (r.type === 'once') {
    const [datePart, timePart] = r.time.split(' ');
    if (!datePart || !timePart) return null;
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mn] = timePart.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mn, 0);
  }
  return null;
}

function alreadyFiredThisCycle(r, now) {
  if (!r.lastFiredAt) return false;
  const last = new Date(r.lastFiredAt);
  if (r.type === 'daily' || r.type === 'weekly' || r.type === 'monthly')
    return localDateStr(last) === localDateStr(now);
  if (r.type === 'once') return true;
  return false;
}

function isRetryableError(errMsg) {
  const s = (errMsg || '').toLowerCase();
  return s.includes('rate_limit') || s.includes('overloaded') || s.includes('network') ||
    s.includes('timeout') || s.includes('429') || s.includes('timed out') ||
    s.includes('econnreset') || s.includes('econnrefused') || s.includes('socket hang up');
}

class ReminderManager {
  constructor({ filePath, sendMessage, callDroid, getCwd, defaultModel }) {
    this.filePath = filePath;
    this.sendMessage = sendMessage;
    this.callDroid = callDroid;
    this.getCwd = getCwd;
    this.defaultModel = defaultModel;
    this.reminders = [];
    this.retryQueue = [];
    this.retryProcessing = false;
    this.processing = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.reminders = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        console.log(`[REMINDER] Loaded ${this.reminders.length} reminder(s)`);
      }
    } catch (e) {
      console.error('[REMINDER] Load failed:', e.message);
      this.reminders = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.reminders, null, 2));
    } catch (e) {
      console.error('[REMINDER] Save failed:', e.message);
    }
  }

  add(chatId, time, text, type = 'once', exec = false, day = null) {
    const r = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      chatId, time, text, type, exec, day, createdAt: Date.now(), lastFiredAt: null,
    };
    this.reminders.push(r);
    this.save();
    return r;
  }

  delete(id) {
    const i = this.reminders.findIndex(r => r.id === id);
    if (i !== -1) { this.reminders.splice(i, 1); this.save(); return true; }
    return false;
  }

  getForChat(chatId) { return this.reminders.filter(r => r.chatId === chatId); }

  checkDue() {
    const now = new Date();
    const due = [];
    for (const r of this.reminders) {
      if (alreadyFiredThisCycle(r, now)) continue;
      const target = parseReminderTargetTime(r, now);
      if (!target) continue;
      const diff = now.getTime() - target.getTime();
      if (diff >= 0 && diff < WINDOW_MS) due.push(r);
    }
    return due;
  }

  scheduleRetry(chatId, text, errMsg, attempt, maxAttempts) {
    const delays = [30000, 60000, 120000];
    if (attempt >= maxAttempts) {
      this.sendMessage(chatId, `❌ Retry ${maxAttempts}x failed: ${text}\n${errMsg.slice(0, 200)}`).catch(() => {});
      return;
    }
    this.retryQueue.push({ chatId, text, attempt: attempt + 1, fireAt: Date.now() + delays[attempt] });
    console.log(`[RETRY] Scheduled retry #${attempt + 1} for: ${text.slice(0, 50)}`);
    if (!this.retryProcessing) this._processRetryQueue();
  }

  async _processRetryQueue() {
    if (this.retryQueue.length === 0) { this.retryProcessing = false; return; }
    this.retryProcessing = true;
    const item = this.retryQueue[0];
    const wait = item.fireAt - Date.now();
    if (wait > 0) { setTimeout(() => this._processRetryQueue(), wait); return; }
    this.retryQueue.shift();
    const cwd = this.getCwd(item.chatId);
    const tempSession = { sessionId: null, model: this.defaultModel, autoLevel: 'high', useSpec: false, useMission: false, reasoning: null };
    try {
      const { stdout } = await this.callDroid(item.text, tempSession, cwd);
      const droid = require('./droid-exec');
      // We parse inline to avoid circular deps
      let parsed;
      try {
        const j = JSON.parse(stdout);
        parsed = { text: (j.result || '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<think[\s\S]*?<\/think>/gi, '').trim() };
      } catch (e) { parsed = { text: stdout.trim() }; }
      const result = parsed.text.length > 4000 ? parsed.text.slice(0, 4000) + '...' : parsed.text;
      await this.sendMessage(item.chatId, `✅ Retry OK (#${item.attempt}): ${item.text}\n\n${result}`);
    } catch (err) {
      const msg = err.message || '';
      if (isRetryableError(msg)) {
        this.scheduleRetry(item.chatId, item.text, msg, item.attempt, 3);
      } else {
        await this.sendMessage(item.chatId, `❌ Task failed (permanent): ${item.text}\n${msg.slice(0, 200)}`).catch(() => {});
      }
    } finally { this._processRetryQueue(); }
  }

  async tick() {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      // 1. Expire old once reminders
      const expired = [];
      for (const r of this.reminders) {
        if (r.type === 'once' && !r.lastFiredAt) {
          const target = parseReminderTargetTime(r, now);
          if (target && now.getTime() - target.getTime() > EXPIRE_MS) expired.push(r);
        }
      }
      for (const r of expired) {
        this.delete(r.id);
        try { await this.sendMessage(r.chatId, `⏰ Expired: ${r.text}\n(Scheduled: ${r.time})`); } catch (e) {}
      }
      // 2. Fire due reminders
      const due = this.checkDue();
      if (due.length > 0) console.log(`[REMINDER] ${due.length} reminder(s) due`);
      for (const r of due) {
        if (!r.chatId) continue;
        try {
          if (r.exec) {
            await this.sendMessage(r.chatId, `⏰ Executing: ${r.text}`);
            const cwd = this.getCwd(r.chatId);
            const tempSession = { sessionId: null, model: this.defaultModel, autoLevel: 'high', useSpec: false, useMission: false, reasoning: null };
            try {
              const { stdout } = await this.callDroid(r.text, tempSession, cwd);
              let parsed;
              try {
                const j = JSON.parse(stdout);
                parsed = { text: (j.result || '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<think[\s\S]*?<\/think>/gi, '').trim() };
              } catch (e) { parsed = { text: stdout.trim() }; }
              const result = parsed.text.length > 4000 ? parsed.text.slice(0, 4000) + '...' : parsed.text;
              await this.sendMessage(r.chatId, `✅ Done: ${r.text}\n\n${result}`);
            } catch (err) {
              const msg = err.message || '';
              if (isRetryableError(msg)) {
                await this.sendMessage(r.chatId, `⚠️ Failed, will retry: ${r.text}\n${msg.slice(0, 200)}`);
                this.scheduleRetry(r.chatId, r.text, msg, 0, 3);
              } else {
                await this.sendMessage(r.chatId, `❌ Failed: ${r.text}\n${msg.slice(0, 300)}`);
              }
            }
          } else {
            await this.sendMessage(r.chatId, `⏰ Reminder: ${r.text}`);
          }
        } catch (e) { console.error('[REMINDER] Send failed:', e.message); }
        r.lastFiredAt = Date.now();
        if (r.type === 'once') this.delete(r.id);
        else this.save();
      }
    } catch (e) { console.error('[REMINDER] Check error:', e.message); }
    finally { this.processing = false; }
  }

  start(intervalMs = 60000) {
    setInterval(() => this.tick(), intervalMs);
    console.log(`[REMINDER] Checker started (every ${intervalMs / 1000}s)`);
  }
}

// Export helpers for command parsing
module.exports = {
  ReminderManager,
  localDateTimeStr,
  localDateStr,
  localTimeStr,
  isRetryableError,
};
