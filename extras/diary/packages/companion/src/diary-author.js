/**
 * 日记作者 · 让她自己写，不是让你替她打
 * ─────────────────────────────────────────────────────────────
 * diary.js 只负责「存」。这一层负责「写」：
 *   角色卡 + 她记得的人 + 今天聊过的话 + 最近几篇日记 → 生成一条新的
 *
 * 为什么不用 Brain.reply：
 *   Brain 是对话形状（接一句话、回一句话）。日记是独白：
 *   没有人在跟她说话，她得自己找话说。混用会把日记写成汇报。
 *
 * 输出严格 JSON，解析失败会自动兜底（把整段当正文），不会崩。
 */
import fs from 'node:fs';
import path from 'node:path';

const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 换着写，别每次都从同一个角度开口 */
const ANGLES = [
  '窗外 / 天气 / 光线',
  '你自己身上的小毛病（懒、嘴硬、爱较真……挑一个）',
  '一件特别小的事：吃的、喝的、看到的东西',
  '突然想起以前的一件事',
  '你嘴上没说出口的那句话',
  '你偷偷干的事',
  '某样让你烦的东西',
  '今天想他但没说的那部分',
  '你正在等的东西',
];

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}（${WEEK[d.getDay()]}）`;
}

/** 从模型回复里抠出 JSON —— 带 ```json 围栏、前后有废话都能处理 */
export function parseLoose(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      if (o && typeof o === 'object') {
        return {
          text: String(o.text ?? o.body ?? o.content ?? '').trim(),
          title: o.title ? String(o.title).trim() : '',
          mood: o.mood ? String(o.mood).trim() : '',
          tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
        };
      }
    } catch { /* 落到兜底 */ }
  }
  return { text: s, title: '', mood: '', tags: [] };
}

/**
 * 生成一条日记（不落盘，交给调用方 add）
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string} [o.baseUrl='https://api.deepseek.com/v1']
 * @param {string} [o.model='deepseek-chat']
 * @param {string} [o.roleText]     角色卡正文（没有就写通用人格）
 * @param {string} [o.memoryText]   她记得的人 / 最近聊过的话
 * @param {string} [o.diaryText]    最近几篇日记（Diary.context() 的输出）
 * @param {number} [o.maxChars=2000]
 * @param {number} [o.timeoutMs=90000]
 * @param {string} [o.hint]         今晚有没有特别想写的（可空）
 */
export async function composeDiary({
  apiKey, baseUrl = 'https://api.deepseek.com/v1', model = 'deepseek-chat',
  roleText = '', memoryText = '', diaryText = '', avoidText = '', maxChars = 2000,
  timeoutMs = 90000, hint = '', temperature = 1.15, now = new Date(), angle = '',
} = {}) {
  if (!apiKey) throw new Error('没有 apiKey —— 先跑一遍 tools\\安装.bat 填进 config.json');
  if (!/^[\x20-\x7e]+$/.test(apiKey)) {
    throw new Error('config.json 里的 apiKey 还是占位符，去 platform.deepseek.com 拿一个真的填进去');
  }

  const picked = angle || ANGLES[Math.floor(Math.random() * ANGLES.length)];

  const sys = [
    roleText ? '【你的角色卡】\n' + roleText.slice(0, 9000) : '【你的人设】你是一个住在别人电脑里的女孩子，有自己的脾气和小日子。',
    '',
    '【现在要做的事】写一篇你自己的日记。',
    '硬规矩：',
    '1. 第一人称，像自己跟自己说话，口语，短句。',
    '2. 1~4 句就够，别写作文，别写总结句（"今天真是充实的一天"这种一律不要）。',
    '3. 不带 Markdown、不带标题符号、不列点。',
    '4. 写具体的事：谁说了什么、你干了什么、你当时什么心情。',
    '5. 提到人就用名字，别写"用户""对方"。',
    '6. 时间就是现在 —— 别自己编一个钟点（比如现在是下午，别写成半夜）。',
    '7. 上面给你的日记是**已经写过的**：不许重复那些事，也不许重复同样的标题，换一件别的、或者换个角度。',
    '8. 给你一个今天的开口角度，就往这个方向写（别把"角度"两个字写进正文）：' + picked,
    '9. 只输出一个 JSON，不要解释：',
    '{"title":"不超过12字的小标题","mood":"两三个字","tags":["标签1","标签2"],"text":"日记正文"}',
  ].join('\n');

  const user = [
    `现在是 ${stamp(now)}。`,
    diaryText ? '\n' + diaryText.trim() : '',
    avoidText ? '\n【这几件已经写过了，别重复】\n' + avoidText.trim() : '',
    memoryText ? '\n【你记得的人和事】\n' + memoryText.trim() : '',
    hint ? '\n【今晚想写的是】\n' + hint.trim() : '',
    '\n有的写就写今天真发生的；没得写就写你自己的小事。现在写这一篇，只输出 JSON。',
  ].filter(Boolean).join('\n');

  const res = await fetch(String(baseUrl).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error('模型返回 ' + res.status + '：' + raw.slice(0, 300));

  let json;
  try { json = JSON.parse(raw); } catch { throw new Error('模型返回不是 JSON：' + raw.slice(0, 200)); }
  const content = String(json.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('模型没说话（可能被截断）');

  const out = parseLoose(content);
  if (!out.text) throw new Error('解析出来的正文是空的');
  if (out.text.length > maxChars) out.text = out.text.slice(0, maxChars);
  return out;
}

/** 从 config.json 读模型设置（和 index.js 同一份，别搞两套） */
export function readModelConfig(configFile) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch { throw new Error('读不到 ' + configFile + '（复制 config.example.json 改名成 config.json 就行）'); }

  const dir = path.dirname(path.resolve(configFile));
  const rel = (p, def) => path.resolve(dir, p || def);

  return {
    apiKey: cfg.apiKey || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
    model: cfg.model || 'deepseek-chat',
    roleCard: rel(cfg.roleCard, 'role.md'),
    dataDir: rel(cfg.dataDir, 'data'),
    diaryDir: rel(cfg.diaryDir, 'data/diary'),
    diaryMaxChars: cfg.diaryMaxChars || 2000,
  };
}
