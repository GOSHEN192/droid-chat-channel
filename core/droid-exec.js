/**
 * Droid CLI 调用 — 平台无关
 * execDroid / callDroid / parseDroidOutput / isSessionCorrupted
 */

const { spawn } = require('child_process');

class DroidExec {
  constructor({ droidPath, env, timeout }) {
    this.droidPath = droidPath || 'droid';
    this.env = env || process.env;
    this.timeout = timeout || 120000;
  }

  setTimeout(ms) {
    this.timeout = ms;
  }

  exec(prompt, session, cwd, useFork = false) {
    return new Promise((resolve, reject) => {
      const args = ['exec', '-m', session.model, '-o', 'json'];
      if (session.useMission) args.push('--auto', 'high');
      else args.push('--auto', session.autoLevel);
      if (session.useSpec) args.push('--use-spec');
      if (session.useMission) args.push('--mission');
      if (session.reasoning) args.push('-r', session.reasoning);
      if (useFork && session.sessionId) args.push('--fork', session.sessionId);
      else if (session.sessionId && !session.useSpec) args.push('-s', session.sessionId);
      args.push(prompt);

      console.log(`[DROID] ${this.droidPath} ${args.join(' ')} (cwd: ${cwd})`);

      const proc = spawn(this.droidPath, args, {
        cwd,
        env: this.env,
        timeout: this.timeout,
        maxBuffer: 1024 * 1024 * 10,
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      proc.on('error', err => reject(err));
    });
  }

  isSessionCorrupted(stdout) {
    try {
      const j = JSON.parse(stdout);
      if (j.is_error) {
        const r = (j.result || '').toLowerCase();
        if (r.includes('byok error') || r.includes('403') || r.includes('forbidden') || r.includes('upstream error'))
          return true;
      }
    } catch (e) {}
    return false;
  }

  async call(prompt, session, cwd) {
    let result = await this.exec(prompt, session, cwd);
    if (result.code !== 0 && session.sessionId && this.isSessionCorrupted(result.stdout)) {
      const oldId = session.sessionId;
      console.log(`[DROID] Session corrupted (${oldId}), forking...`);
      result = await this.exec(prompt, session, cwd, true);
      if (result.code === 0) {
        console.log(`[DROID] Fork OK (old: ${oldId})`);
      } else if (this.isSessionCorrupted(result.stdout)) {
        console.log(`[DROID] Fork also failed, fresh session...`);
        session.sessionId = null;
        result = await this.exec(prompt, session, cwd);
      }
    }
    if (result.code === 0) return { stdout: result.stdout, stderr: result.stderr };
    let msg = result.stderr.trim() || `Process exited with code ${result.code}`;
    try {
      const j = JSON.parse(result.stdout);
      if (j.is_error && j.result) msg = j.result.trim().slice(0, 500);
    } catch (e) {}
    throw new Error(msg);
  }

  parse(raw) {
    try {
      const j = JSON.parse(raw);
      const c = (j.result || '')
        .trim()
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .trim();
      return { text: c || '(Droid did not return content)', sessionId: j.session_id || null, isError: j.is_error || false };
    } catch (e) {
      const c = raw
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .trim();
      return { text: c || '(Droid did not return content)', sessionId: null, isError: false };
    }
  }

  runCli(args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.droidPath, args, { env: this.env, timeout: timeoutMs });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      proc.on('error', err => reject(err));
    });
  }
}

module.exports = DroidExec;
