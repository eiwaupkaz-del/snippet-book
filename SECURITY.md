# 守りに関わる問題の知らせ方（Security Policy）

スニペット帳は、パスワードのような大切なものを預かる道具です。守りに関わる問題を見つけたら、**公開の Issue には書かず**、次の方法で知らせてください。

- GitHub の「Security」タブ →「Report a vulnerability」（非公開で届きます）

知らせてほしいこと：

1. どの版か（画面上部に出ている版番号。例：V2.00.002）
2. どの端末・ブラウザか
3. 何が起きるか、どうすれば同じことが起きるか

## 対象

- `app/snippet-book.html` の暗号と鍵のしくみ（データの鍵・パスキーの PRF・復元キー・バックアップの形）
- https://snippet.eiwa-up.jp/ で配っている中身が、このリポジトリと違っていること

## 対象にならないもの

- 端末そのものが乗っ取られている場合（ロックが外れた端末を他人に使われる、など）
- 利用者が復元キーとバックアップファイルを同じ場所に置き、両方を取られた場合

To report a security issue, please use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") instead of opening a public issue.
