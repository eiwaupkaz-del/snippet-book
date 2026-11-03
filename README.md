<p align="center"><img src="docs/icon-512.png" width="120" alt="スニペット帳のアイコン"></p>

# スニペット帳（snippet-book）

[![verify](https://github.com/eiwaupkaz-del/snippet-book/actions/workflows/verify.yml/badge.svg)](https://github.com/eiwaupkaz-del/snippet-book/actions/workflows/verify.yml)

よく使う文章・コマンド・ID やパスワードを登録しておき、クリック（スマホはタップ）だけでコピーできる道具です。

- 使う：**https://snippet.eiwa-up.jp/**
- マニュアル：[docs/manual-V2.00.009.pdf](docs/manual-V2.00.009.pdf)
- 現行版：**Version 2.00.009**

> A small, single-file web app to store and copy text snippets and credentials. Everything stays in your browser, encrypted with a random key that is wrapped by a passkey (WebAuthn PRF) and by a recovery key. Your data is never sent anywhere, and the page loads nothing from other sites.

---

## このリポジトリを公開している理由

スニペット帳は、パスワードのような大切なものを預かる道具です。だから、**中身を誰でも読めて、確かめられる**ようにしています。

- アプリは HTML ファイル 1 枚（[`app/snippet-book.html`](app/snippet-book.html)）と、アイコン・文字の形（フォント）だけです。**ほかのサイトからは何も読み込みません**（Version 2.00.003 から。前の版は文字の形を Google Fonts から読んでいました）。
- サイトで配っている中身と守りのヘッダー（CSP）が、このリポジトリと**同じかどうか**を、GitHub が 1 時間に 1 回自動で確かめています（上の **verify** の印。緑なら一致）。

## 守り方のしくみ（かんたんに）

- 登録した内容は、あなたのブラウザの中（localStorage）だけに、暗号化して保存します。**登録した内容を外へ送るしくみはありません。**
- ページの CSP（ブラウザへの守りの指示）で、次のようにしています。
  - プログラムからの送信（fetch など）を止める（`connect-src 'none'`）
  - 画像・文字の形などは、同じサイトのものだけを読む（`default-src 'none'`・`font-src 'self'`）
  - 動かしてよいスクリプトを、ハッシュ値で 1 つに決める。あとから書き足されたスクリプトは動かない（`script-src 'sha256-…'`）
  - ただし CSP は「すべての通信を止める」ものではありません。たとえばリンクを開く・画面を移るといった動きは止められません。
- 暗号の鍵は、アプリが作るでたらめな 256bit の鍵です。人が覚えるパスワードは使いません。
- その鍵を、次の 2 つで「包んで」保存します。
  - **パスキー**（指紋・顔など）：WebAuthn の PRF 拡張で取り出した値から包む鍵を作ります。
  - **復元キー**（25 文字・125bit のでたらめな文字）：新しい端末やパスキーが使えないときに使います。
- バックアップファイルにも、包んだ鍵だけが入ります。**バックアップを盗まれても、パスキーか復元キーが無ければ読めません。**
- パスキーの PRF の値と復元キーそのものは、どこにも保存しません。
- 人に渡す「このセットを暗号化して送る」のパスワードは、アプリが 20 文字（約 99 ビット）のでたらめな文字で作ります。自分で決める「ファイル専用パスワード」は 12 文字以上です（Version 2.00.003 から）。
- 何もしないまま決めた時間（はじめは 5 分）がたつと、自動でロックします。パスワード・復元キーをコピーしたら、30 秒後にクリップボードを空にします（Version 2.00.004 から。空にできるのはこの画面が前に出ているときだけで、戻らなければ残ります。クリップボードの履歴に入った分は消せません）。
- ロックすると（手でも自動でも）、データの鍵を消すだけでなく、画面に出していた中身・編集欄・検索の文字・人に送るパスワードの画面・打ちかけた復元キーも、ページからすべて消します（Version 2.00.005 から）。書き出し・人に送る・読み込みなどの途中でロックしたときは、終わったあとに画面を出さず、書き出さず、データにも足しません（Version 2.00.006 から）。パスキーの登録・復元キーの作り直し・鍵をすべて作り直すも同じで、途中でロックしたら鍵は前のまま変わらず、アプリも開き直りません（Version 2.00.007 から）。
- データと鍵の情報は1つの保存場所にまとめ、1回で書きます。保存が成功してから切りかえ、失敗したら何も変えません。データを開けないときも、見本で上書きせず手を付けません（Version 2.00.008 から）。
- パスキーの一覧は端末ごとに持ちます。同じ鍵のバックアップで、端末どうしの一覧を合わせられます（外したパスキーは戻りません・合わせる前にそのファイルが同じ鍵で開けることを確かめます）（Version 2.00.009 から）。
- 読み込むファイルは、先に全体を確かめ、形がおかしければ何も足しません。中身はすべて文字として扱い、5MB までです（Version 2.00.004 から）。

くわしくは [docs/how-it-works.md](docs/how-it-works.md) を見てください。

## 守れないこと

- **配っているページそのものを書きかえられた場合**は、その書きかえたページを開いたときに中身を読まれるおそれがあります。ウェブのアプリはどれも同じです。
  - 1 時間に 1 回の照らし合わせ（verify）は、書きかえに**あとで気づく**ためのしくみで、開く前に止めるものではありません。
  - サイトとこのリポジトリを更新できるのは、持ち主 1 人だけです。
  - 心配なときは、使う前に下の「本物か確かめる」で SHA-256 を見てください。
- ロックが外れた端末を他人に使われた場合も守れません（端末のロックを使ってください）。

## 本物か確かめる（SHA-256）

| 版 | SHA-256（snippet-book.html） |
|---|---|
| Version 2.00.009 | `30ea7c9d7c31382a1e1a784053c3867339a9b40a1bf02756beba359e38ae812b` |
| Version 2.00.008 | `993f31f5d75410802031ab291c35a6aeb60854edd19fcfa95c98df68fdf7059b` |
| Version 2.00.003 | `dae7fd31aedfdac2fd78f1da7458122d4157b29d4264ca21579e49d3cd37cd39` |

アイコン・フォントなどほかのファイルの値は [`app/SHA256SUMS`](app/SHA256SUMS) にあります。

Mac のターミナルで：

```bash
curl -s https://snippet.eiwa-up.jp/ | shasum -a 256
```

Windows の PowerShell で：

```powershell
Invoke-WebRequest https://snippet.eiwa-up.jp/ -OutFile snippet-book.html; Get-FileHash snippet-book.html -Algorithm SHA256
```

出てきた値が上の表と同じなら、いま配っているものは、このリポジトリのものと同じです。

## フォルダの中身

| 場所 | 中身 |
|---|---|
| `app/` | サイトで配っているファイルそのもの（HTML・アイコン・manifest・`fonts/`）と `SHA256SUMS` |
| `deploy/snippet.conf` | サイトの nginx の設定（守りのヘッダーと CSP）。verify が、公開中のサイトの CSP と同じか確かめます |
| `tests/test-core.mjs` | 鍵のしくみのテスト（HTML の中の `/*<core>` 〜 `/*</core>*/` を切り出して試します） |
| `tests/test-v2009.mjs` | 自動パスワードの強さ・外のサイトを読まないこと・CSP のハッシュが HTML と合うこと・取り込みの検査・自動ロックとクリップボード・ロックで画面に中身を残さないこと・途中でロックしたら何もしないこと（鍵の作業も）・データと鍵を1回で書くこと・パスキーの一覧を合わせることのテスト |
| `docs/` | マニュアル（PDF と元の HTML）・しくみの説明 |
| `.github/workflows/verify.yml` | テストと、サイトとの照らし合わせ（1 時間に 1 回） |

## テストを動かす

Node.js 18 以降で：

```bash
node tests/test-core.mjs
node tests/test-v2009.mjs
```

## 問題を見つけたら

ふつうの不具合は Issue で知らせてください。**守りに関わる問題**（データが読めてしまうなど）は、公開の Issue には書かず、[SECURITY.md](SECURITY.md) の方法で知らせてください。

## ライセンス

プログラムは [MIT License](LICENSE) です。アプリのアイコンと、その元になったマークは MIT の対象外です（[LICENSE](LICENSE) を見てください）。文字の形 IBM Plex Mono（`app/fonts/`）は SIL Open Font License 1.1 です（[app/fonts/OFL.txt](app/fonts/OFL.txt)）。
