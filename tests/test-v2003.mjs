// 依頼101 スニペット帳 V2.00.003 の手元テスト（Node 18 以降）
// 使い方：node tests/test-v2003.mjs [app/snippet-book.html] [deploy/snippet.conf]
// 1. 自動パスワード（genPassphrase）を HTML から切り出して試す
// 2. 外のサイトを読まない・フォントがそろっている
// 3. CSP のハッシュが HTML のスクリプトと合う
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2] || join(here, '..', 'app', 'snippet-book.html');
const confPath = process.argv[3] || join(here, '..', 'deploy', 'snippet.conf');
const html = readFileSync(htmlPath, 'utf8');
const conf = readFileSync(confPath, 'utf8');
const crypto = globalThis.crypto || webcrypto;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ○ ' + label); } else { fail++; console.log('  × ' + label); } };

// core（鍵と暗号）と自動パスワードの部分を切り出す
const a = html.indexOf('/*<core>'), b = html.indexOf('/*</core>*/');
const C = new Function('crypto', html.slice(a, b) + '\nreturn { makePwFile, openV4File, PBKDF2_ITER_NEW };')(crypto);
const g1 = html.indexOf('Passphrase generator'), g2 = html.indexOf('App state');
const genSrc = html.slice(html.indexOf('*/', g1) + 2, html.lastIndexOf('/*', g2));
const G = new Function('crypto', genSrc + '\nreturn { genPassphrase, PW_CHARS, PW_LEN };')(crypto);

console.log('1. 自動パスワード（このセットを送る）');
{
  const pw = G.genPassphrase();
  ok(/^[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){3}$/.test(pw), `5文字ずつ4つ・- で区切る（例 ${pw.slice(0, 5)}-…）`);
  ok(G.PW_CHARS.length === 31 && !/[01OIL]/.test(G.PW_CHARS), '使う文字は31種・0 O 1 I L は使わない');
  const bits = G.PW_LEN * Math.log2(G.PW_CHARS.length);
  ok(bits >= 96, `強さ ${bits.toFixed(1)} ビット（前の版は約24.5ビット）`);
  const N = 4000, cnt = {};
  for (let i = 0; i < N; i++) for (const c of G.genPassphrase().replace(/-/g, '')) cnt[c] = (cnt[c] || 0) + 1;
  ok(Object.keys(cnt).length === 31, '31種がすべて出る');
  const exp = N * 20 / 31;
  const chi = Object.values(cnt).reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
  ok(chi < 70, `文字の出方に偏りがない（カイ二乗 ${chi.toFixed(1)}・自由度30の目安 70 未満）`);
  const many = new Set(Array.from({ length: 2000 }, () => G.genPassphrase()));
  ok(many.size === 2000, '2000回作って同じものが出ない');
  ok(!/Math\.random/.test(genSrc), 'Math.random を使っていない（crypto.getRandomValues だけ）');
}

console.log('2. 自動パスワードで作ったファイル');
{
  const pw = G.genPassphrase();
  const payload = { version: 4, kind: 'set', name: '仕事', items: [{ title: 'サーバー', user: 'kaz', text: '秘密', secret: true }] };
  const f = await C.makePwFile(pw, payload, { mode: 'own', set: '仕事' });
  ok(f.iter === 600000 && f.kdf === 'pbkdf2', 'PBKDF2 60万回（ファイルの形は前の版と同じ）');
  const back = await C.openV4File(f, pw);
  ok(JSON.stringify(back) === JSON.stringify(payload), '同じパスワードで開ける');
  let bad = false; try { await C.openV4File(f, pw.replace(/-/g, '')); } catch { bad = true; }
  ok(bad, '- をぬくと開けない（- もパスワードの一部・画面のコピーボタンでそのまま渡す）');
  const old = await C.makePwFile('Sakura-kumo-Mori-42!', payload, {});
  ok(JSON.stringify(await C.openV4File(old, 'Sakura-kumo-Mori-42!')) === JSON.stringify(payload), '前の版の形のパスワードで作ったファイルも開ける');
}

console.log('3. ファイル専用パスワード（自分で決めるもの）');
ok(/p1\.length < 12/.test(html) && !/p1\.length < 8/.test(html), '12文字より短いと書き出さない');

console.log('4. 外のサイトを読まない');
{
  ok(!/googleapis|gstatic/.test(html), 'Google Fonts を読まない');
  const ext = html.match(/(?:src|href)\s*=\s*["']?https?:/gi) || [];
  ok(ext.length === 0, 'src・href に外の URL が無い');
  ok(!/@import|url\(\s*["']?https?:/i.test(html), 'CSS でも外の URL を読まない');
  for (const w of [400, 500, 600]) {
    const p = join(dirname(htmlPath), `fonts/ibm-plex-mono-${w}.woff2`);
    const okf = existsSync(p) && readFileSync(p).subarray(0, 4).toString('latin1') === 'wOF2';
    ok(okf && html.includes(`url(fonts/ibm-plex-mono-${w}.woff2)`), `太さ ${w} のフォントがあり、HTML から読む`);
  }
  ok(existsSync(join(dirname(htmlPath), 'fonts/OFL.txt')), 'フォントのライセンス（OFL）を一緒に置く');
}

console.log('5. CSP（nginx の設定）');
{
  const line = conf.split('\n').find(l => l.includes('Content-Security-Policy')) || '';
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  ok(scripts.length === 1 && !/<script\s/.test(html), 'スクリプトは HTML の中の1つだけ');
  const h = 'sha256-' + createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
  ok(line.includes(`script-src '${h}'`), 'CSP の script-src が HTML のスクリプトのハッシュと合う');
  ok(!/unsafe-inline'[^;]*;/.test(line.split('script-src')[1].split(';')[0] + ';') && !/script-src[^;]*unsafe/.test(line), 'スクリプトの unsafe-inline をやめた');
  ok(/font-src 'self'/.test(line) && !/googleapis|gstatic/.test(line), 'フォントは同じ場所だけ・Google は許さない');
  ok(/connect-src 'none'/.test(line) && /default-src 'none'/.test(line) && /frame-ancestors 'none'/.test(line), "connect-src・default-src・frame-ancestors は 'none' のまま");
  ok(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script>[\s\S]*?<\/script>/, '')), 'HTML に onclick="…" のような書き方が無い（ハッシュ指定でも動く）');
}

console.log('6. 版');
ok(/const APP_VERSION = 'V2\.00\.003';/.test(html), "APP_VERSION が 'V2.00.003'");

console.log(`合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
