/**
 * 命令处理 — 平台无关的命令解析逻辑
 * 各 adapter 调用这些函数处理命令，只传入必要的上下文
 */

const fs = require('fs');
const path = require('path');

function parseRemindArgs(args) {
  const WEEKDAY_MAP = {
    '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
  };
  const rawText = args.join(' ');
  let time, text, type = 'once', exec = false, day = null;
  let actualArgs = [...args];

  // detect exec: prefix
  if (rawText.match(/\bexec:/i)) {
    exec = true;
    const m = rawText.match(/\bexec:\s*(.+)/i);
    if (m) { text = m[1].trim(); actualArgs = rawText.split(/\bexec:/i)[0].trim().split(/\s+/); }
  }

  if (actualArgs[0] === 'weekly' && actualArgs.length >= 3) {
    const wd = actualArgs[1].replace(/周|星期/, '');
    if (!(wd in WEEKDAY_MAP)) return { error: 'Weekday: 日/一/二/三/四/五/六' };
    if (!/^\d{1,2}:\d{2}$/.test(actualArgs[2])) return { error: 'Format: HH:MM' };
    day = WEEKDAY_MAP[wd]; time = actualArgs[2].padStart(5, '0'); type = 'weekly';
    if (!exec) text = actualArgs.slice(3).join(' ');
  } else if (actualArgs[0] === 'monthly' && actualArgs.length >= 3) {
    const dayNum = parseInt(actualArgs[1].replace(/号|日/, ''));
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return { error: 'Day: 1-31' };
    if (!/^\d{1,2}:\d{2}$/.test(actualArgs[2])) return { error: 'Format: HH:MM' };
    day = dayNum; time = actualArgs[2].padStart(5, '0'); type = 'monthly';
    if (!exec) text = actualArgs.slice(3).join(' ');
  } else if (actualArgs[0] === 'daily' && actualArgs.length >= 2) {
    if (!/^\d{1,2}:\d{2}$/.test(actualArgs[1])) return { error: 'Format: HH:MM' };
    time = actualArgs[1].padStart(5, '0'); type = 'daily';
    if (!exec) text = actualArgs.slice(2).join(' ');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(actualArgs[0]) && actualArgs.length >= 2) {
    if (!/^\d{1,2}:\d{2}$/.test(actualArgs[1])) return { error: 'Format: HH:MM' };
    time = `${actualArgs[0]} ${actualArgs[1].padStart(5, '0')}`;
    if (!exec) text = actualArgs.slice(2).join(' ');
  } else if (/^\d{1,2}:\d{2}$/.test(actualArgs[0])) {
    const now = new Date();
    const y = now.getFullYear(), mo = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    time = `${y}-${mo}-${d} ${actualArgs[0].padStart(5, '0')}`;
    if (!exec) text = actualArgs.slice(1).join(' ');
  } else if (/^\d+[dhm]$/.test(actualArgs[0])) {
    const v = parseInt(actualArgs[0]), u = actualArgs[0].slice(-1);
    const ms = u === 'd' ? v * 86400000 : u === 'h' ? v * 3600000 : v * 60000;
    const d = new Date(Date.now() + ms);
    const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'),
      dd = String(d.getDate()).padStart(2, '0'), h = String(d.getHours()).padStart(2, '0'),
      mn = String(d.getMinutes()).padStart(2, '0');
    time = `${y}-${mo}-${dd} ${h}:${mn}`;
    if (!exec) text = actualArgs.slice(1).join(' ');
  } else {
    return { error: 'Invalid format.' };
  }

  if (!text) return { error: 'Missing content.' };
  return { time, text, type, exec, day };
}

function formatRemindResult(r, label) {
  const dn = ['日', '一', '二', '三', '四', '五', '六'];
  const tl = r.type === 'daily' ? 'Daily' : r.type === 'weekly' ? `Weekly ${dn[r.day]}` :
    (r.type === 'monthly' ? `Monthly ${r.day}th` : 'Once');
  return `${r.exec ? 'Task' : 'Reminder'} added ✅\nContext: ${label}\nType: ${tl}\nTime: ${r.time}\n${r.exec ? 'Task' : 'Content'}: ${r.text}`;
}

function buildHelpText(label) {
  return `Commands (${label}):\n\n` +
    `Chat:\n  /new - New session\n  /session - Session info\n  /stop - Stop task\n\n` +
    `Model:\n  /model [name] - Switch model\n  /tools - Available tools\n  /version - Droid version\n\n` +
    `Execution:\n  /auto [level] - Permission (low/medium/high)\n  /timeout <sec> - Timeout\n  /status - Full status\n\n` +
    `Advanced:\n  /spec [on|off] - Spec mode\n  /mission [on|off] - Multi-Agent mode\n  /reason [level] - Reasoning depth\n\n` +
    `MCP:\n  /mcp list - View MCPs\n  /mcp add <name> <url> - Add\n  /mcp remove <name> - Remove\n\n` +
    `Plugin:\n  /plugin list - View plugins\n  /plugin install <name> - Install\n  /plugin remove <name> - Uninstall\n  /plugin update - Update\n\n` +
    `Reminder:\n  /remind <time> <content>\n  /list - View reminders\n  /delete <ID|#> - Delete`;
}

module.exports = { parseRemindArgs, formatRemindResult, buildHelpText };
