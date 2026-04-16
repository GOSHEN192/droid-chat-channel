# droid-chat-channel

将 [Factory Droid](https://factory.ai) CLI 桥接到聊天平台，让用户通过 Telegram / WhatsApp 等聊天工具与 Droid AI 对话，并拥有完整的工具调用能力。

```
聊天平台 (Telegram/WhatsApp)  ←→  Node.js 中转层  ←→  Droid CLI  ←→  大模型 API
```

**核心优势：** 使用 Droid CLI 的 `custom model` 功能，配合你自己的 API Key（MiniMax / GLM / 讯飞等），**不消耗 Factory 配额**，同时保留 Droid 的全部工具能力（代码执行、文件操作、MCP 等）。

## 支持平台

| 平台 | 适配器 | 状态 |
|------|--------|------|
| Telegram | `adapters/telegram.js` | ✅ 完整实现 |
| WhatsApp | `adapters/whatsapp.js` | ✅ 完整实现 |
| 飞书 / 微信 / Slack / Discord / 钉钉 / Line | 预留接口 | 🔜 待扩展 |

添加新平台只需在 `adapters/` 下创建一个文件，然后在 `index.js` 的 `PLATFORM_MAP` 中注册。

## 前置条件

1. **Node.js** >= 18
2. **Droid CLI** 已安装并登录（`droid login`）
3. **Droid custom model** 已配置（`~/.factory/settings.local.json` 中添加模型定义）
4. 对应平台的凭证：
   - Telegram: Bot Token（从 @BotFather 获取）
   - WhatsApp: 手机号（首次启动扫码认证）

## 快速开始

### 方式一：一键配置（推荐）

```bash
git clone https://github.com/your-username/droid-chat-channel.git
cd droid-chat-channel
npm install
node setup.js
```

`setup.js` 会交互式引导你完成所有配置，生成 `.env` 和 systemd service 文件。

### 方式二：手动配置

1. 复制配置模板：
```bash
cp config/.env.example config/.env
```

2. 编辑 `config/.env`，填写你的 Token 和 API Key：
```bash
PLATFORM=telegram
TELEGRAM_BOT_TOKEN=你的Bot_Token
DROID_MODEL=custom:minimax-m2.7
MINIMAX_API_KEY=你的API_Key
```

3. 启动：
```bash
node index.js --platform telegram
# 或
npm run start:telegram
```

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `PLATFORM` | 是 | 平台: `telegram` / `whatsapp` |
| `TELEGRAM_BOT_TOKEN` | Telegram 必填 | Bot Token |
| `ALLOWED_USERS` | 否 | 允许的用户 ID（逗号分隔，留空=所有人） |
| `DROID_PATH` | 否 | Droid CLI 路径，默认 `droid` |
| `DROID_MODEL` | 否 | 默认模型，默认 `custom:minimax-m2.7` |
| `DROID_TIMEOUT` | 否 | 超时秒数，默认 `120` |
| `DATA_DIR` | 否 | 数据目录，默认 `./data` |
| `MINIMAX_API_KEY` | custom model | MiniMax API Key |
| `ZAI_API_KEY` | custom model | 智谱 GLM API Key |
| `XFYUN_API_KEY` | custom model | 讯飞 API Key |

### 上下文路由

可以将不同的群聊映射到不同的工作目录（Droid 会在该目录读取 `AGENTS.md`、`.factory/RULES.md` 等人格文件）：

```bash
CONTEXT_MAP={"groups":{"-123456":{"cwd":"/home/user/family","label":"Family"}},"private":{"cwd":"/home/user/workspace","label":"Work"}}
```

### config.json（可选）

也可以用 JSON 文件替代环境变量：

```json
{
  "platform": "telegram",
  "defaultModel": "custom:minimax-m2.7",
  "droidPath": "droid",
  "timeout": 120000,
  "dataDir": "./data",
  "contextMap": {
    "groups": {
      "-123456": { "cwd": "/home/user/family", "label": "Family" }
    },
    "private": { "cwd": "/home/user/workspace", "label": "Work" }
  }
}
```

启动：`node index.js --config ./config.json`

## 部署

### systemd（推荐）

```bash
node setup.js  # 自动生成 service 文件
# 或手动：
sudo cp templates/droid-chat-channel.service.tpl /etc/systemd/system/droid-chat-telegram.service
# 编辑 service 文件，填入实际值
sudo systemctl daemon-reload
sudo systemctl enable droid-chat-telegram
sudo systemctl start droid-chat-telegram

# 查看日志
journalctl -u droid-chat-telegram -f
```

**注意：** systemd 不会 source `.bashrc`，所有 API Key 必须在 service 文件的 `Environment=` 中配置。

### Docker

```bash
cp config/.env.example config/.env
# 编辑 config/.env

cd templates
docker compose up -d
```

### PM2

```bash
npm install -g pm2
pm2 start index.js --name droid-chat -- --platform telegram
pm2 save
pm2 startup
```

## 使用

### Telegram 命令

| 命令 | 说明 |
|------|------|
| `/start` | 欢迎信息 |
| `/help` | 显示所有命令 |
| `/new` | 清空会话 |
| `/session` | 查看会话信息 |
| `/model [名称]` | 切换模型 |
| `/auto [等级]` | 切换权限 (low/medium/high) |
| `/timeout <秒>` | 设置超时 |
| `/status` | 完整状态 |
| `/spec on\|off` | 规格模式（先规划再执行） |
| `/mission on\|off` | 多 Agent 任务模式 |
| `/reason [等级]` | 思考深度 |
| `/tools` | 可用工具 |
| `/version` | Droid 版本 |
| `/stop` | 停止当前任务 |
| `/mcp list/add/remove` | MCP 管理 |
| `/plugin list/install/remove/update` | 插件管理 |
| `/remind <时间> <内容>` | 添加提醒 |
| `/list` | 查看提醒 |
| `/delete <ID>` | 删除提醒 |

### WhatsApp 命令

所有命令与 Telegram 相同。在群组中需要 @机器人 或使用 `/` 命令才会响应。

### 提醒/定时任务

```
/remind 14:30 记得开会
/remind 2026-05-01 09:00 项目上线检查
/remind daily 08:00 日报提醒
/remind weekly 一 09:00 周会提醒
/remind monthly 15 10:00 月度总结
/remind 30m 30分钟后提醒我
/remind 2h exec:检查服务器状态并汇报
```

`exec:` 前缀的提醒会在到期后自动调用 Droid 执行任务，并将结果发回聊天。

### 可用模型

**自定义模型（使用你的 API Key，不消耗 Factory 配额）：**

| 简称 | 模型 |
|------|------|
| `minimax` | MiniMax M2.7 |
| `glm4` | GLM-4.7 |
| `glm5` | GLM-5.1 |
| `xfyun` | 讯飞 Coding |

**内置模型（消耗 Factory 配额）：**

`claude-opus`, `claude-sonnet`, `claude-haiku`, `gpt54`, `gemini-pro`, `kimi` 等。

## Droid Custom Model 配置

在使用前，需要配置 `~/.factory/settings.local.json`：

```json
{
  "customModels": [
    {
      "model": "MiniMax-M2.7",
      "id": "custom:minimax-m2.7",
      "baseUrl": "https://api.minimaxi.com/v1",
      "apiKey": "${MINIMAX_API_KEY}",
      "displayName": "MiniMax M2.7",
      "maxOutputTokens": 131072,
      "noImageSupport": true,
      "provider": "generic-chat-completion-api"
    }
  ]
}
```

`apiKey` 使用 `${环境变量名}` 格式，运行时从环境变量读取。

## 项目结构

```
droid-chat-channel/
├── index.js              # 入口 + adapter 工厂
├── setup.js              # 一键配置脚本
├── package.json
├── core/                 # 平台无关核心逻辑
│   ├── droid-exec.js     # Droid CLI 调用（spawn + 三级重试）
│   ├── session.js        # 会话管理（持久化到 JSON）
│   ├── reminders.js      # 定时提醒/任务
│   ├── context.js        # 上下文路由
│   ├── models.js         # 模型定义
│   └── commands.js       # 命令解析
├── adapters/             # 平台适配器
│   ├── telegram.js       # Telegram (Telegraf)
│   └── whatsapp.js       # WhatsApp (Baileys)
├── config/
│   └── .env.example      # 环境变量模板
├── templates/
│   ├── droid-chat-channel.service.tpl  # systemd 模板
│   ├── Dockerfile
│   └── docker-compose.yml
└── README.md
```

## 扩展新平台

1. 创建 `adapters/your-platform.js`，实现 `start()` 和 `stop()` 方法
2. 在 `index.js` 的 `PLATFORM_MAP` 中注册：
```js
const PLATFORM_MAP = {
  telegram: './adapters/telegram',
  whatsapp: './adapters/whatsapp',
  'your-platform': './adapters/your-platform',
};
```
3. 在 adapter 中复用 core 模块：
```js
const DroidExec = require('../core/droid-exec');
const SessionManager = require('../core/session');
const ReminderManager = require('../core/reminders');
const ContextRouter = require('../core/context');
```

## 架构

```
输入源 (任何)              处理层 (通用)               输出源 (任何)
─────────────           ─────────────             ─────────────
Telegram 消息  ──┐                                 ┌── Telegram 回复
WhatsApp 消息  ──┤     ┌──────────────────┐        ├── WhatsApp 回复
飞书消息       ──┼────→│  core/            │───────→│── 飞书回复
邮件           ──┤     │  droid-exec.js    │        ├── 邮件回复
Webhook       ──┘     │  session.js       │        └── HTTP Response
                      │  reminders.js     │
                      │  context.js       │
                      └──────────────────┘
                              ↕
                      droid exec CLI
                              ↕
                      大模型 API (MiniMax/GLM/Claude/GPT)
```

## License

MIT
