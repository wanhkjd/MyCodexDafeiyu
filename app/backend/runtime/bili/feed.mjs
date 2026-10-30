// Picking what she watches: candidates from searches on your tastes, the popular list, the ranking and
// (when logged in) the UPs she follows, scored by taste hits, danmaku density and what you liked before.
// Play counts are deliberately left out so big uploaders do not win every day.
// Ported from dsh-bili-whale tools/commands/feed.mjs (MIT); the rules and weights are the original's.

const JOIN_WORDS = /[\s·,，、/]+|与|和|及|向|的|类/;
const HAN = /^[一-龥]{2}$/;
const STOP_WORDS = new Set(['我为', '添加', '开屏', '广告', '这个', '那个', '什么', '自己', '可以', '就是', '一个']);

export function partsOf(label) {
  return [...new Set(String(label).split(JOIN_WORDS).map(x => x.trim()).filter(x => x.length >= 2))];
}

/** One searchable word per taste: the first piece when it splits, else its last Chinese pair. */
export function searchKeywordOf(label) {
  const parts = partsOf(label);
  if (parts.length > 1) return parts[0];
  if (parts.length === 1 && parts[0].length < 4) return parts[0];
  const pairs = [];
  const all = String(label);
  for (let i = 0; i + 2 <= all.length; i += 1) if (HAN.test(all.slice(i, i + 2))) pairs.push(all.slice(i, i + 2));
  return pairs.at(-1) ?? all;
}

/** Tokens a title may contain to count as a hit for a taste; long pieces also match by Chinese pairs. */
export function tokensOf(label) {
  const parts = partsOf(label), extra = [];
  for (const part of parts) {
    if (part.length < 4) continue;
    for (let i = 0; i + 2 <= part.length; i += 1) if (HAN.test(part.slice(i, i + 2))) extra.push(part.slice(i, i + 2));
  }
  return [...new Set([String(label), ...parts, ...extra])];
}

/** Topic words learned from a title or a reason: Latin words and 3–4 character Chinese runs. */
export function learnTokens(text, ownerName = '') {
  const out = new Set();
  const base = (ownerName ? String(text).split(ownerName).join(' ') : String(text)).replace(/@\S+/g, ' ');
  for (const m of base.matchAll(/[A-Za-z][A-Za-z0-9]{1,}/g)) out.add(m[0].toLowerCase());
  for (const m of base.matchAll(/[一-龥]{2,}/g)) {
    for (const n of [3, 4]) for (let i = 0; i + n <= m[0].length; i += 1) {
      const gram = m[0].slice(i, i + n);
      if (!STOP_WORDS.has(gram)) out.add(gram);
    }
  }
  return [...out];
}

const stripTags = s => String(s ?? '').replace(/<[^>]+>/g, '');
const seconds = value => {
  if (Number.isFinite(Number(value))) return Number(value);
  const p = String(value ?? '').split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
};

/** The candidate pool from every source; a source that fails is skipped and reported in notes. */
export async function gather(client, { likes = [], loggedIn = false } = {}) {
  const pool = [], notes = [];
  const add = (it, kw) => it.bv && pool.push({ ...it, kw });
  const keywords = [...new Set(likes.slice(0, 6).map(searchKeywordOf))];
  for (const [i, kw] of keywords.entries()) {
    const j = await client.json('https://api.bilibili.com/x/web-interface/wbi/search/type', {
      params: { search_type: 'video', keyword: kw, order: i % 2 === 0 ? 'click' : 'pubdate', page: 1 },
      signed: true, ttl: 10 * 60e3, referer: 'https://search.bilibili.com/',
    });
    if (j.code !== 0) { notes.push(`搜「${kw}」失败：${j.message}`); continue; }
    for (const it of (j.data?.result ?? []).slice(0, Math.ceil(60 / Math.max(1, keywords.length)) + 4)) {
      add({ bv: it.bvid, title: stripTags(it.title), duration: seconds(it.duration), danmaku: Number(it.danmaku ?? 0), play: Number(it.play ?? 0), up: String(it.author ?? ''), upMid: String(it.mid ?? ''), cover: String(it.pic ?? '') }, kw);
    }
  }
  const lists = [
    ['热门', 'https://api.bilibili.com/x/web-interface/popular', { pn: 1, ps: 20 }, j => j.data?.list, false],
    ['排行', 'https://api.bilibili.com/x/web-interface/ranking/v2', { rid: 0, type: 'all' }, j => (j.data?.list ?? []).slice(0, 20), true],
  ];
  for (const [kw, url, params, pick, signed] of lists) {
    const j = await client.json(url, { params, signed, ttl: 10 * 60e3 });
    if (j.code !== 0) { notes.push(`${kw}取不到：${j.message}`); continue; }
    for (const it of pick(j) ?? []) {
      add({ bv: it.bvid, title: stripTags(it.title), duration: Number(it.duration ?? 0), danmaku: Number(it.stat?.danmaku ?? 0), play: Number(it.stat?.view ?? 0), up: String(it.owner?.name ?? ''), upMid: String(it.owner?.mid ?? ''), cover: String(it.pic ?? '') }, kw);
    }
  }
  if (loggedIn) {
    const j = await client.json('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all', { params: { type: 'video', page: 1 } });
    if (j.code !== 0) notes.push(`关注的 UP 取不到：${j.message}`);
    else for (const it of j.data?.items ?? []) {
      const a = it?.modules?.module_author, ar = it?.modules?.module_dynamic?.major?.archive;
      if (!ar?.bvid) continue;
      add({ bv: ar.bvid, title: stripTags(ar.title), duration: seconds(ar.duration_text), danmaku: 0, play: Number(ar.stat?.play ?? 0) || 0, up: String(a?.name ?? ''), upMid: String(a?.mid ?? ''), cover: String(ar.cover ?? '') }, '关注');
    }
  }
  for (const it of pool) it.cover = it.cover.replace(/^(?:https?:)?\/\//, 'https://');
  return { pool, notes };
}

/**
 * Rank and pick n candidates: unseen, not hers, no junk (play < 300 and danmaku < 3, unless it hits two
 * tastes), not matching a dislike; score = log density × 3 + taste hits × 4 + learned boost − learned dislike;
 * at most 2 per taste combination and 3 that hit no taste.
 */
export function pick(pool, { likes = [], dislikes = [], seen = new Set(), selfName = '', liked = [], disliked = [], ownerName = '', n = 5, per = 2 } = {}) {
  const tastes = likes.map(label => ({ label, tokens: tokensOf(label) }));
  const avoid = dislikes.flatMap(tokensOf);
  const hitsOf = title => tastes.filter(t => t.tokens.some(tok => title.includes(tok))).map(t => t.label);
  const learned = [...new Set(liked.flatMap(t => learnTokens(t, ownerName)))];
  const unlearned = [...new Set(disliked.flatMap(t => learnTokens(t, ownerName)))];
  const count = (tokens, title) => tokens.filter(tok => title.toLowerCase().includes(tok)).length;
  const densityOf = x => Math.log10(1 + x.danmaku / Math.max(30, x.duration));
  const scoreOf = x => densityOf(x) * 3 + hitsOf(x.title).length * 4 + Math.min(7.5, count(learned, x.title) * 2.5) - Math.min(7.5, count(unlearned, x.title) * 2.5);
  const unique = [...new Map(pool.map(x => [x.bv, x])).values()]
    .filter(x => /^BV[0-9A-Za-z]{10}$/.test(x.bv) && !seen.has(x.bv))
    .filter(x => !(selfName && x.up.includes(selfName)))
    .filter(x => !avoid.some(tok => x.title.includes(tok)))
    .filter(x => !(x.play < 300 && x.danmaku < 3) || hitsOf(x.title).length >= 2)
    .map(x => ({ ...x, hits: hitsOf(x.title), score: Math.round(scoreOf(x) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
  const used = {}, out = [];
  for (const x of unique) {
    const kind = x.hits.length ? x.hits.join('+') : '';
    used[kind] = (used[kind] ?? 0) + 1;
    if (used[kind] > (x.hits.length ? per : 3)) continue;
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}
