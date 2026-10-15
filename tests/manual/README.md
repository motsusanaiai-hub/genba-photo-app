# 手動テスト（実環境に接続するもの）

このフォルダのスクリプトは、**手動で実行する**ためのものです。`npm run test`（Vitest）には含まれず、自動では実行されません。

## storage-isolation.mjs — Storage のユーザー間アクセス拒否テスト（staging 専用）

ユーザーAの写真を、ユーザーBが Storage から取得できないことを、staging の Supabase で確認します。

### 何をするか
| テスト | 内容 | 期待結果 |
|---|---|---|
| TEST 1 | Aでログインし、Aの写真1枚を download と署名URL発行 | 両方成功（PASS） |
| TEST 2 | Bでログインし、同じ写真を download と署名URL発行 | 両方失敗＝拒否（PASS） |
| TEST 3 | 認証なしで公開URLにアクセス | 取得できない（PASS） |

読み取りだけを行い、データの登録・更新・削除はしません。パスワードやキー、署名URL、パス、ユーザーIDは画面にもファイルにも出しません。

### 準備するもの
- staging の **anon キー**（Supabase の staging プロジェクト → Project Settings → API の「anon / public」。**service_role キーは使わないでください**。入力しても停止します）
- テスト用アカウントA・B のメールアドレスとパスワード（本番のアカウントは使わない）
- Aに、クラウド同期済みの写真が1枚以上あること（Previewで写真を表示できていれば済んでいます）

### 実行方法（Windows PowerShell）
1. PowerShell を開きます（スタートメニューで「PowerShell」と入力）。
2. プロジェクトのフォルダへ移動します。
   ```powershell
   cd "D:\AI\開発\git clone\genba-photo-app"
   ```
3. （任意）まず、通信しない自己検査で、安全確認が動くことを確かめます。
   ```powershell
   node tests/manual/storage-isolation.mjs --selftest
   ```
4. 本番のテストを起動します。
   ```powershell
   node tests/manual/storage-isolation.mjs
   ```
5. 画面の案内に従って、次を順に入力します。**パスワードとキーは入力しても画面に表示されません**（そのまま入力して Enter）。
   - staging の anon キー
   - ユーザーA のメールアドレス → パスワード
   - ユーザーB のメールアドレス → パスワード

   パスワードやキーを、Claude とのチャットに貼り付けないでください。環境変数やファイルに保存する必要もありません。

### 結果の見方
- **PASS**: すべて期待どおり。Bは取得できず、公開URLも拒否されました。
- **FAIL**: Bが取得できた、または公開URLで取得できた項目があります。セキュリティ上の問題です。結果の文面（PASS/FAIL の表）だけをClaudeに伝えてください。
- **INCONCLUSIVE**: 判定できませんでした（ログイン失敗、Aの写真がない、通信障害など）。「拒否に成功した」とは判断していません。表示された注意の内容を確認して、再実行してください。

終了コード: PASS=0、FAIL=1、INCONCLUSIVE=2。

### 終了方法
- テストは自動で終わります（最後に、このスクリプトの端末内のログイン状態を消します。他の端末やPreviewのログインは切れません）。
- 途中でやめたいときは `Ctrl + C` を押します。
- 入力する端末が対話できない場合（パイプや自動実行）は、安全のため起動しません。

### 安全のための仕組み
- 接続先は staging（`jhlyudtuawukojymylmr.supabase.co`）に固定され、ホスト名が一致しなければ接続前に停止します。本番の Project ref を含む入力も停止します。
- anon キー以外（service_role、secret キー、別プロジェクトのキー）は停止します。
