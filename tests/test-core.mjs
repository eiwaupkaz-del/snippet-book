// 依頼100 スニペット帳 V2 の鍵のしくみの手元テスト（Node 18 以降）
// 使い方：node test-core.mjs [snippet-book.html]
// HTML の /*<core> 〜 /*</core>*/ を切り出して、そのまま動かす（写しを作らない）。
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.argv[2] || join(here, 'snippet-book.html'), 'utf8');
const a = html.indexOf('/*<core>'), b = html.indexOf('/*</core>*/');
if (a < 0 || b < 0) { console.error('core の目印が見つかりません'); process.exit(1); }
const names = ['enc','dec','b64','b64url','randomBytes','PBKDF2_ITER_OLD','PBKDF2_ITER_NEW','deriveKey','encryptJSON','decryptJSON',
  'newDK','importDK','genRecoveryKey','normalizeRecoveryKey','formatRecoveryKey','makeRecoveryWrap','makePasskeyWrap',
  'openWithRecovery','openWithPrf','newVaultMeta','isV5File','isV4File','makeV5File','openV4File','makePwFile','RK_ABC','checkV5Auth','fileNameTag','nameTagOf','canonJSON','v4Params'];
// V2.02.000〜 core の知らせの文は L(日本語, 英語) で選ぶ。ここでは日本語を選ぶ（英語は test-v2200.mjs で確かめる）
const C = new Function('crypto', 'L', html.slice(a, b) + `\nreturn { ${names.join(', ')} };`)(globalThis.crypto || webcrypto, (ja, en) => ja);

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ○ ' + label); } else { fail++; console.log('  × ' + label); } };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const BOOK = { name:'テスト帳', active:0, sets:[{ name:'仕事', items:[{ id:'a1', title:'サーバー', user:'kaz', text:'秘密のことば', secret:true }] }] };

console.log('1. 復元キー');
{
  const rk = C.genRecoveryKey();
  ok(rk.length === 25 && [...rk].every(c => C.RK_ABC.includes(c)), '25文字で、決めた32文字だけを使う');
  const f = C.formatRecoveryKey(rk);
  ok(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(f), '5文字ずつ - で区切って見せる');
  ok(C.normalizeRecoveryKey(f) === rk, '区切りつきでも読める');
  ok(C.normalizeRecoveryKey(' ' + f.toLowerCase().replace(/-/g, ' ') + ' ') === rk, '小文字・空白でも読める');
  ok(C.normalizeRecoveryKey('O'.repeat(25)) === '0'.repeat(25) && C.normalizeRecoveryKey('IL'.repeat(12) + 'I') === '1'.repeat(25), 'O は 0、I と L は 1 に直す');
  ok(C.normalizeRecoveryKey(rk.slice(1)) === null && C.normalizeRecoveryKey(rk + 'A') === null, '長さが違えば読まない');
  ok(C.normalizeRecoveryKey('U'.repeat(25)) === null, '使わない文字（U）は読まない');
  const seen = new Set(); for (let i = 0; i < 400; i++) for (const c of C.genRecoveryKey()) seen.add(c);
  ok(seen.size === 32, '32文字がまんべんなく出る');
  const many = new Set(Array.from({ length: 200 }, () => C.genRecoveryKey()));
  ok(many.size === 200, '毎回ちがう復元キーになる');
}

console.log('2. 復元キーで DK を包む・ほどく');
{
  const dk = C.newDK(), rk = C.genRecoveryKey();
  const w = await C.makeRecoveryWrap(dk, rk);
  ok(w.type === 'recovery' && w.salt && w.iv && w.ct && !JSON.stringify(w).includes(rk), '包みには復元キーそのものが入らない');
  const got = await C.openWithRecovery([w], C.formatRecoveryKey(rk).toLowerCase());
  ok(got && same([...got], [...dk]), '正しい復元キーで同じ DK が出る');
  ok(await C.openWithRecovery([w], C.genRecoveryKey()) === null, '違う復元キーでは開かない');
  ok(await C.openWithRecovery([w], 'みじかい') === null, '形が違えば開かない');
  const w2 = await C.makeRecoveryWrap(dk, rk);
  ok(w2.salt !== w.salt && w2.ct !== w.ct, '同じ鍵でも包むたびに別の見た目になる');
}

console.log('3. パスキー（PRF の値）で DK を包む・ほどく');
{
  const dk = C.newDK(), prf = C.randomBytes(32), prfSalt = C.b64.enc(C.randomBytes(32));
  const w = await C.makePasskeyWrap(dk, prf, 'cred-1', prfSalt, 'Mac の Safari');
  ok(w.type === 'passkey' && w.credId === 'cred-1' && w.label === 'Mac の Safari' && w.prfSalt === prfSalt, '包みにパスキーの目印と名前が入る');
  ok(!JSON.stringify(w).includes(C.b64.enc(prf)), '包みには PRF の値が入らない');
  const got = await C.openWithPrf(w, prf);
  ok(same([...got], [...dk]), '同じ PRF の値で同じ DK が出る');
  ok(await throws(() => C.openWithPrf(w, C.randomBytes(32))), '違う PRF の値では開かない');
}

console.log('4. V2 のバックアップファイル');
{
  const dk = C.newDK(), rk = C.genRecoveryKey(), prf = C.randomBytes(32);
  const meta = C.newVaultMeta([await C.makeRecoveryWrap(dk, rk)]);
  meta.wraps.push(await C.makePasskeyWrap(dk, prf, 'cred-2', C.b64.enc(C.randomBytes(32)), 'iPhone の Safari'));
  const key = await C.importDK(dk);
  const file = JSON.parse(JSON.stringify(await C.makeV5File(meta, key, dk, BOOK, { mode:'vault', role:'overwrite-backup', name:BOOK.name })));
  ok(C.isV5File(file) && !C.isV4File(file), 'V2 の形と分かる（V1 とまちがえない）');
  ok(file.role === 'overwrite-backup' && file.vaultId === meta.vaultId && file.wraps.length === 2, '上書きの印・金庫の ID・包み2つが入る');
  ok(!JSON.stringify(file).includes('秘密のことば'), '中身は平文で入らない');
  const dkByRk = await C.openWithRecovery(file.wraps, rk);
  ok(same(await C.decryptJSON(await C.importDK(dkByRk), file), BOOK), '別の端末でも、復元キーだけで中身を開ける');
  const dkByPk = await C.openWithPrf(file.wraps.find(w => w.type === 'passkey'), prf);
  ok(same(await C.decryptJSON(await C.importDK(dkByPk), file), BOOK), '同期したパスキー（同じ PRF の値）だけでも開ける');
  const bad = { ...file, ct: C.b64.enc(new Uint8Array(C.b64.dec(file.ct)).map((x, i) => i === 5 ? x ^ 1 : x)) };
  ok(await throws(async () => C.decryptJSON(await C.importDK(dkByRk), bad)), '中身を1ビットでも書きかえられたら開かない');
  ok(await C.openWithRecovery(file.wraps.filter(w => w.type !== 'recovery'), rk) === null, '復元キーの包みが無ければ復元キーでは開かない');
}

console.log('4b. 改ざんを見分ける印（V2.00.010〜・チャッピーさんの指摘）');
{
  const dk = C.newDK(), rk = C.genRecoveryKey(), prf = C.randomBytes(32);
  const meta = C.newVaultMeta([await C.makeRecoveryWrap(dk, rk)]);
  meta.wraps.push(await C.makePasskeyWrap(dk, prf, 'cred-mac', 'cA==', 'Mac の Chrome'));
  meta.wraps.push(await C.makePasskeyWrap(dk, prf, 'cred-iph', 'cA==', 'iPhone の Safari'));
  meta.revoked = ['cred-old'];
  meta.history = [{ at: 1762000000000, device:'MacBook', browser:'Chrome', kind:'obk' }];
  const key = await C.importDK(dk);
  const text = JSON.stringify(await C.makeV5File(meta, key, dk, BOOK, { mode:'vault', role:'overwrite-backup', name:BOOK.name }), null, 2);
  const file = JSON.parse(text);
  ok(file.auth && file.auth.v === 1 && typeof file.auth.mac === 'string', '印（auth）が付く');
  ok(await C.checkV5Auth(dk, file) === 'ok', '書き出したままなら印が合う（JSON にして読み戻しても）');
  ok(!text.includes('MacBook') && file.hist && file.hist.ct, '履歴は暗号化して入る（端末の名前は平文で見えない）');
  ok(same(await C.decryptJSON(key, file.hist), meta.history), '履歴は鍵で開ける');
  // チャッピーさんの試験：暗号文はそのままで、revoked だけを書きかえる
  const t1 = { ...file, revoked: ['cred-old', 'cred-iph'] };
  ok(same(await C.decryptJSON(key, t1), BOOK), '（本体は書きかえていないので、本体だけなら開けてしまう＝前の版の穴）');
  ok(await C.checkV5Auth(dk, t1) === 'bad', 'revoked だけ書きかえても、印が合わない（見破る）');
  ok(await C.checkV5Auth(dk, { ...file, wraps: file.wraps.filter(w => w.credId !== 'cred-iph') }) === 'bad', 'パスキーを1つ消しても見破る');
  ok(await C.checkV5Auth(dk, { ...file, wraps: file.wraps.map(w => w.credId === 'cred-iph' ? { ...w, label:'偽物' } : w) }) === 'bad', 'パスキーの名前を変えても見破る');
  const { hist, ...noHist } = file;
  ok(await C.checkV5Auth(dk, noHist) === 'bad', '履歴を消しても見破る');
  ok(await C.checkV5Auth(dk, { ...file, name:'ちがう名前' }) === 'bad', 'データ名を変えても見破る');
  ok(await C.checkV5Auth(dk, { ...file, auth: null }) === 'bad' && await C.checkV5Auth(dk, { ...file, auth: { v:1, mac:'AAAA' } }) === 'bad', '印をこわしても見破る');
  const { auth, ...noAuth } = file;
  ok(await C.checkV5Auth(dk, noAuth) === 'none', '印が無いもの（V2.00.009 まで）は「無い」と分かる（アプリは一覧を合わせない）');
  const other = C.newDK();
  ok(await C.checkV5Auth(other, file) === 'bad', '別の鍵では印を作れない・合わない');
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(file).reverse())));
  ok(await C.checkV5Auth(dk, reordered) === 'ok', 'キーの並びが変わっても（中身が同じなら）合う');
  // ファイル名の印
  const tag = await C.fileNameTag(dk, text);
  ok(/^[0-9A-HJKMNP-TV-Z]{10}$/.test(tag), `ファイル名の印は10文字（例 ${tag.slice(0, 3)}…）`);
  ok(tag === await C.fileNameTag(dk, text) && tag !== await C.fileNameTag(other, text), '同じ鍵・同じ中身なら同じ印・別の鍵なら違う');
  ok(tag !== await C.fileNameTag(dk, text.replace('cred-old', 'cred-olx')), '中身が1文字でも違えば印が違う');
  ok(C.nameTagOf(`テスト帳-20261103-1405-obk-${tag}.enc.json`) === tag, 'ファイル名から印を読む');
  ok(C.nameTagOf(`テスト帳-20261103-1405-obk-${tag} (1).enc.json`) === tag && C.nameTagOf(`a-bk-${tag.toLowerCase()}.enc.json`) === tag, 'ブラウザが足す「 (1)」・小文字でも読める');
  ok(C.nameTagOf('テスト帳-20261103-上書きバックアップ.enc.json') === null, '前の版の名前には印が無い');
}

console.log('5. 古い形（V1）とパスワードのファイル');
{
  // V1.04.002 と同じ作り方（PBKDF2 25万回・iter の記録なし）
  const salt = C.randomBytes(16);
  const k1 = await C.deriveKey('Sakura-kumo-Hoshi-42!', salt);
  const v1 = { version:4, enc:'aes-gcm', kdf:'pbkdf2', mode:'master', role:'overwrite-backup', name:'旧', salt:C.b64.enc(salt), ...(await C.encryptJSON(k1, BOOK)) };
  ok(C.isV4File(v1) && !C.isV5File(v1), 'V1 のファイルを V1 と分かる');
  ok(same(await C.openV4File(v1, 'Sakura-kumo-Hoshi-42!'), BOOK), 'V1 のファイルを、そのときのパスワードで開ける');
  ok(await throws(() => C.openV4File(v1, 'ちがう')), 'V1 のファイルは違うパスワードでは開かない');
  const pf = await C.makePwFile('Tora-ume-Kaze-77#', BOOK, { mode:'own', name:'送る' });
  ok(pf.iter === C.PBKDF2_ITER_NEW && pf.iter >= 600000 && pf.mode === 'own', '新しく作るパスワードのファイルは 60万回で、回数を書く');
  ok(same(await C.openV4File(pf, 'Tora-ume-Kaze-77#'), BOOK), 'ファイル専用パスワードのファイルを開ける');
  ok(await throws(() => C.openV4File({ ...pf, iter: C.PBKDF2_ITER_OLD }, 'Tora-ume-Kaze-77#')), '回数が違えば開かない（回数をちゃんと使っている）');
}

console.log('5b. ファイルの計算回数を確かめる（V2.01.002〜）');
{
  const salt = C.b64.enc(C.randomBytes(16));
  const bad = it => { try { C.v4Params({ salt, iter: it }); return false; } catch { return true; } };
  ok(C.v4Params({ salt }).iter === C.PBKDF2_ITER_OLD && C.v4Params({ salt, iter: C.PBKDF2_ITER_NEW }).iter === C.PBKDF2_ITER_NEW, '回数の無いもの（V1）と 60万回のものは受け付ける');
  ok(bad(4294967295) && bad(1e9) && bad(2000001), 'とても大きい回数（約43億回など）は、計算を始める前に断る');
  ok(bad(1.5) && bad('600000') && bad(-1) && bad(0) && bad(99999) && bad(null), '整数でない・小さすぎる・文字の回数も断る');
  ok((() => { try { C.v4Params({ salt: 'AAAA', iter: 600000 }); return false; } catch { return true; } })(), 'salt が短すぎるものも断る');
  let threw = false; try { await C.openV4File({ salt, iter: 4294967295, iv:'AAAA', ct:'AAAA' }, 'x'); } catch (e) { threw = /計算回数/.test(e.message); }
  ok(threw, 'openV4File も、計算の前に断る');
}

console.log('6. 金庫の形');
{
  const m = C.newVaultMeta([]);
  ok(m.version === 5 && /^[A-Za-z0-9_-]{22}$/.test(m.vaultId), '金庫の ID は 16 バイトのでたらめ（URL で使える形）');
  ok(C.newVaultMeta([]).vaultId !== m.vaultId, '金庫ごとに ID が違う');
  ok(C.b64url.dec(m.vaultId).byteLength === 16, 'パスキーの利用者 ID に戻せる');
}

console.log(`合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
