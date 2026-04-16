/**
 * 模型定义 — 用户可通过环境变量 CUSTOM_MODELS 覆盖
 */

const CUSTOM_MODELS = {
  'minimax': 'custom:minimax-m2.7',
  'glm4': 'custom:glm-4.7',
  'glm5': 'custom:glm-5.1',
  'xfyun': 'custom:astron-code-latest',
};

const BUILTIN_MODELS = {
  'claude-opus': 'claude-opus-4-6',
  'claude-opus-fast': 'claude-opus-4-6-fast',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku': 'claude-haiku-4-5-20251001',
  'gpt54': 'gpt-5.4',
  'gpt54-fast': 'gpt-5.4-fast',
  'gpt54-mini': 'gpt-5.4-mini',
  'gpt53-codex': 'gpt-5.3-codex',
  'gpt53-codex-fast': 'gpt-5.3-codex-fast',
  'gpt52': 'gpt-5.2',
  'gpt52-codex': 'gpt-5.2-codex',
  'gemini-pro': 'gemini-3.1-pro-preview',
  'gemini-flash': 'gemini-3-flash-preview',
  'glm5-builtin': 'glm-5.1',
  'kimi': 'kimi-k2.5',
  'minimax-builtin': 'minimax-m2.7',
};

const MODEL_REASONING = {
  'claude-opus-4-6': ['off','low','medium','high','max'],
  'claude-opus-4-6-fast': ['off','low','medium','high','max'],
  'claude-sonnet-4-6': ['off','low','medium','high','max'],
  'claude-haiku-4-5-20251001': ['off','low','medium','high'],
  'gpt-5.4': ['low','medium','high','xhigh'],
  'gpt-5.4-fast': ['low','medium','high','xhigh'],
  'gpt-5.4-mini': ['low','medium','high','xhigh'],
  'gpt-5.3-codex': ['low','medium','high','xhigh'],
  'gpt-5.3-codex-fast': ['low','medium','high','xhigh'],
  'gpt-5.2': ['off','low','medium','high','xhigh'],
  'gpt-5.2-codex': ['low','medium','high','xhigh'],
  'gemini-3.1-pro-preview': ['low','medium','high'],
  'gemini-3-flash-preview': ['minimal','low','medium','high'],
  'glm-5.1': [],
  'kimi-k2.5': [],
  'minimax-m2.7': ['high'],
  'custom:minimax-m2.7': ['high'],
  'custom:glm-5.1': [],
  'custom:glm-4.7': [],
  'custom:astron-code-latest': [],
};

module.exports = { CUSTOM_MODELS, BUILTIN_MODELS, MODEL_REASONING };
