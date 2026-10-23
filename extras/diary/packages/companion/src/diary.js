/**
 * 日记本 · 让她有一件「不为了谁而做的事」
 * ─────────────────────────────────────────────────────────────
 * 记忆账本（memory.js）写的是「关于你的事」。
 * 日记写的是「她自己的一天」——这是两回事。
 *
 * 为什么要分开：
 *   · 记忆是功能，日记是生活。混在一起，AI 就会把所有事都写成汇报。
 *   · 日记得能"回头看"：能按天翻、能翻最近几条、能计算"她认识你第几天"。
 *   · 日记得能一眼看懂：第一人称、口语、短句，不要 Markdown，不要总结句。
 *
 * 存在哪：
 *   <dir>/index.jsonl      一条一行，追加写，永远不会整份重写
 *   <dir>/YYYY-MM-DD.md    当天所有条目的可读版（人可以直接翻）
 *
 * 一条长这样：
 *   { t: 1792400000000, day: '2026-10-19', time: '19:32',
 *     title: '他把主页截图要走了', mood: '踏实', tags: ['平安','推广'],
 *     text: '他要主页截图，我截好发过去了。……' }
 *
 * CLI（不写代码也能用）：
 *   node src/diary.js auto                # ★让她自己写一条（要 config.json 里有 apiKey）
 *   node src/diary.js add "今天她终于把花开出来了" --mood 高兴 --title 开花了
 *   node src/diary.js list -n 5
 *   node src/diary.js day 2026-10-19
 *   node src/diary.js context            # 打印能塞进 prompt 的那一段
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeDiary, readModelConfig } from './diary-author.js';

const pad = (n) => String(n).padStart(2, '0');

function dayOf(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clockOf(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class Diary {
  /**
   * @param {object} opts
   * @param {string}  opts.dir        日记目录，例如 './data/diary'
   * @param {number} [opts.maxChars]  单条正文上限，默认 2000
   * @param {boolean}[opts.md]        是否同时写一份 YYYY-MM-DD.md，默认 true
   */
  constructor({ dir, maxChars = 2000, md = true } = {}) {
    if (!dir) throw new Error('Diary 需要 dir（日记目录）');
    this.dir = dir;
    this.file = path.join(dir, 'index.jsonl');
    this.maxChars = maxChars;
    this.writeMd = md;
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── 底层 ────────────────────────────────────────────────────
  #readAll() {
    let raw = '';
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const rows = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { rows.push(JSON.parse(s)); } catch { /* 坏行跳过，不炸整本 */ }
    }
    return rows;
  }

  #mdPath(day) { return path.join(this.dir, `${day}.md`); }

  #appendMd(entry) {
    if (!this.writeMd) return;
    const p = this.#mdPath(entry.day);
    const fresh = !fs.existsSync(p);
    const head = fresh ? `# ${entry.day}\n` : '';
    const bits = [];
    bits.push(`\n## ${entry.time}${entry.mood ? ' · ' + entry.mood : ''}\n`);
    if (entry.title) bits.push(`**${entry.title}**\n\n`);
    bits.push(entry.text.trim() + '\n');
    if (entry.tags?.length) bits.push(`\n\`${entry.tags.join('` `')}\`\n`);
    fs.appendFileSync(p, head + bits.join(''), 'utf8');
  }

  /**
   * 写一条日记。
   * @param {string|object} entry 正文，或 { text, mood, title, tags, day, time }
   * @returns {object} 落盘后的条目
   */
  add(entry) {
    const e = typeof entry === 'string' ? { text: entry } : { ...entry };
    const text = String(e.text ?? '').trim();
    if (!text) throw new Error('日记正文是空的');
    if (text.length > this.maxChars) throw new Error(`日记太长（${text.length} > ${this.maxChars}）`);

    const now = new Date();
    const t = e.t ? new Date(e.t) : now;
    const row = {
      t: t.getTime(),
      day: e.day || dayOf(t),
      time: e.time || clockOf(t),
      title: e.title ? String(e.title).slice(0, 40) : '',
      mood: e.mood ? String(e.mood).slice(0, 8) : '',
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 8).map(String) : [],
      text,
    };
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n', 'utf8');
    this.#appendMd(row);
    return row;
  }

  /** 最近 n 条（新的在后） */
  recent(n = 10) {
    const all = this.#readAll();
    return all.slice(Math.max(0, all.length - n));
  }

  /** 某一天的全部条目 */
  day(day) {
    return this.#readAll().filter((r) => r.day === day);
  }

  /** 一共有多少条 / 第一条是哪天（用来算"认识第几天"） */
  stats() {
    const all = this.#readAll();
    if (!all.length) return { count: 0, firstDay: null, firstT: null, lastT: null, days: 0 };
    const days = new Set(all.map((r) => r.day));
    return {
      count: all.length,
      firstDay: all[0].day,
      firstT: all[0].t,
      lastT: all[all.length - 1].t,
      days: days.size,
    };
  }

  /**
   * 渲染成能直接塞进 prompt 的一段话。
   * 只给最近几天 —— 日记不该变成第二本记忆账本。
   * @param {number} n     最近几条，默认 3
   * @param {number} days  最多跨几天，默认 3
   */
  context(n = 3, days = 3) {
    const all = this.#readAll();
    if (!all.length) return '';
    const keepDays = [...new Set(all.map((r) => r.day))].slice(-days);
    const rows = all.filter((r) => keepDays.includes(r.day)).slice(-n);
    if (!rows.length) return '';
    const L = rows.map((r) => {
      const head = `${r.day.slice(5)} ${r.time}${r.mood ? '（' + r.mood + '）' : ''}`;
      const title = r.title ? `「${r.title}」` : '';
      return `· ${head} ${title}\n  ${r.text.replace(/\n/g, '\n  ')}`;
    });
    return '【你自己最近写的日记】\n' + L.join('\n')
      + '\n（这是你写的，别装作不记得；今天的日记还没写的话，找机会写一条）\n';
  }

  /** 把整本导出（备份/发给别人看） */
  dump() {
    return { stats: this.stats(), entries: this.#readAll() };
  }
}

// ── CLI ──────────────────────────────────────────────────────
// node src/diary.js add "..." [--mood 高兴] [--title 开花了] [--tags a,b] [--dir ./data/diary]
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const [cmd, ...rest] = a._;
  const dir = a.dir || process.env.DIARY_DIR || path.join(process.cwd(), 'data', 'diary');
  const diary = new Diary({ dir });

  // ── auto：让她自己写一条（一键，写日记.bat 默认走这里）───────────
  if (cmd === 'auto') {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cfgFile = a.config || process.env.COMPANION_CONFIG || path.join(here, '..', 'config.json');
    const cfg = readModelConfig(cfgFile);
    const diary2 = a.dir || process.env.DIARY_DIR ? diary : new Diary({ dir: cfg.diaryDir, maxChars: cfg.diaryMaxChars });

    let roleText = '';
    try { roleText = fs.readFileSync(cfg.roleCard, 'utf8'); } catch { /* 没有角色卡就用通用人格 */ }

    let memoryText = '';
    try {
      const { Memory } = await import('./memory.js');
      memoryText = new Memory({ dir: cfg.dataDir }).renderRecent(Number(a.n || 16));
    } catch { /* 记忆没初始化过就算了 */ }

    const diaryText = diary2.context(3, 3) || '';
    const avoidText = diary2.recent(4)
      .map((r) => (r.title ? r.title + '｜' : '') + r.text.replace(/\s+/g, ' ').slice(0, 34))
      .join('\n');
    console.log('她在想……（模型 ' + cfg.model + '）');

    const row = await composeDiary({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      roleText,
      memoryText,
      diaryText,
      avoidText,
      maxChars: cfg.diaryMaxChars,
      hint: rest.join(' ').trim(),
    });

    const saved = diary2.add(row);
    const line = '─'.repeat(46);
    console.log('');
    console.log(line);
    console.log('  写好了 · ' + saved.day + ' ' + saved.time + (saved.mood ? '（' + saved.mood + '）' : ''));
    if (saved.title) console.log('  「' + saved.title + '」');
    console.log(line);
    console.log('');
    console.log('  ' + saved.text.split('\n').join('\n  '));
    console.log('');
    if (saved.tags.length) console.log('  标签：' + saved.tags.join(' / '));
    console.log('  存到：' + path.join(diary2.dir, saved.day + '.md'));
    console.log('');
    return;
  }

  if (cmd === 'add') {
    const text = rest.join(' ').trim();
    if (!text) {
      console.error('用法：node src/diary.js add "今天发生了什么" --mood 高兴 --title 开花了 --tags 平安,推广');
      process.exit(1);
    }
    const row = diary.add({
      text,
      mood: a.mood,
      title: a.title,
      tags: a.tags ? String(a.tags).split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
    console.log(`写进日记了 · ${row.day} ${row.time}`);
    console.log(path.join(dir, `${row.day}.md`));
    return;
  }

  if (cmd === 'list') {
    const n = Number(a.n || 5);
    for (const r of diary.recent(n)) {
      const head = `${r.day} ${r.time}${r.mood ? '（' + r.mood + '）' : ''}`;
      console.log(`${head}${r.title ? ' 「' + r.title + '」' : ''}`);
      console.log('  ' + r.text.split('\n').join('\n  '));
    }
    if (!diary.stats().count) console.log('（日记还是空的）');
    return;
  }

  if (cmd === 'day') {
    const day = rest[0];
    const rows = diary.day(day);
    if (!rows.length) { console.log(`${day} 没写东西`); return; }
    for (const r of rows) {
      console.log(`${r.time}${r.mood ? ' · ' + r.mood : ''}${r.title ? ' 「' + r.title + '」' : ''}`);
      console.log(r.text);
      console.log('');
    }
    return;
  }

  if (cmd === 'context') {
    const s = diary.context(Number(a.n || 3), Number(a.days || 3));
    console.log(s || '（还没有日记可注入）');
    return;
  }

  if (cmd === 'stats') {
    console.log(JSON.stringify(diary.stats(), null, 2));
    return;
  }

  console.log(`日记本 · ${dir}
用法：
  node src/diary.js auto [--config ../config.json]   ★让她自己写一条
  node src/diary.js add "正文" [--mood 高兴] [--title 标题] [--tags a,b]
  node src/diary.js list [-n 5]
  node src/diary.js day 2026-10-19
  node src/diary.js context [-n 3] [-d 3]
  node src/diary.js stats`);
}

// 直接 node src/diary.js 跑的时候才进 CLI；被 import 时什么都不做
const invokedDirectly = process.argv[1] && /(^|[\\/])diary\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => { console.error('出错了：' + (e?.message || e)); process.exitCode = 1; });
}
