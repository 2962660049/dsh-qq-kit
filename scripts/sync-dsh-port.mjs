// sync-dsh-port.mjs — 自动把 config.json 里的 dsh.baseUrl 对准当前运行的 DSH
//
// 为什么需要：DSH 桌面版每次启动占用的端口会变（实测出现过 19387 / 10564），
// config.json 里写死的 baseUrl 一旦对不上，桥接就会一直报
// 「DSH 不可用，消息入队」，QQ 上只会收到「⏳ 系统服务重启中」。
//
// 判定方法（不依赖 WMI / 进程权限）：
//   1. 读 netstat 拿到所有 127.0.0.1 上的 LISTENING 端口
//   2. 逐个 HTTP GET /，DSH 无凭据时固定回 401
//   3. 对 401 的候选端口，用桥接自己的 dsh-client 铸 cookie 调 settings.describe 确认
//
// 用法：node scripts/sync-dsh-port.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.json');
const DRY = process.argv.includes('--dry');

// 记事本/PowerShell 可能写入 UTF-8 BOM，Node 的 JSON.parse 会炸，这里统一剥掉
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

const OWN_PORTS = new Set([3000, 3001, 3100, 5099]); // SnowLuma / 桥接控制台，不用探

function listeningPorts() {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const ports = new Set();
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.trim().match(/^TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING/i);
        if (m) ports.add(Number(m[1]));
      }
      resolve([...ports].filter((p) => !OWN_PORTS.has(p)));
    });
  });
}

async function looksLikeDsh(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
      redirect: 'manual'
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

async function confirm(port) {
  const mod = await import('file:///' + path.join(ROOT, 'src', 'dsh-client.js').replace(/\\/g, '/'));
  const { NodeApiClient, unwrap, discoverDshLaunchToken } = mod;
  const cfg = readJson(CONFIG);
  const api = new NodeApiClient(`http://127.0.0.1:${port}`, undefined, {
    token: cfg.dsh?.authToken || discoverDshLaunchToken(),
    header: cfg.dsh?.authHeader,
    prefix: cfg.dsh?.authPrefix
  });
  try {
    const desc = unwrap(await api.settings.describe({}), 'settings.describe');
    return Boolean(desc);
  } catch {
    return false;
  }
}

const cfg = readJson(CONFIG);
const current = String(cfg.dsh?.baseUrl ?? '');
console.log('[sync-dsh-port] 当前 config.json dsh.baseUrl =', current || '(空)');

const ports = await listeningPorts();
const candidates = [];
for (const port of ports) {
  if (current.endsWith(':' + port)) candidates.unshift(port); // 先验已有的
  else if (await looksLikeDsh(port)) candidates.push(port);
}
if (!candidates.length) {
  console.log('[sync-dsh-port] ❌ 没发现任何像 DSH 的本地端口（DSH 是不是没启动？）');
  process.exit(1);
}

let found = 0;
for (const port of [...new Set(candidates)]) {
  if (await confirm(port)) { found = port; break; }
}
if (!found) {
  console.log('[sync-dsh-port] ❌ 候选端口应答 401，但用 DSH 凭据确认失败：', candidates.join(', '));
  process.exit(1);
}

const want = `http://127.0.0.1:${found}`;
if (current === want) {
  console.log(`[sync-dsh-port] ✅ 已是最新：${want}`);
  process.exit(0);
}
if (DRY) {
  console.log(`[sync-dsh-port] (dry) 应改为：${want}`);
  process.exit(0);
}

const raw = fs.readFileSync(CONFIG, 'utf8');
const next = raw.replace(/("baseUrl"\s*:\s*)"[^"]*"/, `$1"${want}"`);
fs.writeFileSync(CONFIG, next, 'utf8');
readJson(CONFIG); // 立刻回读校验
console.log(`[sync-dsh-port] ✅ dsh.baseUrl ${current} -> ${want}`);
