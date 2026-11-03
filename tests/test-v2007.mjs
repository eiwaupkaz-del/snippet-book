// 依頼101〜105 スニペット帳 V2.00.003〜 の手元テスト（Node 18 以降）
// 使い方：node test-v2007.mjs [snippet-book.html] [snippet.conf]
// 1. 自動パスワード（genPassphrase）を HTML から切り出して試す
// 2. 外のサイトを読まない・フォントがそろっている
// 3. CSP のハッシュが HTML のスクリプトと合う
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2] || join(here, 'snippet-book.html');
const confPath = process.argv[3] || join(here, '..', 'snippet.conf');
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
ok(/const APP_VERSION = 'V2\.00\.007';/.test(html), "APP_VERSION が 'V2.00.007'");

console.log('7. 取り込みの検査（V2.00.004〜）');
{
  // asText / asList / asObj と normalizeSet を HTML から切り出して試す
  const i1 = html.indexOf('const asText'), i2 = html.indexOf('function normalize(b)');
  const j1 = html.indexOf('function normalizeSet(s)'), j2 = html.indexOf('/* V2.00.004〜 読み込むファイルの上限');
  const N = new Function('let n = 0; const uid = () => \'u\' + (n++);' + html.slice(i1, i2) + html.slice(j1, j2) + '\nreturn { asText, normalizeSet };')();
  const tricky = { toString: 1 };
  const s = N.normalizeSet({ name: { a: 1 }, items: [{ title: tricky, text: 12345, user: [1, 2], secret: 'yes' }, null, 'x', { title: 't', text: 'ok', secret: true }] });
  ok(s.name === '読み込み', '名前が文字でなければ「読み込み」');
  ok(s.items.every(o => typeof o.title === 'string' && typeof o.text === 'string' && typeof o.user === 'string'), 'カードの中身はすべて文字になる');
  ok(s.items[0].text === '12345' && s.items[0].title === '' && s.items[0].user === '', '数は文字に・ほかの形は空に');
  ok(s.items[3].secret === true && N.normalizeSet({items:[{}]}).items[0].secret === false, '秘匿の印は前と同じ扱い（前の版のデータの印を落とさない）');
  ok(N.normalizeSet(null).items.length === 0 && N.normalizeSet({ items: 'abc' }).items.length === 0, 'null や文字の items でも止まらない');
  ok(/function readJSONFile/.test(html) && /MAX_FILE_BYTES = 5 \* 1024 \* 1024/.test(html), '5MB を超えるファイルは読まない');
  ok((html.match(/await readJSONFile\(file\)/g) || []).length === 4 && !/JSON\.parse\(await file\.text\(\)\)/.test(html.replace(/async function readJSONFile[\s\S]*?\n  }/, '')), 'ファイルを読む4か所すべてが readJSONFile を通る');
  ok(/checkLimits\(book\.sets\.concat\(incoming\)\);\s*book\.sets\.push\(\.\.\.incoming\)/.test(html), '全部確かめてから足す（途中で失敗したら何も足さない）');
}

console.log('8. 自動ロックとクリップボード（V2.00.004〜）');
{
  ok(/AUTO_LOCK_CHOICES = \[1, 5, 15, 30, 0\]/.test(html) && /autoLockMin\) \? p\.autoLockMin : 5/.test(html), '自動ロックは 1・5・15・30分・しない、既定 5 分');
  ok(/CLIP_CLEAR_CHOICES = \[30, 0\]/.test(html) && /clipClearSec\) \? p\.clipClearSec : 30/.test(html), 'クリップボードは 30 秒で空に（しないも選べる）・既定 30 秒');
  ok(/setInterval\(checkAutoLock, 10000\)/.test(html) && /visibilitychange[\s\S]{0,80}checkAutoLock/.test(html), '10 秒ごとと、画面に戻ったときに確かめる');
  ok(/if \(savePending && cryptoKey && !viewOnly\)[\s\S]{0,80}await persist\(\)/.test(html), 'ロックの前に保存待ちを書く');
  const pwCopies = (html.match(/のパスワードをコピー`, true\)/g) || []).length;
  ok(pwCopies === 2, 'パスワードのコピー（ボタンとショートカット）は空にする予定を立てる');
  ok(/writeClip\(formatRecoveryKey\(rk\)\);\s*if \(ok\) scheduleClipClear\(\)/.test(html) && /writeClip\(pw\);\s*if \(ok\) scheduleClipClear\(\)/.test(html), '復元キー・送るパスワードのコピーも空にする');
  ok(/document\.addEventListener\('copy'/.test(html), 'この画面でほかの物をコピーしたら予定を取り消す');
}

console.log('9. ロックのとき画面に中身を残さない（V2.00.005〜）');
{
  const w1 = html.indexOf('function wipeScreen()'), w2 = html.indexOf('\n  }', w1);
  const wipe = w1 > 0 ? html.slice(w1, w2) : '';
  ok(w1 > 0, 'wipeScreen がある');
  const ln = html.indexOf('async function lockNow()');
  const lockBody = html.slice(ln, html.indexOf('\n  }\n', ln));
  ok(/dkRaw = null;\s*wipeScreen\(\);/.test(lockBody), 'ロックで鍵を消したすぐあとに wipeScreen を呼ぶ（手でも自動でも同じ lockNow）');
  for (const id of ['keysOverlay','openOverlay','rkOverlay','sendOverlay','exitOverlay'])
    ok(wipe.includes(`'${id}'`), `ロックで ${id} を閉じる`);
  ok(/\$\('sendPw'\)\.textContent = '—'/.test(wipe), '送るパスワードの表示を消す');
  ok(/\$\('openRk'\)\.value = ''/.test(wipe) && /\$\('rkConfirm'\)\.value = ''/.test(wipe), '復元キーの入力欄を空にする');
  ok(/list\.innerHTML = ''/.test(wipe) && /setsEl\.innerHTML = ''/.test(wipe), 'カードとセットの部品を消す（編集欄のパスワードも一緒に消える）');
  ok(/search\.value = ''/.test(wipe) && /\$\('dataName'\)\.value = ''/.test(wipe) && /\$\('status'\)\.textContent = ''/.test(wipe), '検索・データ名・状態の表示（コピーした文の頭）を消す');
  ok(/rkCloser\(false\)/.test(wipe) && /openCloser\(null\)/.test(wipe), '開いている途中の画面は、待っている処理も終わらせる');
  const ao = html.slice(html.indexOf('function askOpen('), html.indexOf('/* ---------- パスキーを登録する'));
  ok(/const close = dk => \{[\s\S]{0,120}\$\('openRk'\)\.value = ''/.test(ao), 'ファイルを開く画面は、開けた・やめたときにも復元キーを消す');
}

console.log('10. 案内の言葉（V2.00.005〜）');
{
  ok(/漏れたかもしれないとき<\/b>は「鍵をすべて作り直す」/.test(html), '漏れたときは「鍵をすべて作り直す」と案内する');
  ok(!/無くしたとき・人に見られたときは作り直してください/.test(html), '「人に見られたら復元キーを作り直す」という前の案内は消した');
  ok(/30 秒後に空にする/.test(html) && /戻らなければ、クリップボードに残ります/.test(html) && /Win＋V/.test(html), 'クリップボードは「30 秒後に」・残る場合と履歴のことも書く');
}

console.log('11. 処理の途中でロックしたら、終わったあとに何もしない（V2.00.006〜）');
{
  ok(/let lockEpoch = 0;/.test(html) && /const lockedSince = ep => ep !== lockEpoch;/.test(html), 'ロックの番号（lockEpoch）がある');
  ok(/async function lockNow\(\) \{\s*lockEpoch\+\+;/.test(html), 'ロックのいちばん最初に番号を進める（保存待ちを書くより先）');
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const send = sect("getElementById('sendSet').addEventListener", "getElementById('sendCopy')");
  ok(/const ep = lockEpoch;[\s\S]*await makePwFile[\s\S]*if \(lockedSince\(ep\)\) return;[\s\S]*downloadJSON[\s\S]*sendPw'\)\.textContent = filePw/.test(send), '送る：暗号化のあと、ロックされていたら書き出さず・パスワードを見せない');
  const exp = sect("getElementById('exportEnc').addEventListener", 'BACKUP (overwrite backup');
  ok((exp.match(/if \(lockedSince\(ep\)\) return;\s*downloadJSON/g) || []).length === 2, '全体を書き出し：ファイル専用パスワード・アプリの鍵の両方で、ロックされていたら書き出さない');
  const bak = sect('async function writeOverwriteBackup()', '\n  }\n');
  ok(/await makeV5File[\s\S]*if \(lockedSince\(ep\)\) return null;[^\n]*\n\s*downloadJSON/.test(bak), '上書きバックアップ：ロックされていたら書き出さず、完了の画面も出さない');
  const imp = sect("getElementById('importFile').addEventListener", 'async function decryptImport');
  ok(/data = await decryptImport\(data\);[\s\S]{0,80}\}\s*if \(lockedSince\(ep\)\) return;/.test(imp) && imp.indexOf('lockedSince(ep)') < imp.indexOf('book.sets.push'), '読み込み：復号のあと、ロックされていたら足さない');
  const cp = sect('async function copyText(', '\n  }\n');
  ok(/scheduleClipClear\(\);[^\n]*\n\s*if \(lockedSince\(ep\)\) return;[\s\S]*stamp\(index\)[\s\S]*showToast/.test(cp), 'コピー：空にする予定は立て、ロックされていたら印と知らせ（コピーした文の頭）を出さない');
  const pk = sect('async function addPasskey()', '\n  }\n');
  ok(/await registerPasskey[\s\S]{0,260}if \(lockedSince\(ep\) \|\| !dkRaw\)/.test(pk), 'パスキーの登録：本人確認のあと、ロックされていたら登録をやめる');
}

console.log('12. 鍵の処理の途中でロックしても、ロックのあとに何も変えない・開き直さない（V2.00.007〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const nv = sect('async function startNewVault(', '\n  }\n');
  ok(/const ep = lockEpoch;/.test(nv) && /await encryptJSON\(key, content\);\s*if \(lockedSince\(ep\)\) \{ dk\.fill\(0\); return false; \}/.test(nv), '鍵をすべて作り直す・新しく作る：計算のあと、ロックされていたら何も書かずにやめる');
  const tail = nv.slice(nv.indexOf('if (lockedSince(ep))'), nv.indexOf('enterApp();'));
  ok(tail.length > 0 && !/await /.test(tail.replace(/\/\/[^\n]*/g, '')), 'ロックを確かめてから enterApp までは await をはさまない（データと鍵の書きこみがずれない・開き直さない）');
  ok(!/await openSession\(dk\);\s*book = content;\s*await persist\(\);/.test(nv), '前の形（openSession → persist → saveVaultMeta を await でつなぐ）は使わない');
  const pk = sect('async function addPasskey()', '\n  }\n');
  ok(/await makePasskeyWrap\([^\n]*\n[^\n]*\n\s*if \(lockedSince\(ep\) \|\| !dkRaw\) throw stopped\(\);/.test(pk), 'パスキーの登録：包んだあとにもう一度確かめ、ロックされていたら足さない');
  const pkTail = pk.slice(pk.indexOf('// ここから先は'), pk.indexOf('await saving;'));
  ok(pkTail.length > 0 && !/await /.test(pkTail.replace(/\/\/[^\n]*/g, '')), 'パスキーの登録：足す・保存・知らせるの間に await をはさまない');
  const rg = sect("$('regenRkBtn').addEventListener", "$('rekeyBtn')");
  ok(/const nw = await makeRecoveryWrap\(dkRaw, rk\);\s*if \(lockedSince\(ep\)\) return;/.test(rg), '復元キーの作り直し：包んだあと、ロックされていたら変えない');
  ok(/getElementById\('addPasskeyBtn'\)|\$\('addPasskeyBtn'\)\.addEventListener\('click', async \(\) => \{[\s\S]{0,120}const ep = lockEpoch;[\s\S]{0,80}if \(!lockedSince\(ep\)\) renderKeys\(\)/.test(html), '鍵の設定の「登録」：ロックされていたら一覧を描き直さない');
  const sv = sect('function save()', '\n  }\n');
  ok(/if \(!lockedSince\(ep\)\) setStatus\(`保存しました/.test(sv), 'ふだんの保存：ロックのあとに「保存しました」を出さない');
  const rm = sect("del.textContent = '外す'", 'li.appendChild(del)');
  ok(/const saving = saveVaultMeta\(\);[\s\S]*renderKeys\(\);[\s\S]*await saving;/.test(rm), 'パスキーを外す：書いてから描くまで await をはさまない');
}

console.log(`合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
