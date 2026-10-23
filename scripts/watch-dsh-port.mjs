// watch-dsh-port.mjs — 看门狗：DSH 端口变了就自动让桥接重启
//
// 为什么需要：DSH 桌面版每次启动端口都会变（实测出现过 19387 / 10564 / 5805 / 3897）。
// 桥接的 NodeApiClient 只在进程启动时读一次 config.json 的 dsh.baseUrl，
// 所以 DSH 中途重启（或崩溃后自动拉起）会让正在跑的桥接永远连不上旧端口，
// QQ 上只会固定收到「⏳ 系统服务重启中，消息已排队」。
//
// 做法：每 20 秒跑一次 sync-dsh-port.mjs。
//   - 端口没变：什么都不做
//   - 端口变了：sync 已经改写 config.json，这里再结束桥接进程；
//     启动.bat 里 start.bat 的守护循环会在 5 秒后用新配置把它拉起来
//
// 用法：node scripts/watch-dsh-port.mjs   （由 启动.bat 调起，关窗口即停）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCK = path.join(ROOT, 'state', 'bridge.lock');
const INTERVAL_MS = 20_000;

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}
function log(msg) {
  console.log(`[watch] ${stamp()} ${msg}`);
}

function runSync() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, 'scripts', 'sync-dsh-port.mjs')],
      { cwd: ROOT, windowsHide: true, timeout: 60_000 },
      (err, stdout) => resolve({ code: err ? 1 : 0, out: String(stdout || '') })
    );
  });
}

function bridgePid() {
  try {
    const raw = fs.readFileSync(LOCK, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return 0;
    process.kill(pid, 0); // 探活：进程不存在会抛错
    return pid;
  } catch {
    return 0;
  }
}

// 单实例：已经有一个看门狗在跑就直接退出，避免重复 taskkill
const SELF_LOCK = path.join(ROOT, 'state', 'watch-dsh-port.lock');
try {
  const old = Number(fs.readFileSync(SELF_LOCK, 'utf8').trim());
  if (Number.isInteger(old) && old > 0) {
    process.kill(old, 0);
    log(`已有一个看门狗在运行（PID ${old}），本实例退出`);
    process.exit(0);
  }
} catch {}
try { fs.writeFileSync(SELF_LOCK, String(process.pid), 'utf8'); } catch {}
process.on('exit', () => { try { fs.unlinkSync(SELF_LOCK); } catch {} });

let lastBusy = '';
for (;;) {
  const { code, out } = await runSync();
  const changed = /->/.test(out); // sync 只在真的改写时打印 "旧 -> 新"
  if (changed) {
    const line = out.split(/\r?\n/).find((l) => l.includes('->')) || '';
    const pid = bridgePid();
    if (pid) {
      log(`DSH 端口变了，重启桥接（PID ${pid}）：${line.replace(/^.*\]\s*/, '')}`);
      try {
        execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, () => {});
      } catch {}
    } else {
      log(`DSH 端口变了（${line.replace(/^.*\]\s*/, '')}），但没有在跑的桥接进程，等守护循环自行拉起`);
    }
    lastBusy = '';
  } else if (code !== 0) {
    const brief = '还没找到正在运行的 DSH，继续等…';
    if (lastBusy !== brief) { log(brief); lastBusy = brief; }
  } else {
    lastBusy = '';
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
