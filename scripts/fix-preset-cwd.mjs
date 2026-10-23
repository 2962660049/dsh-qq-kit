// fix-preset-cwd.mjs — 修掉新版 DSH 的 "{{cwd}}" 报错
//
// 症状（每个 QQ 会话都直接失败，DSH 里能看到）：
//   unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
//   registered variables: provider, model
//
// 原因：qq-bridge 的 qq-chat / qq-chat-v2 预设里写了
//   suffix: Your working directory is {{cwd}}.
// 但新版 DSH 只注册 provider / model 两个提示词变量。
//
// 做法：把 {{cwd}} 直接替换成字面量 "the QQ chat workspace"，句子其余部分不动。
// 要改 4 个文件（2 个源 yml + 2 个由脚本生成的 patch.yml），改完【必须重启 DSH】。
//
// 用法：
//   node fix-preset-cwd.mjs [桥接目录]          # 默认 D:\qq-bridge
//   node fix-preset-cwd.mjs D:\qq-bridge --dry  # 只看会改什么，不落盘
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:\\qq-bridge');
const DRY = process.argv.includes('--dry');
const REPLACEMENT = 'the QQ chat workspace';
const NEEDLE = /\{\{\s*cwd\s*\}\}/g;

const TARGET_DIRS = [
  path.join(ROOT, 'dsh', 'agent-presets'),
  path.join(ROOT, 'plugins', 'qq-agent-presets', 'presets')
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(yml|yaml)$/i.test(e.name)) out.push(p);
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error(`[fix-cwd] 桥接目录不存在：${ROOT}`);
  process.exit(1);
}

const files = TARGET_DIRS.flatMap(walk);
if (!files.length) {
  console.error('[fix-cwd] 没找到任何 yml，确认桥接目录是否正确（应含 dsh\\agent-presets\\）');
  process.exit(1);
}

let touched = 0;
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const shown = path.relative(ROOT, file);
  let hit = false;
  const lines = raw.split(/\r?\n/).map((line) => {
    // 注释里的 {{cwd}} 是无害说明文字，不要动
    if (/^\s*#/.test(line)) return line;
    if (!/\{\{\s*cwd\s*\}\}/.test(line)) return line;
    hit = true;
    return line.replace(/\{\{\s*cwd\s*\}\}/g, REPLACEMENT);
  });
  if (!hit) continue;
  if (DRY) {
    console.log(`[fix-cwd] (dry) 会修改：${shown}`);
    touched += 1;
    continue;
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`[fix-cwd] ✅ 已修改：${shown}`);
  touched += 1;
}

if (!touched) {
  console.log('[fix-cwd] ✅ 4 处全是好的，没有 {{cwd}}，无需修改');
  process.exit(0);
}

console.log('');
console.log(`[fix-cwd] 共处理 ${touched} 个文件。`);
console.log('[fix-cwd] ⚠️ 必须重启 DSH 才生效（预设只在 DSH 启动时装配）。');
