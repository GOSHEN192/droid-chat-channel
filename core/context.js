/**
 * 上下文路由 — 根据聊天 ID 映射工作目录
 * 可通过环境变量 CONTEXT_MAP 配置
 */

/**
 * CONTEXT_MAP 环境变量格式 (JSON):
 * {
 *   "groups": {
 *     "-123456": { "cwd": "/home/user/family-workspace", "label": "Family" }
 *   },
 *   "private": { "cwd": "/home/user/workspace", "label": "Work" }
 * }
 */

class ContextRouter {
  constructor(envMap) {
    // envMap: parsed JSON from CONTEXT_MAP env var
    this.groups = {};
    this.privateCwd = process.cwd();
    this.privateLabel = 'Default';

    if (envMap) {
      if (envMap.groups) this.groups = envMap.groups;
      if (envMap.private) {
        this.privateCwd = envMap.private.cwd || this.privateCwd;
        this.privateLabel = envMap.private.label || 'Default';
      }
    }
  }

  getCwd(chatId) {
    const cfg = this.groups[String(chatId)];
    return cfg ? cfg.cwd : this.privateCwd;
  }

  getLabel(chatId) {
    const cfg = this.groups[String(chatId)];
    return cfg ? cfg.label : this.privateLabel;
  }

  isGroup(chatId) {
    return this.groups[String(chatId)] !== undefined;
  }
}

module.exports = ContextRouter;
