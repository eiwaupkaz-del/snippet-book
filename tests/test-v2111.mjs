// 依頼101〜112 スニペット帳 V2.00.003〜 の手元テスト（Node 18 以降）
// 使い方：node test-v2111.mjs [snippet-book.html] [snippet.conf]
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
ok(/const APP_VERSION = 'V2\.01\.011';/.test(html), "APP_VERSION が 'V2.01.011'");

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
  ok((html.match(/await readJSONFileT\(file\)/g) || []).length === 7 && (html.match(/file\.text\(\)/g) || []).length === 1 && /async function readJSONFileT\(file\) \{\s*if \(file\.size > MAX_FILE_BYTES\)[^\n]*\n\s*const text = await file\.text\(\);/.test(html), 'ファイルを読むところはすべて readJSONFileT（大きさを確かめてから読む）を通る（V2.00.010 で「確かめる」を足して6か所＋readJSONFile）');
  ok(/checkLimits\(book\.sets\.concat\(incoming\)\);\s*(if \(pkMerge[\s\S]{0,900}?\}\s*)?book\.sets\.push\(\.\.\.incoming\)/.test(html), '全部確かめてから足す（途中で失敗したら何も足さない）');
}

console.log('8. 自動ロックとクリップボード（V2.00.004〜）');
{
  ok(/AUTO_LOCK_CHOICES = \[1, 5, 15, 30, 0\]/.test(html) && /autoLockMin\) \? p\.autoLockMin : 5/.test(html), '自動ロックは 1・5・15・30分・しない、既定 5 分');
  ok(/CLIP_CLEAR_CHOICES = \[30, 0\]/.test(html) && /clipClearSec\) \? p\.clipClearSec : 30/.test(html), 'クリップボードは 30 秒で空に（しないも選べる）・既定 30 秒');
  ok(/setInterval\(checkAutoLock, 10000\)/.test(html) && /visibilitychange[\s\S]{0,80}checkAutoLock/.test(html), '10 秒ごとと、画面に戻ったときに確かめる');
  ok(/if \(cryptoKey && !viewOnly\) \{\s*if \(savePending\)[\s\S]{0,300}await within\(persistChain\);[\s\S]{0,80}await within\(persist\(\)\)/.test(html), 'ロックの前に保存待ちを書く（動いている保存も待つ）');
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
  ok(/const ep = lockEpoch;[\s\S]*await makePwFile[\s\S]*if \(lockedSince\(ep\)\) return;[^\n]*\n\s*const got = await saveFile[^\n]*\n\s*if \(got\.how === 'cancelled' \|\| lockedSince\(ep\)\)[\s\S]*sendPw'\)\.textContent = filePw/.test(send), '送る：暗号化のあと、ロックされていたら書き出さず・パスワードを見せない');
  const exp = sect("getElementById('exportEnc').addEventListener", 'BACKUP (overwrite backup');
  ok(/if \(lockedSince\(ep\)\) return;\s*if \(\(await saveFile/.test(exp) && /const got = await saveV5Backup\('bk'[^\n]*\n\s*if \(!got\) return;/.test(exp), '全体を書き出し：ファイル専用パスワード・アプリの鍵の両方で、ロックされていたら書き出さない');
  const bak = sect('async function writeOverwriteBackup()', '\n  }\n');
  const sv = sect('async function saveV5Backup(', '\n  }\n');
  ok(/await saveV5Backup\('obk'[\s\S]*if \(!got \|\| lockedSince\(ep\)\) return null;/.test(bak) && /await fileNameTag\(dk, text\);\s*if \(lockedSince\(ep\)\) return null;[^\n]*\n[^\n]*\n\s*const got = await saveFile/.test(sv), '上書きバックアップ：ロックされていたら書き出さず、完了の画面も出さない');
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
  const cv = sect('async function commitVault(', '\n  }\n');
  ok(/const ep = lockEpoch;/.test(nv) && /commitVault\(\{ \.\.\.newVaultMeta\(\[wrap\]\), \.\.\.\(keep \|\| \{\}\) \}, dk, content, ep\)/.test(nv) && /if \(!ok\) \{ dk\.fill\(0\); return false; \}/.test(nv), '鍵をすべて作り直す・新しく作る：ロックされていたら何も書かずにやめる（commitVault に番号を渡す）');
  ok(/await encryptJSON\(key, content\);\s*if \(ep !== undefined && lockedSince\(ep\)\) return false;\s*let ok = true;\s*await writeVault\(\(\) => \{[^\n]*\n\s*if \(ep !== undefined && lockedSince\(ep\)\) \{ ok = false; return null; \}/.test(cv), 'commitVault：計算のあと、ロックを確かめてから1回で書く');
  const cvTail = cv.slice(cv.indexOf('}, () => {'));
  ok(cvTail.length > 0 && !/await /.test(cvTail.replace(/\/\/[^\n]*/g, '')) && /dkRaw = dk; cryptoKey = key; book = content;/.test(cvTail) && /vault = out;\s*if \(onWritten\) onWritten\(out\);/.test(html), '書けたあと、await をはさまずに vault・鍵・本体を切りかえる（開き直さない）');
  const pk = sect('async function addPasskey()', '\n  }\n');
  ok(/await makePasskeyWrap\([^\n]*\n[^\n]*\n\s*if \(lockedSince\(ep\) \|\| !dkRaw\) throw stopped\(\);/.test(pk), 'パスキーの登録：包んだあとにもう一度確かめ、ロックされていたら足さない');
  const pkTail = pk.slice(pk.indexOf('    markNeedsBackup();'));
  ok(pkTail.length > 0 && !/await /.test(pkTail.replace(/\/\/[^\n]*/g, '')), 'パスキーの登録：足す・保存・知らせるの間に await をはさまない');
  const rg = sect("$('regenRkBtn').addEventListener", "$('rekeyBtn')");
  ok(/const nw = await makeRecoveryWrap\(dkRaw, rk\);\s*if \(lockedSince\(ep\)\) return;/.test(rg), '復元キーの作り直し：包んだあと、ロックされていたら変えない');
  ok(/getElementById\('addPasskeyBtn'\)|\$\('addPasskeyBtn'\)\.addEventListener\('click', async \(\) => \{[\s\S]{0,120}const ep = lockEpoch;[\s\S]{0,80}if \(!lockedSince\(ep\)\) renderKeys\(\)/.test(html), '鍵の設定の「登録」：ロックされていたら一覧を描き直さない');
  const sv = sect('function save()', '\n  }\n');
  ok(/if \(!lockedSince\(ep\)\) setStatus\(`保存しました/.test(sv), 'ふだんの保存：ロックのあとに「保存しました」を出さない');
  const rm = sect("del.textContent = '外す'", 'li.appendChild(del)');
  ok(/await writeVault\(\(\) => !lockedSince\(ep\) && vault && vault\.vaultId === vid \? \{ \.\.\.vault,[\s\S]{0,300}\}\s*catch \(e\) \{[^\n]*return; \}\s*if \(lockedSince\(ep\)\) return;\s*markNeedsBackup\(\);\s*renderKeys\(\);/.test(rm), 'パスキーを外す：順番が来たときの一覧から外し、書けてから描く');
}

console.log('13. データと鍵の情報は1回で書く・開けないときに上書きしない（V2.00.008〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  ok(!/store\.set\(DATA5_KEY/.test(html), '本体を別の項目（snippet-book:v5:data）に書くところは1つも無い（読むだけ）');
  ok(!/saveVaultMeta/.test(html), '鍵の情報だけを書く saveVaultMeta は使わない');
  const setMeta = (html.match(/store\.set\(META5_KEY/g) || []).length;
  ok(setMeta === 1 && /try \{ await store\.set\(META5_KEY, JSON\.stringify\(out\)\); \}\s*catch \{ throw new Error\(SAVE_FAIL_MSG\); \}/.test(html), '金庫を書くのは writeVault の1か所だけ・書けなければ throw');
  const ps = sect('async function doPersist(', '\n  }\n');
  ok(/return \{ \.\.\.vault, data: blob \};/.test(ps) && /await writeVault\(\(\) => \{/.test(ps), 'ふだんの保存も、鍵の情報と本体を一緒に1回で書く');
  const pk = sect('async function addPasskey()', '\n  }\n');
  ok(/await writeVault\(\(\) => \{[^\n]*\n\s*if \(lockedSince\(ep\) \|\| !vault \|\| vault\.vaultId !== vid\) throw stopped\(\);[^\n]*\n\s*return \{ \.\.\.vault, wraps: vault\.wraps\.concat\(w\) \};\s*\}\);\s*if \(lockedSince\(ep\)\) return true;[^\n]*\n\s*markNeedsBackup\(\);[\s\S]*showToast\('パスキーを登録しました'\)/.test(pk), 'パスキーの登録：書けてから切りかえて知らせる');
  const rg = sect("$('regenRkBtn').addEventListener", "$('rekeyBtn')");
  ok(/try \{ await writeVault\(\(\) => \{[^\n]*\.concat\(nw\) \}; \}\); \}[^\n]*\n\s*catch \(e\) \{[\s\S]*復元キーは前のままです[\s\S]*return;\s*\}\s*if \(lockedSince\(ep\)\) return;[^\n]*\n\s*\/\/ ここから先は await をはさまない\s*markNeedsBackup\(\);/.test(rg), '復元キーの作り直し：書けなければ前のまま・書けてから切りかえる');
  const fu = sect('async function finishUnlock(', '\n  }\n');
  ok(!/normalize\(SEED\); await persist\(\)/.test(html), '開けないときに見本で上書きして保存する形は無い');
  ok(/catch \{[\s\S]{0,200}cryptoKey = null;[\s\S]{0,200}データを開けませんでした[\s\S]{0,120}手を付けていません[\s\S]{0,80}return;/.test(fu), '開けないときは、鍵を消してロック画面のまま知らせ、データには手を付けない');
  ok(/const blob = await readDataBlob\(vault\);/.test(fu) && /if \(v && v\.data && v\.data\.iv && v\.data\.ct\) return v\.data;[\s\S]{0,80}store\.get\(DATA5_KEY\)/.test(html), '新しい形（meta.data）を先に読み、無ければ前の形（v5:data）を読む');
  ok(/if \(!vault\.data\) \{ try \{ await persist\(\); \} catch \{\} \}/.test(fu), '前の形で開けたら、新しい形へ移す');
  ok(/if \(out\.data\) dropLegacyData\(\);/.test(html), '新しい形で書けたら、前の置き場を消す');
}

console.log('14. パスキーの一覧を合わせる（V2.00.009〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const src = sect('function mergePasskeys(', '\n  }\n') + '\n  }';
  const merge = new Function(src + '\nreturn mergePasskeys;')();
  const pk = (id, label) => ({ type:'passkey', credId:id, prfSalt:'s', label, salt:'s', iv:'i', ct:'c', created:1 });
  const rc = tag => ({ type:'recovery', salt:'s'+tag, iv:'i', ct:'c'+tag, created:1 });
  const mac = { vaultId:'V', wraps:[rc('A'), pk('mac','Mac の Chrome')] };
  const iph = { vaultId:'V', wraps:[rc('A'), pk('mac','Mac の Chrome'), pk('iph','iPhone の Safari')] };
  let m = merge(mac, iph);
  ok(m.wraps.filter(w => w.type === 'passkey').map(w => w.credId).join() === 'mac,iph' && m.added === 1, 'ほかの端末のパスキーが足される（同じものは二重にしない）');
  ok(m.wraps.filter(w => w.type === 'recovery').length === 1 && m.wraps.find(w => w.type === 'recovery').ct === 'cA', '復元キーはこの端末のものだけ');
  m = merge({ vaultId:'V', wraps:[rc('NEW'), pk('mac','m')] }, { vaultId:'V', wraps:[rc('OLD'), pk('mac','m')] });
  ok(m.wraps.filter(w => w.type === 'recovery').map(w => w.ct).join() === 'cNEW', '作り直した古い復元キーは、古いバックアップから戻らない');
  m = merge({ vaultId:'V', wraps:[rc('A'), pk('mac','m')], revoked:['iph'] }, iph);
  ok(!m.wraps.some(w => w.credId === 'iph') && m.revoked.includes('iph'), 'この端末で外したパスキーは、ほかの端末のバックアップから戻らない');
  m = merge(iph, { vaultId:'V', wraps:[rc('A'), pk('mac','m')], revoked:['iph'] });
  ok(!m.wraps.some(w => w.credId === 'iph') && m.removed === 1, 'ほかの端末で外したパスキーは、この端末でも外れる');
  m = merge(mac, { vaultId:'V', wraps:[null, 'x', { type:'passkey', credId: 5 }, { type:'passkey', credId:'bad' }, pk('ok','o')], revoked:[1, 'z'] });
  ok(m.wraps.filter(w => w.type === 'passkey').map(w => w.credId).join() === 'mac,ok' && m.revoked.join() === 'z', '形のおかしい項目は足さない・印は文字だけ');
  const mf = sect("$('mergePkFile').addEventListener", "$('regenRkBtn')");
  ok(/data\.vaultId !== vault\.vaultId[\s\S]*await decryptJSON\(cryptoKey, data\)[\s\S]*mergePasskeys\(vault, data\)/.test(mf), '「合わせる」：同じ金庫で、この鍵で開ける（本物の）ファイルのときだけ合わせる');
  ok(/await writeVault\(\(\) => \{[^\n]*\n\s*if \(!vault \|\| vault\.vaultId !== vid\) return null;\s*got = mergePasskeys\(vault, data\);/.test(mf), '「合わせる」：順番が来たときの一覧で合わせ直し、書けてから切りかえる');
  const fu = sect('async function finishUnlock(', '// 通常起動');
  ok(/restored = await decryptJSON\(await importDK\(useDk\), wrapper\);\s*insp = await inspectV5\(useDk, wrapper[\s\S]{0,200}if \(insp\.auth === 'bad'\) throw[\s\S]{0,800}\} else if \(insp\.auth === 'ok'\) \{[\s\S]{0,120}mergePasskeys\(vault, wrapper\)/.test(fu), '上書き用バックアップ（同じ金庫）：開けて、改ざんの印が合ったときだけ一覧を合わせる（V2.00.010〜）');
  ok(/revoked: \[\.\.\.new Set\(\[\.\.\.\(vault\.revoked \|\| \[\]\), w\.credId\]\)\]/.test(html), 'パスキーを外したら、外した印を残す');
  ok(/const revoked = Array\.isArray\(meta\.revoked\)[\s\S]{0,400}\.\.\.revoked, \.\.\.hist, \.\.\.\(await encryptJSON/.test(html) && /if \(Array\.isArray\(meta\.revoked\) && meta\.revoked\.length\) next\.revoked = meta\.revoked;/.test(html), '外した印は、バックアップにも新しい金庫にも引き継ぐ');
}

console.log('15. 改ざんを見分ける印・履歴・ファイル名の印・保存先を選ぶ（V2.00.010〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  // 履歴を合わせる関数そのものを動かす
  const hsrc = sect('const HIST_KINDS', '  // V2.00.010〜 開いた・閲覧したこと');
  const H = new Function('ua', 'isIOS', 'localStorage', hsrc + '\nreturn { mergeHistory, histEntry, isBackupKind, HIST_MAX, historyForBackup };')('Mozilla/5.0 (Macintosh) Chrome/130 Safari/537', false, { getItem: () => '事務所の MacBook' });
  const e = H.histEntry('obk');
  ok(e.device === '事務所の MacBook' && e.browser === 'Chrome' && e.kind === 'obk' && Number.isFinite(e.at), '履歴の1行：端末の名前（付けた名前）・ブラウザ・日時・種類');
  let m = H.mergeHistory([{ ...e }], [{ ...e, tag:'ABCDEFGHJK' }, { at:1, device:'iPhone', browser:'Safari', kind:'open', how:'pk' }]);
  ok(m.length === 2 && m[0].at === 1 && m[1].tag === 'ABCDEFGHJK', '同じものは1つにする（ファイル名の印があるほうを残す）・古い順');
  m = H.mergeHistory([], [null, 'x', { at:'1', device:'a', browser:'b', kind:'obk' }, { at:2, device:'a', browser:'b', kind:'hack' }, { at:3, device:'<b>', browser:'b', kind:'bk', tag:'bad' }]);
  ok(m.length === 1 && m[0].kind === 'bk' && !('tag' in m[0]), '形のおかしい行・知らない種類は入れない・印の形が違えば落とす');
  const many = Array.from({ length: 500 }, (_, i) => ({ at:i, device:'d', browser:'b', kind: i % 5 ? 'open' : 'obk' }));
  m = H.mergeHistory(many, []);
  ok(m.filter(x => H.isBackupKind(x.kind)).length === 100 && m.filter(x => !H.isBackupKind(x.kind)).length === 200, '多くなったら古いものから消す（バックアップ100・開いた200。開いた履歴でバックアップの履歴が押し出されない）');
  // 書き出し
  const sv = sect('async function saveV5Backup(', '\n  }\n');
  ok(/historyForBackup\(mergeHistory\(vault\.history, \[entry\]\)\)/.test(sv) && /makeV5File\([^\n]*cryptoKey, dk, fullBook\(true\), extra\)/.test(sv), 'バックアップのたびに履歴へ1行足して、ファイルに入れる');
  ok(/`\$\{nm\}-\$\{date\}-\$\{time\}-\$\{kind\}-\$\{tag\}\.enc\.json`/.test(sv) && /const tag = await fileNameTag\(dk, text\);/.test(sv), 'ファイル名：名前-日付-時刻-obk-印.enc.json（印は書き出す文字そのものの SHA-256 から作る）');
  ok(/const text = JSON\.stringify\(out, null, 2\);[\s\S]*saveFile\([^\n]*, text\)/.test(sv), '印を作った文字と、保存する文字が同じ');
  ok(/history: mergeHistory\(vault\.history, \[\{ \.\.\.entry, tag \}\]\)/.test(sv) && /await writeVault\(\(\) => vault && vault\.vaultId === vid \? \{ \.\.\.vault, history: mergeHistory/.test(sv), '保存できたら、この端末の履歴にも印つきで残す（書けてから切りかえる）');
  ok(/const time = `\$\{p\(d\.getHours\(\)\)\}\$\{p\(d\.getMinutes\(\)\)\}`/.test(html), '時刻は 時分 の4けた');
  // 保存先を選ぶ
  const sf = sect('async function saveFile(', '\n  }\n');
  ok(/typeof window\.showSaveFilePicker === 'function'/.test(sf) && /suggestedName: filename/.test(sf), '保存先を選ぶ画面を出す（出せるブラウザだけ）');
  ok(/e\.name === 'AbortError'\) return \{ how:'cancelled'/.test(sf) && /downloadBlob\(filename, text\);\s*return \{ how:'downloaded'/.test(sf), '選ぶ画面でやめたら保存しない・出せないときはダウンロード');
  ok(/if \(got\.how === 'cancelled'\) \{ showToast\('保存をやめました'\); return null; \}/.test(sv), 'やめたら履歴にも残さない');
  // 取りこむところ
  const mf = sect("$('mergePkFile').addEventListener", "$('regenRkBtn')");
  ok(/const r = await inspectV5\(dkRaw, data, file\.name, text\);[\s\S]{0,80}if \(r\.auth === 'bad'\) throw new Error\(TAMPER_MSG\);\s*if \(r\.auth === 'none'\) throw/.test(mf) && mf.indexOf('inspectV5') < mf.indexOf('mergePasskeys('), '「合わせる」：印が合わない・印が無い（V2.00.009 まで）ファイルでは合わせない（チャッピーさんの指摘）');
  const imp = sect("getElementById('importFile').addEventListener", 'async function decryptImport');
  ok(/const same = insp && insp\.auth === 'ok' && !ownKey && vault && rawFile\.vaultId === vault\.vaultId;\s*const pkMerge = same \?/.test(imp), '読み込み：印が合うときだけ一覧と履歴を合わせる');
  const st = sect("$('startFile').addEventListener", '/* ---------- ふだん開く');
  ok(/const r = await inspectV5\(dk, data, file\.name, text\);[\s\S]{0,40}if \(r\.auth === 'bad'\) \{ dk\.fill\(0\); errEl\.textContent = TAMPER_MSG; return; \}/.test(st), 'バックアップから始める：書きかえられていたら始めない');
  const fu = sect('async function finishUnlock(', '// 通常起動');
  ok(/if \(insp && !nameTagOkOrAsk\(insp\)\) \{[\s\S]{0,120}dk\.fill\(0\);\s*errEl\.textContent = '取りこみをやめました/.test(fu), '上書き用バックアップで起動：ファイル名の印が合わず「やめる」なら、何も変えない');
  const di = sect('async function decryptImportV5(', 'async function decryptImport(data)');
  ok(/if \(insp\.auth === 'bad'\) throw new Error\(TAMPER_MSG\);\s*if \(!nameTagOkOrAsk\(insp\)\) return null;/.test(di) && /finally \{ if \(own\) dk\.fill\(0\); \}/.test(di), '読み込み・閲覧専用：書きかえられていたら開かない・聞いてやめたら開かない');
  const ins = sect('async function inspectV5(', '\n  }\n');
  ok(/if \(auth === 'none' && tag\) auth = 'bad';/.test(ins), 'ファイル名に印があるのに中の印が無い（印を消した書きかえ）も見破る');
  ok(/askConfirm\('このファイルは改ざんの恐れがあります。/.test(html) && /const TAMPER_MSG = 'このファイルは改ざんの恐れがあります/.test(html), '合わないときは「このファイルは改ざんの恐れがあります」と出す（かずやさんの指定）');
  // 履歴を出す・残す
  ok(/<div class="restore-head">バックアップの履歴/.test(html) && /<div class="restore-head">開いた履歴/.test(html) && html.indexOf('id="bkHistList"') > html.indexOf('id="rekeyBtn"'), '鍵の設定（復元キーの下）に、バックアップの履歴と開いた履歴を出す');
  ok(/finishUnlock\(await openWithPasskey\(passkeyWraps\(vault\)\), 'pk'\)/.test(html) && /await finishUnlock\(dk, 'rk'\);/.test(html) && (html.match(/noteHistory\('open', how\);/g) || []).length === 2 && /noteHistory\('view'\);/.test(html), '開いたとき（パスキー・復元キー）と閲覧専用で開いたときに履歴を残す');
  ok(/if \(Array\.isArray\(meta\.history\) && meta\.history\.length\) next\.history = meta\.history;/.test(html) && /startNewVault\(book, 'rekey', \{ history: oldVault\.history \}\)/.test(html), '履歴は新しい金庫・鍵をすべて作り直したあとにも引き継ぐ');
  const ws = sect('function wipeScreen()', '\n  }\n');
  ok(/\$\('bkHistList'\)\.innerHTML = ''; \$\('openHistList'\)\.innerHTML = ''; \$\('checkBkOut'\)\.textContent = '';/.test(ws), 'ロックのとき、履歴と確かめた結果も画面から消す');
  ok(/const hist = Array\.isArray\(meta\.history\)[^\n]*encryptJSON\(key, meta\.history\)/.test(html), 'バックアップの中の履歴は暗号化する（端末の名前を平文で出さない）');
  ok(/<span class="pk-name">\$\{esc\(histText\(x\)\)\}<\/span><span class="pk-date">\$\{esc\(histWhat\(x\)\)\}/.test(html), '履歴の文字は esc を通して出す（ほかの端末から来た名前で画面を書きかえさせない）');
}

console.log('16. 印の無いファイルの鍵の情報を使わない・履歴をたたむ・バックアップに入れる履歴を減らす（V2.00.011〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const st = sect("$('startFile').addEventListener", '/* ---------- ふだん開く');
  ok(/if \(r\.auth !== 'ok'\) \{[\s\S]{0,300}dk\.fill\(0\);[\s\S]{0,80}startNewVault\(limitBook\(normalize\(toBook\(content, file\.name\)\)\), 'legacy'\)[\s\S]{0,300}return;\s*\}\s*const meta = \{ vaultId:data\.vaultId, wraps:data\.wraps/.test(st), 'バックアップから始める：印が合わないと、ファイルの鍵の情報（wraps・revoked）は使わず、中身だけを新しい鍵で始める（チャッピーさんの指摘）');
  const fu = sect('async function finishUnlock(', '// 通常起動');
  ok(/if \(wrapper\.vaultId !== vault\.vaultId && insp\.auth === 'ok'\) \{[\s\S]{0,80}\} else if \(wrapper\.vaultId !== vault\.vaultId\) \{[\s\S]{0,200}useDk = dk; useVault = vault;/.test(fu), '上書き用バックアップ（別の鍵）：印が無ければ、この端末のいまの鍵のまま中身だけ入れかえる');
  ok(/useVault = \{ version:5, vaultId:wrapper\.vaultId, wraps:wrapper\.wraps/.test(fu) && fu.indexOf("insp.auth === 'ok') {\n            useVault = { ...useVault, history") > 0, '（別の鍵で印が合うときだけ、ファイルの鍵を使う）');
  ok(/legacy:\s*\['新しい復元キー'/.test(html), '新しい鍵で始めるときの説明がある');
  // 外側の鍵の情報を使うところは、印が合ったあとだけ
  const uses = [...html.matchAll(/wraps:\s*(data|wrapper)\.wraps/g)].map(m => m.index);
  ok(uses.length === 2, `ファイルの wraps を金庫に入れるところは2か所だけ（${uses.length}）`);
  // 履歴を減らす
  const hsrc = sect('const HIST_KINDS', '  // V2.00.010〜 開いた・閲覧したこと');
  const H = new Function('ua', 'isIOS', 'localStorage', hsrc + '\nreturn { historyForBackup };')('Chrome/1', false, { getItem: () => '' });
  const hb = [];
  for (let i = 1; i <= 8; i++) { hb.push({ at:i*10, device:'d', browser:'b', kind:'obk' }); hb.push({ at:i*10+5, device:'d', browser:'b', kind:'open' }); }
  const kept = H.historyForBackup(hb);
  ok(kept.filter(x => x.kind === 'obk').map(x => x.at).join() === '50,60,70,80' && kept[0].at === 50 && kept.length === 8, 'バックアップに入れる履歴は、今回と3回前までのバックアップと、その間に開いた記録だけ');
  ok(H.historyForBackup(hb.slice(0, 6)).length === 6, 'バックアップが4回以下なら全部入れる');
  // たたむ
  ok(/const HIST_SHOW = 3;/.test(html) && /newest\.slice\(0, HIST_SHOW\)\.forEach/.test(html) && /document\.createElement\('details'\)/.test(html) && /ほか \$\{newest\.length - HIST_SHOW\} 件を見る/.test(html), '履歴は最新3行だけ出し、ほかは「ほか ○ 件を見る」を押したときだけ出す');
}

console.log('17. 取り込んだファイルの行に印を書き足す・iPhone と iPad で保存先を選ぶ（V2.01.001〜）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const ins = sect('async function inspectV5(', '\n  }\n');
  ok(/if \(auth === 'ok' && name === true\) \{[\s\S]{0,200}history\.filter\(h => h\.kind === kind\)\.pop\(\);\s*if \(own && !own\.tag\) own\.tag = tag;/.test(ins), '中の印とファイル名の印が両方合ったときだけ、そのファイル自身の行（同じ種類でいちばん新しい行）に印を書き足す');
  const sf = sect('async function saveFile(', '\n  let shareCloser');
  ok(sf.indexOf('showSaveFilePicker') < sf.indexOf('navigator.canShare') && /if \(isIOS && navigator\.canShare\)/.test(sf) && /if \(can\) return await shareSave\(f, text\);/.test(sf), 'パソコンは保存先の画面、iPhone・iPad は共有の画面、どちらも無ければダウンロード');
  const ss = sect('function shareSave(', '\n  }\n  /*');
  ok(/\$\('shareGo'\)\.onclick = async \(\) => \{\s*try \{ await navigator\.share\(\{ files:\[f\] \}\);/.test(html), '共有の画面は「保存先を選ぶ」を押したときに出す（暗号化で「押した」扱いが切れても出せる）');
  ok(/e\.name === 'AbortError'\) \{ \$\('shareErr'\)/.test(html) && /\$\('shareCancel'\)\.onclick = \(\) => close\(\{ how:'cancelled'/.test(html) && /\$\('shareDl'\)\.onclick = \(\) => \{ downloadBlob\(f\.name, text\);/.test(html), '共有をやめてもやり直せる・「やめる」なら保存しない・ダウンロードも選べる');
  const ws = sect('function wipeScreen()', '\n  }\n');
  ok(/if \(shareCloser\) shareCloser\(\{ how:'cancelled' \}\);/.test(ws) && /'shareOverlay'\]/.test(ws), 'ロックのとき、保存先を選ぶ画面も閉じて保存しない');
  ok(/<div class="overlay hidden" id="shareOverlay">/.test(html) && /“ファイル”に保存/.test(html), '保存の画面に「“ファイル”に保存」の案内がある');
}

console.log('18. 古い状態で上書きしない・保存の順番・ロック前の保存の失敗・計算回数（V2.01.002〜・チャッピーさんの再点検）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const wvSrc = sect('  const STALE_MSG', '  function dropLegacyData');
  const pSrc = sect('  let persistChain', '  function save()');
  const stSrc = sect('  const UNSAVED_KEY', '  function clearUnsaved');
  // 本物の writeVault・persist・stashUnsaved を、タブごとに別の変数で動かす（保存の場所は2つのタブで共有）
  const mkStore = () => {
    const m = new Map(); const st = { failSet: null, m };
    st.get = async k => { if (!m.has(k)) throw new Error('not found'); return { value: m.get(k) }; };
    st.set = async (k, v) => { if (st.failSet && st.failSet(k)) throw new Error('quota'); m.set(k, v); };
    st.delete = async k => { m.delete(k); };
    st.read = k => JSON.parse(m.get(k));
    let q = Promise.resolve();
    st.nav = { locks: { request: (name, fn) => { const p = q.then(() => fn()); q = p.catch(() => {}); return p; } } };   // 同じ保存の場所を使うタブで共有する Web Locks
    return st;
  };
  const delays = [];
  const fakeEnc = async (key, obj) => { const d = delays.shift() || 0; if (d) await new Promise(r => setTimeout(r, d)); return { iv:'i', ct: JSON.stringify(obj) + '|' + key }; };
  const fakeDec = async (key, blob) => JSON.parse(blob.ct.slice(0, blob.ct.lastIndexOf('|')));
  const makeTab = (store, nav) => new Function('store', 'META5_KEY', 'SAVE_FAIL_MSG', 'navigator', 'dropLegacyData', 'encryptJSON',
    'let vault = null, cryptoKey = null, book = null, staleTab = false;\nconst loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } };\n' + wvSrc + pSrc + stSrc +
    '\nreturn { get vault() { return vault; }, set vault(v) { vault = v; }, set key(k) { cryptoKey = k; }, set book(b) { book = b; }, writeVault, persist, stashUnsaved,' +
    ' get chain() { return persistChain; }, get unsaved() { return hasUnsaved(); }, edit() { editSeq++; }, get stash() { return unsavedStash; }, set stale(v) { staleTab = v; }, STALE_MSG, NO_LOCKS_MSG, UNSAVED_KEY };')
    (store, 'M', 'SAVEFAIL', nav === undefined ? store.nav : nav, () => {}, fakeEnc);
  const pk = id => ({ type:'passkey', credId:id, label:id });
  // (1) 2つのタブ：A でパスキーを外したあと、古い一覧のままの B が保存しても、戻らない
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[{ type:'recovery' }, pk('mac'), pk('iph')], data:{ iv:'i', ct:'c0' }, rev:3 }));
    const A = makeTab(st), B = makeTab(st);
    A.vault = st.read('M'); B.vault = st.read('M'); A.key = B.key = 'K'; B.book = { n:'Bの編集' }; B.edit();
    await A.writeVault(() => ({ ...A.vault, wraps: A.vault.wraps.filter(w => w.credId !== 'iph'), revoked:['iph'] }));
    let err = ''; try { await B.persist(); } catch (e) { err = e.message; }
    const now = st.read('M');
    ok(err === B.STALE_MSG && !now.wraps.some(w => w.credId === 'iph') && now.revoked.join() === 'iph' && now.rev === 4,
      'ほかのタブで外したパスキーは、古い一覧のタブが保存しても戻らない・外した印も消えない（古いタブは書かずに知らせる）');
    ok(B.unsaved === true, '書けなかった編集は「保存できていない」として覚える（ロックのときに残す）');
  }
  // (2) 保存の順番：1つめの暗号化が遅く、2つめが速くても、最後に残るのは新しい中身
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[], data:{ iv:'i', ct:'c0' }, rev:0 }));
    const T = makeTab(st); T.vault = st.read('M'); T.key = 'K';
    delays.push(60, 0);
    T.book = { n:'古い' }; const p1 = T.persist();
    T.book = { n:'新しい' }; const p2 = T.persist();
    await Promise.all([p1, p2]);
    ok(/新しい/.test(st.read('M').data.ct) && st.read('M').rev === 2, '保存は1つずつ順番に行い、古い保存があとから終わって新しい中身を上書きしない');
  }
  // (3) 鍵の切りかえ：古い鍵で暗号化している保存が、鍵をすべて作り直したあとに終わっても、新しい金庫を古い情報で上書きしない
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'OLD', wraps:[{ type:'recovery', ct:'old' }], data:{ iv:'i', ct:'c0' }, rev:5 }));
    const T = makeTab(st); T.vault = st.read('M'); T.key = 'K1'; T.book = { n:'中身' };
    delays.push(60);
    const p1 = T.persist();   // 古い鍵 K1 で暗号化中
    await new Promise(r => setTimeout(r, 10));
    await T.writeVault(() => ({ version:5, vaultId:'NEW', wraps:[{ type:'recovery', ct:'new' }], data:{ iv:'i', ct:'x|K2' }, rev: T.vault.rev }), () => { T.key = 'K2'; });
    await p1;
    const now = st.read('M');
    ok(now.vaultId === 'NEW' && now.wraps[0].ct === 'new' && /\|K2$/.test(now.data.ct), '古い保存は、新しい金庫を古い金庫の情報で上書きしない（新しい鍵で暗号化し直して書く）');
  }
  // (4) ロックの前の保存が失敗しても、編集を鍵で暗号化して残す
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[], data:{ iv:'i', ct:'c0' }, rev:0 }));
    const T = makeTab(st); T.vault = st.read('M'); T.key = 'K'; T.book = { n:'まだ保存していない編集' }; T.edit();
    st.failSet = k => k === 'M';
    let err = ''; try { await T.persist(); } catch (e) { err = e.message; }
    await T.stashUnsaved();
    const s1 = st.read(T.UNSAVED_KEY);
    ok(err === 'SAVEFAIL' && s1.vaultId === 'V' && st.read('M').data.ct === 'c0' && st.read('M').rev === 0 && (await fakeDec('K', s1)).n === 'まだ保存していない編集' && /\|K$/.test(s1.ct),
      '保存できなかった編集は、鍵で暗号化して残る（戻せる）・金庫は前のまま');
    const st2 = mkStore(); st2.failSet = () => true;
    const T2 = makeTab(st2); T2.vault = { vaultId:'V' }; T2.key = 'K'; T2.book = { n:'x' };
    await T2.stashUnsaved();
    ok(T2.stash && T2.stash.vaultId === 'V' && !st2.m.size, '端末に書けないときも、このタブの中に暗号化して残す');
  }
  // 画面のつなぎ
  ok(/if \(hasUnsaved\(\)\) await Promise\.race\(\[stashUnsaved\(\)[\s\S]{0,400}?\}\s*staleTab = false;\s*cryptoKey = null;/.test(html), 'ロック：保存できなかったら、暗号化して残してから鍵を消す');
  ok(/offerUnsaved\(\);/.test(html) && /ロックの前に、この端末に保存できなかった変更があります/.test(html), '次に開いたときに、残した変更を戻すか聞く');
  ok(/window\.addEventListener\('storage', e => \{/.test(html) && /s\.data\.ct === vault\.data\.ct\) \{\s*vault = s;/.test(html) && /staleTab = true;\s*if \(lockingNow\) return;[^\n]*\n\s*setStatus\(STALE_MSG, true\);/.test(html), 'ほかのタブの変更：中身が同じなら取りこむ・ちがえばこのタブは保存しない');
  ok(/const fresh = await loadJSON\(META5_KEY\);/.test(html), '開くときに、保存を読み直す（ロック画面のあいだのほかのタブの変更）');
  ok(/HAS_LOCKS \? navigator\.locks\.request\('snippet-book-vault', run\)/.test(html), 'タブをまたいでも、書くのは1つずつ（Web Locks）');
  ok(!/vault = next/.test(html) && !/vault = oldVault/.test(html), '書けたかどうかと関係なく vault を切りかえるところは無い（writeVault だけが切りかえる）');
  ok(/v4Params\(data\);\s*\/\/[^\n]*\n\s*\/\/ otherwise ask for a password/.test(html), '計算回数がおかしいファイルは、パスワードを聞く前に断る');
}

console.log('19. 保存の途中で編集してすぐロック・Web Locks が無いブラウザ（V2.01.003〜・チャッピーさんの再点検）');
{
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const wvSrc = sect('  const STALE_MSG', '  function dropLegacyData');
  const pSrc = sect('  let persistChain', '  function save()');
  const stSrc = sect('  const UNSAVED_KEY', '  function clearUnsaved');
  const mkStore = () => {
    const m = new Map(); const st = { m };
    st.get = async k => { if (!m.has(k)) throw new Error('not found'); return { value: m.get(k) }; };
    st.set = async (k, v) => { m.set(k, v); };
    st.delete = async k => { m.delete(k); };
    st.read = k => JSON.parse(m.get(k));
    let q = Promise.resolve();
    st.nav = { locks: { request: (name, fn) => { const p = q.then(() => fn()); q = p.catch(() => {}); return p; } } };
    return st;
  };
  const delays = [];
  const fakeEnc = async (key, obj) => { const snap = JSON.stringify(obj); const d = delays.shift() || 0; if (d) await new Promise(r => setTimeout(r, d)); return { iv:'i', ct: snap + '|' + key }; };
  const makeTab = (store, nav) => new Function('store', 'META5_KEY', 'SAVE_FAIL_MSG', 'navigator', 'dropLegacyData', 'encryptJSON',
    'let vault = null, cryptoKey = null, book = null, staleTab = false;\nconst loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } };\n' + wvSrc + pSrc + stSrc +
    '\nreturn { set vault(v) { vault = v; }, set key(k) { cryptoKey = k; }, set book(b) { book = b; }, writeVault, persist, stashUnsaved,' +
    ' get chain() { return persistChain; }, get unsaved() { return hasUnsaved(); }, edit() { editSeq++; }, get stash() { return unsavedStash; }, NO_LOCKS_MSG };')
    (store, 'M', 'SAVEFAIL', nav, () => {}, fakeEnc);
  const lockLike = async T => { try { await T.chain; } catch {} const before = T.unsaved; if (T.unsaved) { try { await T.persist(); } catch {} } if (T.unsaved) await T.stashUnsaved(); return before; };
  // チャッピーさんの順番：A の保存が始まる → 保存の途中で B に編集 → 次の自動保存の前にロック → A の保存が終わる
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[], data:{ iv:'i', ct:'c0' }, rev:0 }));
    const T = makeTab(st, st.nav); T.vault = st.read('M'); T.key = 'K';
    T.book = { n:'A' }; T.edit(); delays.push(60);
    T.persist();
    await new Promise(r => setTimeout(r, 10));
    T.book = { n:'B' }; T.edit();
    const unsavedAfterA = await lockLike(T);
    ok(unsavedAfterA === true, '古い保存（A）が終わっても、あとの編集（B）は「保存済み」にならない');
    ok(/"n":"B"/.test(st.read('M').data.ct) && !T.unsaved, 'ロックのときに B まで保存される（前の版は A のまま・B は捨てられた）');
  }
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[], data:{ iv:'i', ct:'c0' }, rev:0 }));
    const T = makeTab(st, st.nav); T.vault = st.read('M'); T.key = 'K';
    T.book = { n:'A' }; T.edit(); delays.push(60); T.persist();
    await new Promise(r => setTimeout(r, 10));
    T.book = { n:'B' }; T.edit();
    try { await T.chain; } catch {}
    st.set = async () => { throw new Error('quota'); };
    await lockLike(T);
    ok(T.stash && /"n":"B"/.test(T.stash.ct), 'ロックのときに保存できなければ、B を暗号化して残す');
  }
  {
    const st = mkStore();
    st.m.set('M', JSON.stringify({ version:5, vaultId:'V', wraps:[{ type:'passkey', credId:'iph' }], data:{ iv:'i', ct:'c0' }, rev:2 }));
    const T = makeTab(st, {}); T.vault = st.read('M'); T.key = 'K'; T.book = { n:'x' }; T.edit();
    let err = ''; try { await T.writeVault(() => ({ ...st.read('M'), wraps: [] })); } catch (e) { err = e.message; }
    let err2 = ''; try { await T.persist(); } catch (e) { err2 = e.message; }
    ok(err === T.NO_LOCKS_MSG && err2 === T.NO_LOCKS_MSG && st.read('M').rev === 2 && st.read('M').wraps.length === 1, 'Web Locks が無いブラウザでは、金庫に書かない（同時に書いて、外したパスキーが戻ることが無い）');
  }
  ok(/appEl\.inert = true;/.test(html) && /appEl\.inert = false;/.test(html), 'ロックを始めたら画面の操作を止め、開いたらもどす');
  ok(/editSeq\+\+;   \/\/ V2\.01\.003〜 編集番号/.test(html) && /if \(seq > savedSeq\) savedSeq = seq;/.test(html) && !/unsavedChanges/.test(html), '編集番号で管理する（真偽値の「保存できていない」はもう使わない）');
  ok(/if \(!HAS_LOCKS\) \{[\s\S]{0,200}\['createBtn','startFromBackup'\][\s\S]{0,120}disabled = true;/.test(html) && /NO_LOCKS_MSG = 'このブラウザは古いので/.test(html), 'Web Locks が無いブラウザでは、作る・バックアップから始めるを止めて案内する');
}

console.log('20. ロックを押したら、保存を待つ前に本文を隠す（V2.01.004〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const lockSrc = sect('  async function lockNow() {', "  document.getElementById('lockNow')");
  ok(lockSrc.length > 0, '本物の lockNow を切り出せた');
  // 本物の lockNow を、画面と保存のまね（待ち時間を自由に止められる）で動かす
  const mk = (waitMs) => {
    const log = [];
    const cls = () => { const set = new Set(); return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), set }; };
    const appEl = { inert: false, classList: cls() };
    const lockScreen = { classList: cls() }; lockScreen.classList.add('hidden');
    const els = {}; const $ = id => (els[id] ||= { classList: cls(), textContent: '' });
    const doc = { activeElement: null, body: {}, getElementById: $ };
    let release; const gate = new Promise(r => { release = r; });
    const env = { log, appEl, lockScreen, $, doc, gate, release: () => release() };
    const T = new Function('env', `
      const { appEl, lockScreen, $, log } = env; const document = env.doc;
      let lockEpoch = 0, lockingNow = false, savePending = false, saveTimer = null, staleTab = false, viewOnly = false;
      let cryptoKey = 'KEY', dkRaw = new Uint8Array([1,2,3]), book = { n: '秘密の本文' }, screenText = '秘密の本文';
      let editSeq = 2, savedSeq = 1;
      const LOCK_SAVE_WAIT_MS = ${waitMs}, LOCK_STASH_WAIT_MS = 2000; let lockNotice = ''; const LOST_MSG = 'LOST';
      const hasUnsaved = () => editSeq > savedSeq;
      let persistChain = env.gate.then(() => { savedSeq = editSeq; log.push('saved'); });
      const persist = () => persistChain;
      const stashUnsaved = async () => { log.push('stash:' + (cryptoKey ? 'withKey' : 'noKey')); savedSeq = editSeq; };
      const wipeScreen = () => { screenText = ''; log.push('wipe:' + (cryptoKey ? 'keyStill' : 'keyGone')); };
      const showCard = c => log.push('card:' + (c ? 'x' : 'none'));
      const clearRestore = () => {}; const boot = () => log.push('boot');
      ${lockSrc}
      return { lockNow, get key() { return cryptoKey; }, get dk() { return dkRaw; }, get text() { return screenText; }, get locking() { return lockingNow; }, get epoch() { return lockEpoch; } };`)(env);
    return { T, env };
  };
  {
    const { T, env } = mk(5000);
    const p = T.lockNow();
    await new Promise(r => setTimeout(r, 20));   // 保存はまだ終わらない
    ok(env.appEl.inert && env.appEl.classList.contains('hidden') && !env.lockScreen.classList.contains('hidden') && T.text === '', '保存を待っている間に、本文はもう消えて画面も隠れている（操作も止まっている）');
    ok(env.log[0] === 'wipe:keyStill' && env.log.includes('card:none') && !env.$('lockingMsg').classList.contains('hidden'), '待っている間は、開くボタンを出さず「ロックしています」だけを出す');
    ok(T.key === 'KEY' && T.locking, '待っている間は鍵が残る（保存に使う）');
    const p2 = T.lockNow();   // 自動ロックがもう一度来ても
    ok(T.epoch === 2 && T.locking, 'ロックの途中にもう一度ロックしても、二重には動かない（番号は進める）');
    env.release(); await p; await p2;
    ok(env.log.includes('saved') && !env.log.some(x => x.startsWith('stash')) && T.key === null && T.dk === null && !T.locking, '保存が終わったら鍵を消す（保存できたので残さない）');
    ok(env.$('lockingMsg').classList.contains('hidden') && env.log[env.log.length - 1] === 'boot', '終わったらロック画面（開く画面）に戻る');
  }
  {
    const { T, env } = mk(60);   // 保存がいつまでも終わらない（ほかのタブが順番を持ったまま など）
    const t0 = Date.now();
    await T.lockNow();
    ok(Date.now() - t0 < 1000 && env.log.includes('stash:withKey') && T.key === null && T.dk === null, '保存が決めた時間を過ぎても終わらなければ、編集を暗号化して残し、鍵を消す');
    ok(T.text === '' && env.log[0] === 'wipe:keyStill', 'そのときも、本文は最初に消えている');
  }
  ok(/const LOCK_SAVE_WAIT_MS = 5000;/.test(html), '保存を待つのは 5 秒まで');
  ok(/addEventListener\('blur', e => \{\s*if \(viewOnly \|\| lockingNow\) return;/.test(html), 'ロックで欄を空にしても、データ名を「snippet-book」に戻して保存しない');
  ok(/\(appEl\.classList\.contains\('hidden'\) && !lockingNow\) \|\| !cryptoKey/.test(html), 'ロックの途中にほかのタブが変えても、ロック画面の読み直しで金庫を入れかえない（保存を守る）');
  const w = sect('  function wipeScreen() {', '\n  }\n');
  ok(/^\s*function wipeScreen\(\) \{\s*const ae = document\.activeElement;[^\n]*blur\(\);/.test(w), 'wipeScreen は、欄の値を消す前に入力中の欄を離す');
  ok(/<p class="hint hidden" id="lockingMsg">/.test(html), 'ロック画面に「ロックしています」の表示がある');
})();

console.log('21. 残す（退避の）書きこみが返ってこなくても、決まった時間で鍵を消す（V2.01.005〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const lockSrc = sect('  async function lockNow() {', "  document.getElementById('lockNow')");
  const stSrc = sect('  const UNSAVED_KEY', '  function clearUnsaved');
  ok(lockSrc.length > 0 && stSrc.length > 0, '本物の lockNow と stashUnsaved を切り出せた');
  // 本物の lockNow と本物の stashUnsaved を一緒に動かす。保存は終わらない・端末への書きこみ（store.set）も返ってこない
  const mk = ({ saveMs, stashMs, encHang }) => {
    const log = [];
    const cls = () => { const set = new Set(); return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }; };
    const appEl = { inert: false, classList: cls() };
    const lockScreen = { classList: cls() };
    const els = {}; const $ = id => (els[id] ||= { classList: cls(), textContent: '' });
    const doc = { activeElement: null, body: {}, getElementById: $ };
    const store = { set: () => { log.push('set'); return new Promise(() => {}); } };   // 返ってこない
    const encryptJSON = async (key, obj) => { const snap = JSON.stringify(obj); if (encHang) await new Promise(() => {}); return { iv: 'i', ct: snap + '|' + key }; };
    return { log, $, T: new Function('env', 'store', 'encryptJSON', `
      const { appEl, lockScreen, $, log } = env; const document = env.doc;
      let lockEpoch = 0, lockingNow = false, savePending = false, saveTimer = null, staleTab = false, viewOnly = false;
      let vault = { vaultId: 'V' }, cryptoKey = 'KEY', dkRaw = new Uint8Array([1,2,3]), book = { n: '最新の編集' };
      let editSeq = 2, savedSeq = 1;
      const LOCK_SAVE_WAIT_MS = ${saveMs}, LOCK_STASH_WAIT_MS = ${stashMs}; let lockNotice = ''; const LOST_MSG = 'LOST';
      const hasUnsaved = () => editSeq > savedSeq;
      let persistChain = new Promise(() => {});   // 保存が終わらない
      const persist = () => persistChain;
      const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } }; const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
      const wipeScreen = () => log.push('wipe');
      const showCard = () => {}; const clearRestore = () => {}; const boot = () => log.push('boot');
      ${lockSrc}
      return { lockNow, get key() { return cryptoKey; }, get dk() { return dkRaw; }, get stash() { return unsavedStash; }, get locking() { return lockingNow; } };`)({ log, appEl, lockScreen, $, doc }, store, encryptJSON) };
  };
  {
    const { T, log, $ } = mk({ saveMs: 40, stashMs: 60 });
    const t0 = Date.now();
    await Promise.race([T.lockNow(), new Promise(r => setTimeout(r, 2000))]);   // 前の版はここで止まったままになる
    const ms = Date.now() - t0;
    ok(ms < 1000 && T.key === null && T.dk === null && !T.locking, `端末への書きこみが返ってこなくても、上限の時間で鍵を消してロックを終える（${ms}ミリ秒）`);
    ok(log.includes('set') && T.stash && /最新の編集/.test(T.stash.ct) && /\|KEY$/.test(T.stash.ct), '最新の編集は、鍵で暗号化してタブの中に残っている（次に開いたら戻せる）');
    ok($('lockingMsg').classList.contains('hidden') && log[log.length - 1] === 'boot', '「ロックしています」は終わり、いつものロック画面に戻る');
  }
  {
    const { T } = mk({ saveMs: 40, stashMs: 60, encHang: true });
    await Promise.race([T.lockNow(), new Promise(r => setTimeout(r, 2000))]);
    ok(T.key === null && T.dk === null && !T.locking, '暗号化そのものが返ってこなくても、鍵は消す');
  }
  ok(/const LOCK_STASH_WAIT_MS = 2000;/.test(html), '残すのを待つのは 2 秒まで（ロック全体で長くても 7 秒）');
  ok(/if \(hasUnsaved\(\)\) await Promise\.race\(\[stashUnsaved\(\)\.catch\(\(\) => false\), new Promise\(r => setTimeout\(r, LOCK_STASH_WAIT_MS\)\)\]\);[\s\S]{0,400}?\}\s*staleTab = false;\s*cryptoKey = null;/.test(html), 'ロック：残すのを上限つきで待ってから鍵を消す');
  ok(/unsavedStash = st;\s*await syncStash\(\);/.test(stSrc), '暗号化した中身は、端末に書く前にタブの中に置く');
})();

console.log('22. 遅れて終わった古い退避で新しい退避を上書きしない・暗号化に失敗したら保存済みにせず知らせる（V2.01.006〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const stSrc = sect('  const UNSAVED_KEY', '  async function offerUnsaved');   // stashUnsaved と clearUnsaved
  const lockSrc = sect('  async function lockNow() {', "  document.getElementById('lockNow')");
  ok(/function clearUnsaved/.test(stSrc) && lockSrc.length > 0, '本物の stashUnsaved・clearUnsaved・lockNow を切り出せた');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 暗号化と書きこみの遅れを、呼ぶたびに決められるまね
  const mkTab = () => {
    const m = new Map(); const encPlan = [], setPlan = [];
    const store = {
      set: async (k, v) => { const d = setPlan.shift() || 0; if (d) await sleep(d); m.set(k, v); },
      delete: async k => { m.delete(k); },
      get: async k => { if (!m.has(k)) throw new Error('not found'); return { value: m.get(k) }; },
    };
    const encryptJSON = async (key, obj) => { const snap = JSON.stringify(obj); const p = encPlan.shift() || 0; if (p === 'fail') throw new Error('enc'); if (p) await sleep(p); return { iv: 'i', ct: snap }; };
    const T = new Function('store', 'encryptJSON', `
      let vault = { vaultId: 'V' }, cryptoKey = 'KEY', book = null, editSeq = 0, savedSeq = 0;
      const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } }; const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
      return { set book(b) { book = b; editSeq++; }, stashUnsaved, clearUnsaved, get stash() { return unsavedStash; }, get saved() { return savedSeq; }, get edit() { return editSeq; } };`)(store, encryptJSON);
    return { T, m, encPlan, setPlan, stored: () => m.has('snippet-book:v5:unsaved') ? JSON.parse(m.get('snippet-book:v5:unsaved')).ct : null };
  };
  {
    // ① チャッピーさんの順番：A の退避の暗号化が遅れる → その間に B を退避 → あとで A が終わる
    const { T, encPlan, stored } = mkTab();
    T.book = { n: 'A' }; encPlan.push(80); const pA = T.stashUnsaved();
    await sleep(10);
    T.book = { n: 'B' }; encPlan.push(0); await T.stashUnsaved();
    await pA;
    ok(/"B"/.test(T.stash.ct) && /"B"/.test(stored()), '古い退避（A）が遅れて終わっても、タブの中も端末も新しい退避（B）のまま');
  }
  {
    // ① 書き終わる順の入れかわり：A の書きこみが遅れて、B より後に書き終わる
    const { T, setPlan, stored } = mkTab();
    T.book = { n: 'A' }; setPlan.push(80); const pA = T.stashUnsaved();
    await sleep(10);
    T.book = { n: 'B' }; setPlan.push(0); await T.stashUnsaved();
    await pA;
    ok(/"B"/.test(T.stash.ct) && /"B"/.test(stored()), 'A の書きこみが B よりあとに終わっても、端末には B が残る');
  }
  {
    // 退避を捨てたあとに、古い退避が遅れて終わっても戻らない
    const { T, encPlan, stored } = mkTab();
    T.book = { n: 'A' }; encPlan.push(50); const pA = T.stashUnsaved();
    await sleep(10); T.clearUnsaved(); await pA;
    ok(T.stash === null && stored() === null, '捨てた退避は、古い処理があとで終わっても戻らない');
  }
  {
    // ② 暗号化に失敗：保存済みにしない
    const { T, encPlan, stored } = mkTab();
    T.book = { n: 'X' }; encPlan.push('fail');
    const r = await T.stashUnsaved();
    ok(r === false && T.saved < T.edit && T.stash === null && stored() === null, '暗号化に失敗したら false を返し、「保存済み」にしない（前の版は保存済みにした）');
  }
  {
    // ② ロック全体：保存もできず、暗号化にも失敗 → 鍵は消し、ロック画面で知らせる
    const cls = () => { const set = new Set(); return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }; };
    const els = {}; const $ = id => (els[id] ||= { classList: cls(), textContent: '' });
    const env = { appEl: { inert: false, classList: cls() }, lockScreen: { classList: cls() }, $, doc: { activeElement: null, body: {}, getElementById: $ } };
    const store = { set: async () => {}, delete: async () => {} };
    const T = new Function('env', 'store', 'encryptJSON', `
      const { appEl, lockScreen, $ } = env; const document = env.doc;
      let lockEpoch = 0, lockingNow = false, savePending = false, saveTimer = null, staleTab = false, viewOnly = false;
      let vault = { vaultId: 'V' }, cryptoKey = 'KEY', dkRaw = new Uint8Array([1]), book = { n: '秘密の本文' }, editSeq = 2, savedSeq = 1;
      const LOCK_SAVE_WAIT_MS = 30, LOCK_STASH_WAIT_MS = 30;
      let lockNotice = ''; ${(html.match(/const LOST_MSG = '[^']*';/) || ["const LOST_MSG = '（前の版には無い）';"])[0]}
      const hasUnsaved = () => editSeq > savedSeq;
      let persistChain = Promise.reject(new Error('quota')); persistChain.catch(() => {});
      const persist = () => Promise.reject(new Error('quota'));
      const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } }; const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
      const wipeScreen = () => {}; const showCard = () => {}; const clearRestore = () => {}; const boot = () => {};
      ${lockSrc}
      return { lockNow, get key() { return cryptoKey; }, get notice() { return lockNotice; }, get unsaved() { return hasUnsaved(); }, LOST_MSG };`)(env, store, async () => { throw new Error('enc'); });
    await Promise.race([T.lockNow(), sleep(1000)]);
    ok(T.key === null && T.notice === T.LOST_MSG && !T.unsaved, '保存も退避もできなければ、鍵は消し、「保護できませんでした」をロック画面に出す（本文は出さない）');
    ok(!/秘密の本文/.test(T.LOST_MSG), '知らせの文に本文は入らない');
  }
  ok(/\$\('unlockErr'\)\.textContent = lockNotice;/.test(html) && /lockNotice = '';\s+\/\/ V2\.01\.006〜 開いたら知らせを消す/.test(html), '知らせは開く画面に出し、開いたら消す');
})();

console.log('23. 退避の書く・書き直す・消すを1列に並べる（V2.01.007〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const stSrc = sect('  const UNSAVED_KEY', '  async function offerUnsaved');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 書く・消すの遅れを、呼ばれた順に決められる保存先のまね。同時に動いている数も数える
  const mkTab = () => {
    const m = new Map(); const plan = []; let busy = 0, maxBusy = 0;
    const op = async fn => { busy++; maxBusy = Math.max(maxBusy, busy); const d = plan.shift() || 0; if (d) await sleep(d); fn(); busy--; };
    const store = { set: (k, v) => op(() => m.set(k, v)), delete: k => op(() => m.delete(k)), get: async k => { if (!m.has(k)) throw new Error('not found'); return { value: m.get(k) }; } };
    const encryptJSON = async (key, obj) => ({ iv: 'i', ct: JSON.stringify(obj) });
    const T = new Function('store', 'encryptJSON', `
      let vault = { vaultId: 'V' }, cryptoKey = 'KEY', book = null, editSeq = 0, savedSeq = 0;
      const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } }; const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
      return { set book(b) { book = b; editSeq++; }, stashUnsaved, clearUnsaved, get stash() { return unsavedStash; }, get io() { return typeof stashIO === 'undefined' ? Promise.resolve() : stashIO; } };`)(store, encryptJSON);
    const stored = () => m.has('snippet-book:v5:unsaved') ? JSON.parse(m.get('snippet-book:v5:unsaved')).ct : null;
    return { T, plan, stored, maxBusy: () => maxBusy };
  };
  {
    // チャッピーさんの1つ目：A の書きこみが遅れ、B を書き直す処理も遅れ、そのあとに C
    const { T, plan, stored, maxBusy } = mkTab();
    // 端末への操作の遅れ（呼ばれた順）：1つ目 60ms・2つ目 0・3つ目 80ms・4つ目 0。前の版では「A を書く→B を書く→（A のあと）B を書き直す→C を書く」の順になり、書き直しが C のあとに終わる
    plan.push(60, 0, 80, 0);
    T.book = { n: 'A' }; const pA = T.stashUnsaved();
    await sleep(5); T.book = { n: 'B' }; const pB = T.stashUnsaved();
    await sleep(65); T.book = { n: 'C' }; const pC = T.stashUnsaved();
    await Promise.race([Promise.all([pA, pB, pC, T.io]), sleep(1500)]); await sleep(150);
    ok(/"C"/.test(T.stash.ct) && /"C"/.test(String(stored())), `書きこみが遅れても、端末に最後に残るのは最新（C）（いま ${String(stored()).slice(0, 12)}）`);
    ok(maxBusy() === 1, '端末への書く・消すは、同時に1つだけ（前が終わるまで次を始めない）');
  }
  {
    // チャッピーさんの2つ目：退避 A を捨てる（消すのが遅れる）→ そのあと B を退避
    const { T, plan, stored, maxBusy } = mkTab();
    T.book = { n: 'A' }; plan.push(0); await T.stashUnsaved();
    plan.push(60); T.clearUnsaved();
    await sleep(5); T.book = { n: 'B' }; plan.push(0); const pB = T.stashUnsaved();
    await Promise.race([Promise.all([pB, T.io]), sleep(1500)]); await sleep(150);
    ok(/"B"/.test(T.stash.ct) && /"B"/.test(String(stored())), '消すのが遅れても、あとの退避（B）は端末から消えない');
    ok(maxBusy() === 1, '消すのも同じ1列で行う');
  }
  {
    // 捨てるのが最後なら、端末からも消える
    const { T, plan, stored } = mkTab();
    T.book = { n: 'A' }; plan.push(60); const pA = T.stashUnsaved();
    await sleep(5); T.clearUnsaved();
    await Promise.race([Promise.all([pA, T.io]), sleep(1500)]); await sleep(150);
    ok(T.stash === null && stored() === null, '書いている途中に捨てたら、書き終わったあと端末からも消える');
  }
  const io = sect('  function syncStash()', '\n  }\n');
  ok((stSrc.match(/store\.(set|delete)\(UNSAVED_KEY/g) || []).length === 2 && /store\.set\(UNSAVED_KEY[\s\S]*store\.delete\(UNSAVED_KEY/.test(io), '端末の退避を書く・消すのは syncStash の中だけ');
  ok((html.match(/store\.(set|delete)\(UNSAVED_KEY/g) || []).length === 2, 'アプリ全体でも、退避を書く・消すのはそこだけ');
})();

console.log('24. 自己点検（依頼121）で見つけた9つ（V2.01.008〜）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // A：読み込み
  ok(/return \{ content, insp, own \};/.test(html) && /data = got\.content; insp = got\.insp; ownKey = got\.own;/.test(html) && /const same = insp && insp\.auth === 'ok' && !ownKey && vault/.test(html), 'A：読み込みは、いまの鍵で開けたファイルのときだけ、パスキーの一覧と履歴を合わせる（ファイルの中の鍵で開いたら合わせない）');
  {
    const src = sect('  const HIST_KINDS', '  // V2.00.011〜 バックアップに入れる履歴');
    const M = new Function(src + '\nreturn { mergeHistory };')();
    const now = Date.now();
    const real = [{ at: now - 1000, device: 'Mac', browser: 'Safari', kind: 'bk' }];
    const fake = Array.from({ length: 150 }, (_, i) => ({ at: now + 365 * 86400000 + i, device: 'X', browser: 'Y', kind: 'bk' }));
    const got = M.mergeHistory(real, fake);
    ok(got.length === 1 && got[0].device === 'Mac', 'A：未来の日付の履歴は入れない（本物の履歴を押し出させない）');
  }
  // B・C：退避を出す
  {
    const stSrc = sect('  const UNSAVED_KEY', '  /* V2.01.002〜 ほかのタブ');
    const mk = ({ stored, decMs = 0, persistOk = true }) => {
      const log = [];
      const m = new Map(); if (stored) m.set('snippet-book:v5:unsaved', JSON.stringify(stored));
      const store = { set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
      const T = new Function('store', 'env', `
        const { log } = env;
        let lockEpoch = 0; const lockedSince = ep => ep !== lockEpoch;
        let vault = { vaultId: 'V' }, cryptoKey = 'KEY', viewOnly = false, book = { n: '今の中身' }, editSeq = 1, savedSeq = 1;
        const hasUnsaved = () => editSeq > savedSeq;
        const loadJSON = async k => { const v = env.m.get(k); return v ? JSON.parse(v) : null; };
        const decryptJSON = async (key, s) => { if (env.decMs) await new Promise(r => setTimeout(r, env.decMs)); return JSON.parse(s.ct); };
        const encryptJSON = async (key, obj) => ({ iv: 'i', ct: JSON.stringify(obj) });
        const normalize = x => x; const histText = () => 'x　y';
        const askConfirm = msg => { log.push('ask'); return env.answers.shift(); }; const confirm = askConfirm;   // 前の版（confirm を直に呼ぶ）でも動かすため
        const render = () => log.push('render'); const renderSets = () => {}; const setStatus = m => log.push('status');
        const persist = async () => { if (env.persistOk && cryptoKey) savedSeq = editSeq; };
        const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
        return { offerUnsaved, stashUnsaved, syncStash, set mem(s) { unsavedStash = s; }, get mem() { return unsavedStash; }, lock() { lockEpoch++; cryptoKey = null; }, get book() { return book; }, markWritten(s) { if (typeof stashWritten !== 'undefined') stashWritten.add(s); } };`)(store, { log, m, decMs, persistOk, answers: [] });
      return { T, log, m, env: null };
    };
    {
      // B：このタブで退避（端末にも書けた）→ 別のタブで戻して端末から消えた → このタブで開き直す
      const { T, log } = mk({ stored: null });
      const old = { vaultId: 'V', at: 1, ct: JSON.stringify({ n: '古い退避' }) };
      T.mem = old; T.markWritten(old);
      await T.offerUnsaved();
      ok(!log.includes('ask') && T.mem === null && T.book.n === '今の中身', 'B：別のタブで戻した・捨てた退避は、このタブのメモリから出し直さない（新しい保存を置きかえない）');
    }
    {
      // 端末に書けなかった退避（タブの中だけ）は、これまでどおり出す
      const { T, log } = mk({ stored: null });
      T.mem = { vaultId: 'V', at: 1, ct: JSON.stringify({ n: 'タブの中だけ' }) };
      await T.offerUnsaved();
      ok(log.includes('ask'), 'B：端末に書けなかった退避（タブの中だけ）は、これまでどおり戻すか聞く');
    }
    {
      // 作り直す前の鍵の退避は消す
      const { T, log, m } = mk({ stored: { vaultId: 'OLD', at: 1, ct: '{}' } });
      await T.offerUnsaved(); await sleep(20);
      ok(!log.includes('ask') && !m.has('snippet-book:v5:unsaved'), 'F：作り直す前の鍵（別の金庫の番号）の退避は、出さずに消す');
    }
    {
      // C：復号している間にロック
      const r = mk({ stored: { vaultId: 'V', at: 1, ct: JSON.stringify({ n: '退避の平文' }) }, decMs: 40 });
      const p = r.T.offerUnsaved(); await sleep(10); r.T.lock(); await p; await sleep(20);
      ok(!r.log.includes('ask') && !r.log.includes('render') && r.T.book.n === '今の中身' && r.m.has('snippet-book:v5:unsaved'), 'C：復号の間にロックされたら、平文を戻さず、退避も消さない');
    }
  }
  ok(/try \{ await persist\(\); \}[\s\S]{0,200}if \(lockedSince\(ep\) \|\| hasUnsaved\(\)\) return;[^\n]*\n\s*clearUnsaved\(s\);/.test(html), 'C：戻した中身が保存できたと言えるときだけ、退避を消す');
  ok(/if \(e\.key === UNSAVED_KEY\) \{ if \(!e\.newValue && unsavedStash && stashWritten\.has\(unsavedStash\)\) unsavedStash = null; return; \}/.test(html), 'B：ほかのタブが退避を消したら、このタブのメモリの退避も出さない');
  // D：自動ロック
  {
    const src = sect('  function checkAutoLock() {', '\n  }\n') + '\n  }';
    const run = (minAgo, rkOpen, autoMin) => {
      let locked = false;
      const f = new Function('env', `let prefs = { autoLockMin: ${autoMin} }; const RK_LOCK_MIN = 10; let lastActivity = Date.now() - ${minAgo} * 60000;
        const appEl = { classList: { contains: () => false } };
        const $ = id => ({ classList: { contains: c => !(id === 'rkOverlay' && ${rkOpen}) } });
        const lockNow = () => { env.locked = true; }; const showToast = () => {}; const setTimeout = () => {};
        ${src}
        checkAutoLock();`);
      const env = { locked: false }; f(env); return env.locked;
    };
    ok(run(11, true, 5) === true && run(6, true, 5) === false, 'D：復元キーの画面を開いたままでも、10 分なにもしなければロックする（前の版はずっとロックしなかった）');
    ok(run(6, false, 5) === true && run(3, false, 5) === false, 'D：ふだんの自動ロックは前と同じ');
  }
  {
    const src = sect('  function dialogOverdue(since) {', '  function askPrompt');
    const env = { now: 0 };
    const f = new Function('env', `let prefs = { autoLockMin: 5 }; let lastActivity = 0; const Date = { now: () => env.now };
      const appEl = { classList: { contains: () => false } };
      const window = { confirm: () => { env.now += env.wait; return true; } };
      const lockNow = () => { env.locked = true; }; const showToast = () => {}; const setTimeout = () => {};
      ${src}
      return typeof askConfirm === 'function' ? askConfirm : (m => window.confirm(m));   // 前の版には無い`)(env);
    env.wait = 6 * 60000; env.locked = false;
    let r1; try { r1 = f('消しますか？'); } catch (e) { r1 = 'stopped:' + (e && e.code); }   // V2.01.009〜 時間切れは投げて止める
    const lockedAfter1 = env.locked;
    env.now = 0; env.wait = 1000; env.locked = false;
    const r2 = f('消しますか？');
    ok(/^stopped:snippet-book:dialog-timeout-lock$/.test(String(r1)) && lockedAfter1 === true && r2 === true, 'D：確認の画面を出したまま自動ロックの時間を過ぎたら、答えを使わずにロックする');
  }
  ok(!/(^|[^\w.$])(confirm|prompt)\(/m.test(html.replace(/window\.(confirm|prompt)\(/g, '')), 'D：確認・入力の画面は、すべて askConfirm・askPrompt を通す');
  // E：文言
  ok(/データの鍵は変わりません。端末をなくした・盗まれたときは、外すだけでなく「鍵をすべて作り直す」をしてください/.test(html) && !/このパスキーでは開けなくなります。端末の/.test(html), 'E：パスキーを外す確認で、なくした・盗まれたときは「鍵をすべて作り直す」と案内する');
  // F：リセット
  ok(/async function resetAll\(\)[\s\S]{0,600}clearUnsaved\(\);/.test(html), 'F：リセットで退避も消す');
  // G：画面に書き戻さない（前の節で確かめた正規表現に加えて）
  ok(/await writeVault\(\(\) => \{ if \(lockedSince\(ep\)\) return null;/.test(html), 'G：復元キーの作り直しは、順番を待つ間にロックされたら書かない');
  // H：件数の上限
  ok((html.match(/limitBook\(normalize\(/g) || []).length === 5, 'H：ファイルから作る本は、どの道でも件数の上限を見る（バックアップから始める3つ・上書き復元・閲覧専用）');
  // I：失敗のとき・名前
  ok(/catch \(e\) \{ useDk\.fill\(0\); errEl\.textContent = e\.message; return; \}/.test(html) && /restored && typeof restored === 'object'/.test(html), 'I：上書き復元で書けないとき・中身がおかしいときも鍵を 0 で消す');
  {
    const src = sect('  const asText = ', '\n') + '\n' + sect('  function normalize(b) {', '  function activeSet');
    const N = new Function('const asObj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {}; const asList = v => Array.isArray(v) ? v : [];\n' + src + '\nreturn normalize;')();
    let threw = false, a, b2;
    try { a = N({ name: { toString: 1 }, sets: [] }); b2 = N({ name: 'x'.repeat(500), sets: [] }); } catch { threw = true; }
    ok(!threw && a.name === 'snippet-book' && b2.name.length === 100, 'I：データ名に変な形の値・長すぎる値が来ても止まらない（100 文字まで）');
  }
})();

console.log('25. 確認の時間切れでは先へ進まない・退避は新しいほうを選ぶ（V2.01.009〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); return i < 0 ? '' : html.slice(i, html.indexOf(to, i + from.length)); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const handler = id => { const a = `document.getElementById('${id}').addEventListener('click', `; const i = html.indexOf(a); if (i < 0) return ''; const j = html.indexOf('\n  });', i); return html.slice(i + a.length, j + 4); };
  const askSrc = html.includes('  // 止めた印が') ? sect('  function dialogOverdue(since) {', '  // 止めた印が') : sect('  function dialogOverdue(since) {', '  let savePending');   // 前の版にも合わせる
  // ① 平文の書き出し：「パスワードも含めますか？」を出したまま時間切れ
  const runExport = async (id, answers) => {
    const env = { now: 0, locked: false, downloads: [], calls: [] };
    const h = handler(id);
    const fn = new Function('env', `let prefs = { autoLockMin: 5 }; let lastActivity = 0; const Date = { now: () => env.now };
      const appEl = { classList: { contains: () => env.locked } };
      const window = { confirm: m => { const a = env.answers.shift(); env.now += a.wait; return a.v; }, prompt: m => { const a = env.answers.shift(); env.now += a.wait; return a.v; } };
      const lockNow = () => { env.locked = true; }; const setTimeout = () => {};
      let lockEpoch = 0; const lockedSince = ep => ep !== lockEpoch;
      const downloadJSON = (n, d) => env.downloads.push(n); const fullBook = inc => ({ inc }); const exportSetObj = (s, inc) => ({ inc });
      const activeSet = () => ({ name: 'x', items: [] }); const safeFileBase = () => ({ stamp: 's', nm: 'n' });
      const book = { name: 'b', sets: [] }; const showToast = () => {}; const setStatus = () => {};
      const makePwFile = async () => { env.calls.push('makePwFile'); return '{}'; };
      const saveV5Backup = async () => { env.calls.push('saveV5Backup'); return null; }; const saveFile = async () => { env.calls.push('saveFile'); return { how: 'download' }; };
      ${askSrc}
      return ${h};`)(Object.assign(env, { answers }));
    let stopped = false;
    try { await fn(); } catch (e) { stopped = e && e.code === 'snippet-book:dialog-timeout-lock'; }
    return { ...env, stopped };
  };
  {
    const r = await runExport('exportSet', [{ v: '2', wait: 1000 }, { v: true, wait: 6 * 60000 }]);
    ok(r.locked && r.downloads.length === 0 && r.stopped, '①：平文の書き出しで「パスワードも含めますか？」を出したまま時間切れ → ロックして、何も書き出さない（前の版は「含めない」で書き出した）');
    const r2 = await runExport('exportSet', [{ v: '2', wait: 1000 }, { v: false, wait: 1000 }]);
    ok(!r2.locked && r2.downloads.length === 1, '①：時間内の「キャンセル」は、これまでどおり「パスワードを空にして書き出す」');
  }
  {
    const r = await runExport('exportEnc', [{ v: false, wait: 6 * 60000 }]);
    ok(r.locked && r.calls.length === 0 && r.stopped, '①：全体の書き出しで、確認を出したまま時間切れ → アプリの鍵での書き出しに進まない');
  }
  ok(/function askPrompt\(msg, def\) \{[\s\S]{0,140}if \(dialogOverdue\(since\)\) throw lockForTimeout\(\);/.test(html) && /function lockForTimeout\(\) \{\s*lockNow\(\);/.test(html), '①：入力の画面（askPrompt）も、時間切れはロックして止める（null＝やめる とは別）');
  ok(/addEventListener\('unhandledrejection', e => \{ if \(e\.reason && e\.reason\.code === TIMEOUT_LOCK\) e\.preventDefault\(\); \}\);/.test(html), '①：止めた印は、受け止めるところが無くてもエラーとして出さない');
  // ② 退避の選び方
  {
    const stSrc = sect('  const UNSAVED_KEY', '  /* V2.01.002〜 ほかのタブ');
    const mk = (stored, mem) => {
      const m = new Map(); if (stored) m.set('snippet-book:v5:unsaved', JSON.stringify(stored));
      const store = { set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
      const env = { m, answers: [] };
      const T = new Function('store', 'env', `
        let lockEpoch = 0; const lockedSince = ep => ep !== lockEpoch;
        let vault = { vaultId: 'V' }, cryptoKey = 'KEY', viewOnly = false, book = { n: '今' }, editSeq = 1, savedSeq = 1;
        const hasUnsaved = () => editSeq > savedSeq;
        const loadJSON = async k => { const v = env.m.get(k); return v ? JSON.parse(v) : null; };
        const decryptJSON = async (key, s) => JSON.parse(s.ct);
        const encryptJSON = async (key, obj) => ({ iv: 'i', ct: JSON.stringify(obj) });
        const normalize = x => x; const histText = () => 'x　y';
        const askConfirm = msg => { const a = env.answers.shift(); if (typeof a === 'function') return a(); return a; }; const confirm = askConfirm;
        const render = () => {}; const renderSets = () => {}; const setStatus = () => {};
        const persist = async () => { if (cryptoKey) savedSeq = editSeq; };
        const navigator = { locks: { request: (n, fn) => fn() } };   /* このまねの中だけの Web Locks（試しごとに分ける） */ ${stSrc}
        return { offerUnsaved, set mem(s) { unsavedStash = s; }, get mem() { return unsavedStash; }, get book() { return book; }, get io() { return typeof stashIO === 'undefined' ? Promise.resolve() : stashIO; } };`)(store, env);
      if (mem) T.mem = mem;
      return { T, env, stored: () => m.has('snippet-book:v5:unsaved') ? JSON.parse(m.get('snippet-book:v5:unsaved')) : null };
    };
    const A = { vaultId: 'V', at: 1000, ct: JSON.stringify({ n: '古い退避A' }) };
    const B = { vaultId: 'V', at: 2000, ct: JSON.stringify({ n: '新しい退避B' }) };
    {
      // チャッピーさんの順番：端末に古い A・メモリにだけ新しい B（書けなかった）→ 戻すを承認
      const { T, env, stored } = mk(A, B);
      env.answers.push(true);
      await T.offerUnsaved(); await T.io; await sleep(10);
      ok(T.book.n === '新しい退避B', '②：端末に古い A・メモリにだけ新しい B があるときは、新しい B を戻す（前の版は A を戻した）');
      ok(T.mem === null && stored() === null, '②：B を戻して保存できたら、B とそれより古い A を消す');
    }
    {
      // 戻すか聞いている間に、ほかのタブがもっと新しい C を残した
      const C = { vaultId: 'V', at: 3000, ct: JSON.stringify({ n: 'あとの退避C' }) };
      const r = mk(A, B);
      r.env.answers.push(() => { r.env.m.set('snippet-book:v5:unsaved', JSON.stringify(C)); return true; });
      await r.T.offerUnsaved(); await r.T.io; await sleep(10);
      ok(r.T.book.n === '新しい退避B' && r.stored() && r.stored().at === 3000, '②：戻したもの（B）より新しい退避（C）は消さない');
    }
    {
      // 捨てる：B を捨てても、あとの C は残る
      const C = { vaultId: 'V', at: 3000, ct: JSON.stringify({ n: 'あとの退避C' }) };
      const r = mk(A, B);
      r.env.answers.push(false, () => { r.env.m.set('snippet-book:v5:unsaved', JSON.stringify(C)); return true; });
      await r.T.offerUnsaved(); await r.T.io; await sleep(10);
      ok(r.T.book.n === '今' && r.T.mem === null && r.stored() && r.stored().at === 3000, '②：「捨てる」も、捨てたものとそれより古い退避だけを消す');
    }
    {
      // 端末にだけ新しいものがあれば、それを出す
      const { T, env } = mk(B, A);
      env.answers.push(true);
      await T.offerUnsaved(); await T.io;
      ok(T.book.n === '新しい退避B', '②：端末のほうが新しければ、端末のものを戻す');
    }
  }
  ok(/function clearUnsaved\(target = null\)/.test(html) && /async function resetAll\(\)[\s\S]{0,700}clearUnsaved\(\);/.test(html), '②：すべて消すのは、リセットと別の金庫の退避のときだけ（引数なし）');
})();

console.log('26. 退避は全タブ共通の順番待ちで読み書き・同じ時刻でも見分ける（V2.01.010〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); const j = i < 0 ? -1 : html.indexOf(to, i + from.length); return i < 0 || j < 0 ? '' : html.slice(i, j); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stSrc = sect('  const UNSAVED_KEY', '  /* V2.01.002〜 ほかのタブ');
  // 2つのタブが共有する保存先と Web Locks のまね
  const shared = () => {
    const m = new Map(); const getDelay = [];
    let q = Promise.resolve();
    const locks = { request: (name, fn) => { const p = q.then(() => fn()); q = p.catch(() => {}); return p; } };
    const store = {
      get: async k => { const d = getDelay.shift() || 0; const v = m.get(k); if (d) await sleep(d); if (v === undefined) throw new Error('not found'); return { value: v }; },
      set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    };
    return { m, getDelay, nav: { locks }, store, read: () => m.has('snippet-book:v5:unsaved') ? JSON.parse(m.get('snippet-book:v5:unsaved')) : null };
  };
  const tab = (S, answers = []) => new Function('store', 'navigator', 'env', `
    const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } };
    let lockEpoch = 0; const lockedSince = ep => ep !== lockEpoch;
    let vault = { vaultId: 'V' }, cryptoKey = 'KEY', viewOnly = false, book = { n: '今' }, editSeq = 1, savedSeq = 1;
    const hasUnsaved = () => editSeq > savedSeq;
    const decryptJSON = async (key, s) => JSON.parse(s.ct);
    const encryptJSON = async (key, obj) => ({ iv: 'i', ct: JSON.stringify(obj) + '#' + Math.random() });
    const normalize = x => x; const histText = () => 'x　y';
    const askConfirm = msg => env.answers.shift(); const confirm = askConfirm;
    const render = () => {}; const renderSets = () => {}; const setStatus = () => {};
    const persist = async () => { if (cryptoKey) savedSeq = editSeq; };
    ${stSrc}
    return { offerUnsaved, stashUnsaved, clearUnsaved, set mem(s) { unsavedStash = s; }, get mem() { return unsavedStash; }, set book(b) { book = b; editSeq++; }, get book() { return book; }, get io() { return typeof stashIO === 'undefined' ? Promise.resolve() : stashIO; } };`)(S.store, S.nav, { answers });
  // ① 別のタブの新しい退避を消さない：タブ1が A を消すために端末を読んで確かめている間に、タブ2が B を残す
  {
    const S = shared();
    const A = { vaultId: 'V', at: 1000, ct: 'A-ct' };
    S.m.set('snippet-book:v5:unsaved', JSON.stringify(A));
    const T1 = tab(S), T2 = tab(S);
    S.getDelay.push(60);                 // タブ1の「読む」に時間がかかる（その間にタブ2が書く）
    T1.clearUnsaved(A);                  // タブ1：A を捨てる
    await sleep(10);
    T2.book = { n: 'タブ2の新しい退避B' };
    await T2.stashUnsaved();             // タブ2：B を残す
    await T1.io; await T2.io; await sleep(20);
    const st = S.read();
    ok(st && /タブ2の新しい退避B/.test(st.ct), '①：タブ1が古い A を消す途中に、タブ2が新しい B を残しても、B は消えない（読む・確かめる・消すを全タブ共通の順番待ちで行う）');
  }
  // ② 同じ時刻の退避を見分ける
  {
    const S = shared();
    const A = { vaultId: 'V', at: 1000, tab: 'T1', seq: 1, ct: JSON.stringify({ n: '同じタブの前の退避A' }) };
    const B = { vaultId: 'V', at: 1000, tab: 'T1', seq: 2, ct: JSON.stringify({ n: '同じタブのあとの退避B' }) };
    S.m.set('snippet-book:v5:unsaved', JSON.stringify(A));
    const T = tab(S, [true]); T.mem = B;
    await T.offerUnsaved(); await T.io; await sleep(10);
    ok(T.book.n === '同じタブのあとの退避B', '②：同じ時刻でも、同じタブの番号があとの B を戻す（前の版は A を戻した）');
    ok(T.mem === null && S.read() === null, '②：B を戻したら、同じタブの前の退避 A も消す');
  }
  {
    const S = shared();
    const A = { vaultId: 'V', at: 1000, tab: 'X', seq: 5, ct: JSON.stringify({ n: 'ほかのタブの退避A' }) };
    const B = { vaultId: 'V', at: 1000, tab: 'Y', seq: 1, ct: JSON.stringify({ n: 'このタブの退避B' }) };
    S.m.set('snippet-book:v5:unsaved', JSON.stringify(A));
    const T = tab(S, [true]); T.mem = B;
    await T.offerUnsaved(); await T.io; await sleep(10);
    ok(T.book.n === 'このタブの退避B' && S.read() && S.read().tab === 'X', '②：ちがうタブで同じ時刻なら、このタブの B を戻し、ほかのタブの A は消さない（次に開いたときに聞く）');
  }
  {
    // ほかのタブのもっと新しい退避は、こちらの退避で上書きしない
    const S = shared();
    const C = { vaultId: 'V', at: Date.now() + 60000, tab: 'X', seq: 9, ct: 'C-ct' };
    S.m.set('snippet-book:v5:unsaved', JSON.stringify(C));
    const T = tab(S); T.book = { n: 'こちらの退避' };
    await T.stashUnsaved(); await T.io;
    ok(S.read().ct === 'C-ct' && T.mem && /こちらの退避/.test(T.mem.ct), '②：ほかのタブのもっと新しい退避は上書きしない（こちらの退避はこのタブの中に残る）');
  }
  ok(/const withStashLock = fn => STASH_LOCKS \? STASH_LOCKS\.request\('snippet-book-unsaved', fn\) : fn\(\);/.test(html) && /const run = \(\) => withStashLock\(async \(\) => \{/.test(html), '①：端末の退避の読み書きは Web Locks（snippet-book-unsaved）の中');
  ok(/tab: STASH_TAB, seq: tabSeq/.test(html) && /const sameStash = \(a, b\) => !!\(a && b && typeof a\.ct === 'string' && a\.ct === b\.ct\);/.test(html), '②：退避は暗号文で見分け、タブの印と番号を持つ');
})();

console.log('27. Web Locks が無いブラウザでは、退避を端末に書かずタブの中だけに残す（V2.01.011〜・チャッピーさんの再点検）');
await (async () => {
  const sect = (from, to) => { const i = html.indexOf(from); const j = i < 0 ? -1 : html.indexOf(to, i + from.length); return i < 0 || j < 0 ? '' : html.slice(i, j); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stSrc = sect('  const UNSAVED_KEY', '  /* V2.01.002〜 ほかのタブ');
  const mk = (nav, answers = []) => {
    const m = new Map();
    const store = { get: async k => { if (!m.has(k)) throw new Error('nf'); return { value: m.get(k) }; }, set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
    const T = new Function('store', 'navigator', 'env', `
      const loadJSON = async k => { try { return JSON.parse((await store.get(k)).value); } catch { return null; } };
      let lockEpoch = 0; const lockedSince = ep => ep !== lockEpoch;
      let vault = { vaultId: 'V' }, cryptoKey = 'KEY', viewOnly = false, book = { n: '今' }, editSeq = 1, savedSeq = 1;
      const hasUnsaved = () => editSeq > savedSeq;
      const decryptJSON = async (key, s) => JSON.parse(s.ct.split('#')[0]);
      const encryptJSON = async (key, obj) => ({ iv: 'i', ct: JSON.stringify(obj) + '#' + Math.random() });
      const normalize = x => x; const histText = () => 'x　y';
      const askConfirm = msg => env.answers.shift(); const confirm = askConfirm;
      const render = () => {}; const renderSets = () => {}; const setStatus = () => {};
      const persist = async () => { if (cryptoKey) savedSeq = editSeq; };
      ${stSrc}
      return { offerUnsaved, stashUnsaved, clearUnsaved, get mem() { return unsavedStash; }, set book(b) { book = b; editSeq++; }, get book() { return book; }, get unsaved() { return hasUnsaved(); }, get io() { return typeof stashIO === 'undefined' ? Promise.resolve() : stashIO; } };`)(store, nav, { answers });
    return { T, m, stored: () => m.has('snippet-book:v5:unsaved') ? JSON.parse(m.get('snippet-book:v5:unsaved')) : null };
  };
  {
    const { T, stored } = mk(undefined);
    T.book = { n: '古いブラウザの編集' };
    const r = await T.stashUnsaved(); await T.io;
    ok(r === true && T.mem && /古いブラウザの編集/.test(T.mem.ct) && !T.unsaved && stored() === null, 'Web Locks が無いと、退避はタブの中だけに残し、端末には書かない（ほかのタブと競い合わない）');
  }
  {
    const { T, stored } = mk({ locks: { request: (n, fn) => fn() } });
    T.book = { n: '新しいブラウザの編集' };
    await T.stashUnsaved(); await T.io;
    ok(stored() && /新しいブラウザの編集/.test(stored().ct), 'Web Locks があれば、これまでどおり端末にも書く');
  }
  {
    // 端末に残っている退避（ほかのブラウザの版などで書かれたもの）は、Web Locks が無いと、選んで消すことはしない
    const r = mk(undefined, [true]);
    const A = { vaultId: 'V', at: 1000, tab: 'X', seq: 1, ct: JSON.stringify({ n: '端末の退避A' }) };
    r.m.set('snippet-book:v5:unsaved', JSON.stringify(A));
    await r.T.offerUnsaved(); await r.T.io; await sleep(10);
    ok(r.T.book.n === '端末の退避A' && r.stored() !== null, 'Web Locks が無いと、戻しても端末の退避は選んで消さない（順番待ちが無いので、ほかのタブの退避を消すおそれがある）');
    r.T.clearUnsaved(); await r.T.io;
    ok(r.stored() === null, 'リセットなど「すべて消す」ときは、Web Locks が無くても消す');
  }
  ok(/const canShare = !!STASH_LOCKS;/.test(html) && /if \(cur\) \{\s*if \(!canShare\) return;/.test(html) && /drop === null \|\| \(canShare && supersededBy\(st, drop\)\)/.test(html), 'Web Locks が無いときの分かれ道がある');
})();

console.log(`合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
