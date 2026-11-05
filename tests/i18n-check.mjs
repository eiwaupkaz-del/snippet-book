// 依頼128 V2.02.000〜 英語対応のテストの道具（test-v2200.mjs が使う）
// scan(src) → [{ type:'str'|'tpl'|'line'|'block'|'regex', s, e }]（s〜e は src の中の位置。tpl は ${…} の中も含めて1つ）
const REGEX_PREV = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KW = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

export function scan(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  function skipString(q) {        // src[i] は開きの引用符
    const s = i++;
    while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    i++;
    return s;
  }
  function skipTemplate() {       // src[i] は `
    const s = i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; code('}'); i++; continue; }
      i++;
    }
    i++;
    return s;
  }
  function prevSig(pos) {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    return j;
  }
  function code(stop) {           // stop の文字（深さ0）で止まる。止まった位置が i
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (stop && depth === 0 && c === stop) return;
      if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
      if (c === '}' || c === ')' || c === ']') { depth--; i++; continue; }
      if (c === "'" || c === '"') { const s = skipString(c); out.push({ type:'str', s, e:i }); continue; }
      if (c === '`') { const s = skipTemplate(); out.push({ type:'tpl', s, e:i }); continue; }
      if (c === '/' && src[i + 1] === '/') { const s = i; while (i < n && src[i] !== '\n') i++; out.push({ type:'line', s, e:i }); continue; }
      if (c === '/' && src[i + 1] === '*') { const s = i; const k = src.indexOf('*/', i + 2); i = k < 0 ? n : k + 2; out.push({ type:'block', s, e:i }); continue; }
      if (c === '/') {
        const j = prevSig(i);
        const isRe = j < 0 || REGEX_PREV.has(src[j]) || REGEX_KW.test(src.slice(Math.max(0, j - 10), j + 1));
        if (isRe) {
          const s = i++;
          let inCls = false;
          while (i < n) {
            const d = src[i];
            if (d === '\\') { i += 2; continue; }
            if (d === '[') inCls = true; else if (d === ']') inCls = false;
            else if (d === '/' && !inCls) break;
            else if (d === '\n') break;
            i++;
          }
          i++;
          while (i < n && /[a-z]/i.test(src[i])) i++;
          out.push({ type:'regex', s, e:i });
          continue;
        }
      }
      i++;
    }
  }
  code(null);
  return out;
}

export const JA = /[぀-ヿ㐀-鿿！-｠　-〿]/;

// L( … ) の呼び出しの範囲（L の位置〜閉じかっこの次）と、引数（最初のカンマで分ける）を返す
export function lCalls(src, toks) {
  const calls = [];
  const re = /(?<![\w$.])L\(/g;
  let m;
  const inTok = pos => toks.find(t => t.s <= pos && pos < t.e && t.type !== 'tpl');
  const byStart = new Map(toks.map(t => [t.s, t]));
  while ((m = re.exec(src))) {
    if (inTok(m.index)) continue;   // 文字やコメントの中の「L(」は数えない
    let i = m.index + 2, depth = 0, comma = -1;
    for (; i < src.length; i++) {
      const t = byStart.get(i);
      if (t) { i = t.e - 1; continue; }
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0 && comma < 0) comma = i;
    }
    calls.push({ s: m.index, e: i + 1, ja: src.slice(m.index + 2, comma).trim(), en: src.slice(comma + 1, i).trim() });
  }
  return calls;
}

// 依頼128：英語の画面に日本語が出ないかを調べる。
// 1) スクリプト：コメントと L(日本語, 英語) の外に、日本語の文が残っていない（正規表現の決まった1つだけは除く）
//    L の英語の側（2つ目）に日本語が入っていない（「スニペット帳」と書いたパスキーの名前を指す1語だけは許す）
// 2) HTML の本文：日本語の文字は data-i の付いた部品の中だけ。日本語の placeholder・title・aria-label には data-i-ph・data-i-title・data-i-aria
//    data-i のかぎは、すべて英語の表（EN_HTML）にあり、表の英語に日本語が入っていない
export function checkJa(html) {
  const errs = [];
  const a = html.indexOf('<script>') + 8, b = html.lastIndexOf('</script>');
  const src = html.slice(a, b);
  const toks = scan(src);
  const calls = lCalls(src, toks);
  const ALLOW_RE = ['/[\\s\\-‐－ー_]/g'];   // 復元キーの区切り（全角の - なども許す）
  const ALLOW_EN = /スニペット帳/g;           // 英語の文の中で、日本語のパスキーの名前を指す
  const inCall = pos => calls.some(c => c.s <= pos && pos < c.e);
  for (const t of toks) {
    const txt = src.slice(t.s, t.e);
    if (t.type === 'line' || t.type === 'block' || !JA.test(txt)) continue;
    if (t.type === 'regex' && ALLOW_RE.includes(txt)) continue;
    if (inCall(t.s)) continue;
    errs.push('L() の外の日本語：' + txt.slice(0, 60));
  }
  for (const c of calls) {
    if (!c.en) errs.push('L() の英語が無い：' + c.ja.slice(0, 60));
    else if (JA.test(c.en.replace(ALLOW_EN, ''))) errs.push('英語の側に日本語：' + c.en.slice(0, 60));
  }
  // EN_HTML の表を読む（スクリプトの中のオブジェクト）
  const m = src.match(/const EN_HTML = (\{[\s\S]*?\n  \});/);
  let EN = {};
  if (!m) errs.push('EN_HTML の表が無い');
  else { try { EN = new Function('return ' + m[1])(); } catch (e) { errs.push('EN_HTML が読めない：' + e.message); } }
  for (const [k, v] of Object.entries(EN)) if (JA.test(String(v).replace(ALLOW_EN, ''))) errs.push(`EN_HTML.${k} に日本語`);
  // 本文の HTML を部品に分けて、日本語の文字のある所を調べる
  const body = html.slice(0, html.indexOf('<script>')).replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const VOID = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  const used = new Set();
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let x;
  while ((x = re.exec(body))) {
    if (x[4] !== undefined) {
      if (JA.test(x[4]) && !stack.some(e => e.i)) errs.push('data-i の無い日本語：' + x[4].trim().slice(0, 40));
      continue;
    }
    const [, close, tag, attrs] = x;
    const t = tag.toLowerCase();
    if (close) { while (stack.length && stack.pop().t !== t); continue; }
    const at = name => { const r = attrs.match(new RegExp(`\\s${name}="([^"]*)"`)); return r ? r[1] : null; };
    const i = at('data-i');
    const keep = /\sdata-i-keep\b/.test(attrs);   // 言葉の名前（日本語）は、どちらの言葉でもそのまま
    if (at('id') && stack.some(e => e.i)) errs.push('data-i の部品の中に id のある部品（入れかえると消える）：' + at('id'));
    if (i) { used.add(i); if (!(i in EN)) errs.push('EN_HTML に無いかぎ：' + i); }
    for (const [attr, key] of [['placeholder', 'data-i-ph'], ['title', 'data-i-title'], ['aria-label', 'data-i-aria'], ['content', null]]) {
      const v = at(attr);
      if (v && JA.test(v)) {
        if (!key) { if (t !== 'meta') errs.push(`${attr} の日本語：` + v); continue; }
        const k = at(key);
        if (!k) errs.push(`${key} が無い（${attr}="${v}"）`);
        else { used.add(k); if (!(k in EN)) errs.push('EN_HTML に無いかぎ：' + k); }
      }
    }
    if (!VOID.has(t) && !/\/\s*$/.test(attrs)) stack.push({ t, i: !!i || keep });
  }
  for (const k of Object.keys(EN)) if (!used.has(k)) errs.push('使っていない EN_HTML のかぎ：' + k);
  return { errs, calls: calls.length, keys: Object.keys(EN).length };
}

// L(日本語, 英語) を日本語だけにした HTML（前の版からのテストを、日本語の画面のつもりでそのまま使うため）
export function stripL(html) {
  const a = html.indexOf('<script>') + 8, b = html.lastIndexOf('</script>');
  let src = html.slice(a, b);
  for (let round = 0; round < 5; round++) {
    const toks = scan(src);
    const calls = lCalls(src, toks);
    if (!calls.length) break;
    const outer = calls.filter(c => !calls.some(d => d !== c && d.s <= c.s && c.e <= d.e)).sort((x, y) => y.s - x.s);
    for (const c of outer) src = src.slice(0, c.s) + c.ja + src.slice(c.e);
  }
  return html.slice(0, a) + src + html.slice(b);
}
