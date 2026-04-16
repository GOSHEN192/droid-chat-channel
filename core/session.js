/**
 * 会话管理 — 平台无关
 * 持久化到 sessions.json，支持多用户、多聊天上下文
 */

const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor({ filePath, defaultModel }) {
    this.filePath = filePath;
    this.defaultModel = defaultModel;
    this.sessions = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const [key, sess] of Object.entries(data)) {
          this.sessions.set(key, {
            ...sess,
            processing: false,
            useSpec: sess.useSpec || false,
            useMission: sess.useMission || false,
            reasoning: sess.reasoning || null,
          });
        }
        console.log(`[SESSION] Loaded ${this.sessions.size} session(s)`);
      }
    } catch (e) {
      console.error('[SESSION] Load failed:', e.message);
    }
  }

  save() {
    try {
      const data = {};
      for (const [key, sess] of this.sessions) {
        data[key] = {
          sessionId: sess.sessionId,
          model: sess.model,
          autoLevel: sess.autoLevel,
          useSpec: sess.useSpec,
          useMission: sess.useMission,
          reasoning: sess.reasoning,
        };
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[SESSION] Save failed:', e.message);
    }
  }

  getKey(userId, chatId) {
    return `${userId}_${chatId}`;
  }

  get(userId, chatId) {
    const key = this.getKey(userId, chatId);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        sessionId: null,
        model: this.defaultModel,
        autoLevel: 'high',
        processing: false,
        useSpec: false,
        useMission: false,
        reasoning: null,
      });
    }
    return this.sessions.get(key);
  }

  set(userId, chatId, partial) {
    const key = this.getKey(userId, chatId);
    const existing = this.get(userId, chatId);
    this.sessions.set(key, { ...existing, ...partial });
    this.save();
  }

  clearSessionId(userId, chatId) {
    const s = this.get(userId, chatId);
    s.sessionId = null;
    this.save();
  }
}

module.exports = SessionManager;
