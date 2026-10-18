# 現状仕様書（開発者向け）

最終更新: 2026-10-12（Excel出力仕様を開発ブランチ `feat/step6c-genbafoto-page-numbering` の内容に更新）

このドキュメントは genba-photo-app の **現在実際に動作している仕様** をまとめたものです。

`docs/requirements.md` ・ `docs/system-design.md` は実装前の設計書であり、
Supabaseへのデータ保存（projects/photos テーブル）や `/settings/templates` 画面など、
**実装と異なる部分（未着手のまま設計のみ残っている部分）が多く存在します。**

「今のアプリが何をできるか」を確認・説明する際は、本ドキュメントを正として参照してください。

> **【重要】5節（Excel出力）は開発ブランチ `feat/step6c-genbafoto-page-numbering`（HEAD `bcce8c4`）時点の仕様です。本番Web（main）には未反映で、公開済みの仕様ではありません。**
> 高互換出力（Excel直接作成モード）が使う Windows Helper 1.1.0 も開発・実機確認の段階で、公開前です。公開前に必要な確認は `docs/pre-launch-checklist.md` の「Helper 1.1.0 ＋ Web 同時リリース前後チェック」を参照してください。

---

## 1. 実装済み機能一覧

| 機能 | 概要 | 主な実装ファイル |
|---|---|---|
| 認証 | Supabase Authによる新規登録・ログイン・ログアウト。未設定時はlocalStorageモックで動作 | `src/hooks/useAuth.ts`, `src/lib/supabase.ts` |
| プロジェクト管理 | 工事案件の作成・編集・削除・一覧表示 | `src/hooks/useProjects.ts`, `src/store/projectStore.ts`, `src/pages/project/*` |
| 写真アップロード | 複数枚同時、ドラッグ&ドロップ、HEIC/JPG/PNG対応、フェーズ一括設定 | `src/components/photo/PhotoUploadModal.tsx` |
| カメラ直接撮影 | スマホFABから端末カメラを起動し即アップロード | `src/pages/project/ProjectDetailPage.tsx` |
| グリッド／台帳ビュー | 表示モード切替（localStorageに保存） | `src/components/photo/PhotoGrid.tsx`, `LedgerView.tsx` |
| ライトボックス | 写真の拡大表示・前後ナビ・削除 | `src/components/photo/PhotoLightbox.tsx` |
| フェーズ管理 | 施工前／施工中／施工後／未分類の4区分、フィルタタブ、件数表示 | `src/types/photo.ts` |
| 長押しアクションシート | フェーズ変更・半透明撮影の基準にする・複数選択開始・削除 | `src/components/photo/PhotoActionSheet.tsx` |
| 複数選択・一括操作 | 一括フェーズ変更／未分類へのクリア | `src/hooks/usePhotoSelection.ts`, `BatchActionBar.tsx` |
| 写真並べ替え | 台帳ビューの▲▼で隣接swap | `src/hooks/usePhotos.ts`（`swapPhotoOrder`） |
| コメント入力・自動保存 | 台帳ビューでフォーカスアウト時に保存 | `src/components/photo/LedgerRow.tsx` |
| コメントテンプレート | システム／カスタム／最近使った（最大10件） | `src/lib/commentTemplates.ts`, `src/store/templateStore.ts`, `TemplateDropdown.tsx` |
| 半透明撮影（施工前後オーバーレイ） | 基準写真を重ねて同じ画角で撮影 | `OverlayCaptureModal.tsx`, `OverlayCameraView.tsx`, `ReferencePhotoPicker.tsx` |
| Excel出力（3種の台帳）※開発ブランチ仕様 | 標準台帳／大写真台帳／施工前後比較。出力方式は標準モード／Excel直接作成モード（高互換）。詳細は5節 | `src/components/project/ExcelExportGroup.tsx`, `ExcelExportButton.tsx`, `src/lib/generateExcel.ts`, `generateOneColumnExcel.ts`, `generateBeforeAfterExcel.ts`, `generateGenbafotoJob.ts` |
| 写真の自動圧縮 | アップロード時に600px版を生成しExcel用に保存 | `src/utils/imageUtils.ts`, `src/lib/photoStorage.ts` |
| レスポンシブUI | スマホ:BottomNav / PC:Sidebar、ブレークポイント`lg`(1024px) | `AppLayout.tsx`, `Sidebar.tsx`, `BottomNav.tsx` |
| PWA | manifest.webmanifest・Service Worker・ホーム画面インストール | `public/manifest.webmanifest`, `public/sw.js`, `src/main.tsx` |
| サインアップエラーメッセージ | エラーコード別に原因を表示（2026-06-13追加） | `src/pages/auth/SignupPage.tsx` |

---

## 2. スマホでの操作フロー

```
プロジェクト一覧（ダッシュボード）
  ↓ プロジェクトをタップ
プロジェクト詳細
  ├─ 写真0枚 → 「写真を追加」ボタンのみ表示
  └─ 写真1枚以上 → 右下に縦並びFAB
       ├─ 📷 カメラで撮影（端末カメラ直接起動 → 即アップロード）
       ├─ 🖼️ ギャラリーから追加（PhotoUploadModal）
       └─ 🗂️ 写真を重ねて撮影（半透明オーバーレイ）
  ↓ 撮影直後
保存先フェーズ確認トースト（PhaseSaveToast）
  ↓ 写真を長押し
PhotoActionSheet
  ├─ フェーズを変更
  ├─ 半透明撮影の基準にする
  ├─ 複数選択を開始
  └─ 削除（確認ダイアログ）
  ↓ 複数選択中
画面下部にBatchActionBar（一括フェーズ変更／未分類化）
  ↓
上部フェーズタブで絞り込み、グリッド⇔台帳をアイコンで切替
  ↓
ヘッダーのExcel出力ボタン（標準台帳／大写真台帳／施工前後比較。5節参照）
```

---

## 3. 半透明撮影（施工前後オーバーレイ）機能の仕様

### 3.1 起動経路
- ヘッダー／FABの「写真を重ねて撮影」→ 基準写真選択画面（ReferencePhotoPicker）
- 写真の長押し→「半透明撮影の基準にする」→ 選択済みでカメラ画面に直接遷移

### 3.2 基準写真選択（`ReferencePhotoPicker.tsx`）
- フェーズタブ（全て/施工前/施工中/施工後/未分類）で絞り込み
- サムネイルをタップして基準写真を選択

### 3.3 撮影画面（`OverlayCameraView.tsx`）
| 操作 | 内容 |
|---|---|
| オーバーレイ表示 | 基準写真の原本（IndexedDB）をカメラ映像に半透明表示。原本がなければサムネイルにフォールバック |
| 表示/非表示トグル | Eye/EyeOffアイコン |
| 透明度スライダー | 0〜100%、`localStorage`（`genba-overlay-capture-opacity`）に保存し次回も復元 |
| 位置調整 | 1本指ドラッグで移動、2本指ピンチでズーム（0.3〜4倍）、＋/−ボタン、リセットボタン |
| 保存先フェーズ | 基準写真が「施工中」→デフォルト「施工中」、それ以外→デフォルト「施工後」。手動で変更可 |
| 撮影 | シャッターボタンで撮影→即`uploadPhotos`、連続撮影枚数を表示、「撮影完了」トースト |
| 終了操作 | 「基準写真を変更」（選択画面に戻る）／「完了」（モーダルを閉じる） |
| カメラエラー | 権限なし／デバイスなし／非対応の3パターンを判定し再試行ボタンを表示 |

---

## 4. 写真管理機能の仕様

### 4.1 データ構造（`src/types/photo.ts`）
```ts
interface Photo {
  id: string
  project_id: string
  user_id: string
  original_filename: string
  file_size: number
  width: number | null
  height: number | null
  taken_at: string | null   // EXIF or file.lastModified
  comment: string
  sort_order: number        // 1000刻み。並べ替えはswapのみ（フラクショナルインデックスは未実装）
  phase: 'before' | 'during' | 'after' | null
  thumbnail_data_url: string // base64 data URL
  created_at: string
  updated_at: string
}
```

### 4.2 保存先と端末間同期
**「すべてのデータがクラウドに保存される」わけではありません。** 写真原本は端末内のみです。実装は `src/lib/cloudSync.ts`、`src/hooks/useCloudSync.ts`、`src/hooks/usePhotos.ts` です（2026-10-12 時点のコードで確認）。

| データ | 保存先 | 別端末への同期 |
|---|---|---|
| プロジェクト | Supabase `projects`（削除は論理削除 `deleted_at`）＋ 端末の `localStorage`（zustand persist） | される |
| 写真メタ情報（コメント・階数・場所・フェーズ・並び順・フォルダ） | Supabase `photos` ＋ 端末の `localStorage` | される |
| **写真原本** | **端末の `IndexedDB` のみ**（key=`photo:{id}`） | **されない** |
| 圧縮画像（600px） | 端末の `IndexedDB`（key=`photo:{id}:c:600`）＋ Supabase Storage `photo-compressed`（`{userId}/{photoId}.jpg`） | される（別端末ではこの圧縮画像を使う） |
| 未分類フォルダ | Supabase `photo_folders` ＋ 端末の `localStorage` | される |
| Excel出力方式の設定 | 端末の `localStorage` のみ（`genba-excel-export-mode`） | されない |
| 認証情報 | Supabase Auth（未設定時は localStorage モック） | － |

**同期の動き**
- 同期は**リアルタイムではありません**。ログイン確定後に1回、クラウドの内容を取得して端末の状態へ反映し、クラウドに無い端末内のデータ（プロジェクト・写真・フォルダ、圧縮画像）をクラウドへ登録します。
- ログイン後の操作（追加・コメント・並び替え・フェーズ変更・削除）は、その都度クラウドへ反映を試みます。他端末の変更が自動で画面に現れる仕組みはなく、次回のログイン時の同期で取り込まれます。
- 別端末では、メタ情報と圧縮画像が表示・Excel・ZIP出力に使われます。**写真原本は別端末へ移りません。** 端末の交換・故障・ブラウザのデータ削除で、その端末の原本は失われます（外部バックアップは未実装。将来候補は `docs/feature-priority.md`）。
- 削除済みプロジェクトに紐づく端末内の写真は、端末内には残りますが同期対象から外れます。

**同期失敗・オフライン時**
- クラウドへの反映は失敗しても、多くは画面に表示されず（`console.error` のみ）、端末内のデータは残ります。反映が完了しない写真が生じることがあります。
- ログイン直後の同期が例外で失敗した場合は、次の機会に再試行されます。取得に失敗した場合は端末内の状態のままです。
- Supabase 未設定の環境では同期は行われません。
- **Excel直接作成モード（高互換）**は、クラウドに保存済み（`storage_path` あり）の写真だけを対象とします。同期が完了していない写真が含まれると、`create-genbafoto-job` が 409「同期が完了していない写真が含まれています」で全体を拒否します（5.5節）。標準モードは、端末の IndexedDB に無い写真だけ Storage の圧縮画像で補います。

### 4.3 フェーズ管理
- 4区分: `before`(施工前) / `during`(施工中) / `after`(施工後) / `null`(未分類)
- `PHASE_OPTIONS` / `PHASE_CONFIG`（`src/types/photo.ts`）で一覧・ラベル・配色を一元管理
- フィルタタブに各区分の件数を表示

### 4.4 一括操作・削除
- 複数選択（`usePhotoSelection`）→ `BatchActionBar`で一括フェーズ変更／未分類化
- 削除は1枚ずつ（ライトボックス or アクションシートから、`window.confirm`で確認）
- 削除時は原本・圧縮版のIndexedDBエントリとメタ情報を両方削除（`usePhotos.removePhoto`）

### 4.5 並べ替え
- 台帳ビューの▲▼で隣接する2枚の`sort_order`を交換（`swapPhotoOrder`）
- 表示中フィルタのインデックスで隣接判定するため、フィルタ中でも正しく動作

---

## 5. Excel出力の仕様

> **開発ブランチ仕様です（本番Web未反映）。** 以下は `feat/step6c-genbafoto-page-numbering`（HEAD `bcce8c4`）のソースコードで確認した内容です。本番公開済みの仕様ではありません。
> 旧仕様（フェーズ行あり・施工前後の撮影日行あり・ファイル名がブラウザ任せ等）は本ブランチで置き換わっています。

### 5.1 出力ボタンと出力方式
- プロジェクト詳細のヘッダーに `ExcelExportGroup` を表示する。構成は「Excel出力方式の設定（歯車）」＋ Excelボタン3つ（標準台帳／大写真台帳／施工前後比較）。ZIP出力ボタン（`ZipExportButton`）は従来どおり別に残る。
- 「施工前後比較」ボタンは、施工前・施工後の写真が両方あるときのみ表示する。
- ボタンのラベルは `sm` 未満（スマホ幅）ではアイコンのみ、PC幅ではラベル付き。
- 旧ボタン（ExportButton／LargePhotoExportButton／BeforeAfterExportButton／GenbafotoExportButton）は削除済み。

| 出力方式 | 内容 | 利用条件 |
|---|---|---|
| 標準モード（既定） | ブラウザ内で ExcelJS により .xlsx を生成してダウンロード | 全環境 |
| Excel直接作成モード（高互換） | .genbafoto ファイルを生成し、Windows の Excel Helper が Excel（COM）で .xlsx を作成 | **Windows のみ有効**（`isWindowsPlatform`）。Windows以外で保存値が direct でも標準モードとして扱う |

- 方式の保存先は `localStorage`（キー `genba-excel-export-mode`）。既定は `standard`（`src/lib/excelExportMode.ts`）。
- ブラウザからは Helper がインストールされているかを検出できない。Excel直接作成モードを選んだ場合、Helper が無い・古い環境の挙動はこのコードでは判定していない。
- Excel直接作成モードは「ログイン中」「写真がクラウド保存済み」が前提（5.5節）。

### 5.2 プラン別の出力制限（`src/lib/plan.ts`）
コードに存在するプランは `free`／`ads_removed`／`pro` の3つのみ。**法人プランはコードに存在しない**（`docs/feature-priority.md` 等の構想のみ）。

| プラン | Excelの出力範囲 | 現場保存数 | 広告 |
|---|---|---|---|
| free | 1回につき1ページ（ページ選択） | 3件まで | 表示 |
| ads_removed | 1回につき1ページ（ページ選択） | 3件まで | 非表示 |
| pro | 全ページ一括 | 無制限 | 非表示 |

- 総ページ数が1以下の場合は全ページ出力と同じ扱い。
- ページ選択UIは `useExcelPageExport`／`ExcelPageInfo`（`listPages`）が提供し、標準モード・Excel直接作成モードの両方で同じ選択を使う。

### 5.3 台帳レイアウト（標準モードの出力。ExcelJS）
共通：A4縦、`fitToWidth:1`・`fitToHeight:0`、余白 左右0.20in／上下0.25in、水平・垂直とも中央寄せ。**フェーズ（施工前／施工中／施工後）の行は出力しない**（標準・大写真ではシート名がフェーズ）。**未分類の写真は出力対象外**。写真は縦横比を維持し、枠内にアンカー（twoCellAnchor）で配置する。埋め込み失敗時は枠線のみ残して出力を継続する（5.7節）。

| 台帳 | レイアウト | 1ページ | 各枠の内容 |
|---|---|---|---|
| 標準台帳 | 2列×3段。列幅54。行高：番号18pt／写真187pt／コメント63pt | 6枚 | 番号・写真・コメント（9pt・左寄せ・上下中央・折り返し） |
| 大写真台帳 | 1列×3ブロック。1ブロック19行＝256.5pt（No.・階数・場所の各行 19.5pt、コメント16行は 12.75pt と 12pt を交互で合計198pt）。左に写真（A列・縦結合）、右に情報パネル（B〜D） | 3枚 | No.（12pt・太字・中央）、階数・場所（ラベル12pt太字、値12pt通常・中央）、コメント（12pt・左寄せ・上下中央・折り返し）。階数・場所の値は写真の `floor`／`location` があれば入る（なければ空欄） |
| 施工前後比較 | 列：A余白(2)／B施工前(54)／C施工後(54)／D余白(2)。1ページ10行＝見出し22pt＋3組×(18／187／63pt)。印刷範囲 A:D、見出しは毎ページ先頭 | 3組（6枚） | 左＝施工前、右＝施工後。番号行は「施工前 No.n」「施工後 No.n」。**撮影日時の行は出力しない**（旧仕様の日付行は廃止）。コメントは標準台帳と同寸法 |

- 標準台帳と施工前後比較は、写真枠・コメント欄の寸法を標準台帳の定数で共通化している。
- 標準／大写真はフェーズ別シート（施工前／施工中／施工後）に分割。
- 大写真台帳の1ページ（3ブロック）は 769.5pt で、改ページ位置（3枚ごと）と写真の枠（A列19行）の大きさは変わらない。コメント欄は約100文字が余裕をもって入る想定（折り返し表示のみで、文字数制限・自動縮小は無い。長文は欄の下で切れる場合がある）。
- 表紙シートは3種の台帳で共通で、用紙はA4縦に明示する（余白・列幅・フォント・結合は従来のまま）。
- 上記の大写真台帳の行高・フォントと表紙A4は、Web標準モードの仕様。**Windows Helper 1.1.0 のテンプレートは未更新**で、高互換出力の大写真台帳・表紙は変更前の見た目（No.等は9pt・各行13.5pt、表紙の用紙は未指定）のまま。
- 施工前後比較は `before`／`after` をそれぞれ `sort_order` 昇順に並べ、同じインデックス同士をペアにする（`during` は対象外）。枚数が異なる場合は少ない側を空欄にする。

### 5.4 ページ番号（連番）
| 出力 | 番号 |
|---|---|
| 全ページ出力 | 1〜n。標準／大写真は施工前→施工中→施工後を続けて連番。施工前後比較は「組の番号」（左右で同じ番号） |
| ページ選択出力（標準モード） | 選択したページの `startNo` から続けて採番する（例：標準台帳の2ページ目なら No.7 から） |
| ページ選択出力（Excel直接作成モード） | .genbafoto の `no` を `startNo + i` で設定し、任意項目 `page: { groupIndex, startNo, endNo }` を付ける |

- `groupIndex`：0＝施工前、1＝施工中、2＝施工後（施工前後比較は常に0）。
- `page` は**選択ページ出力のときだけ**付く（全ページ出力では付かない）。`schemaVersion` は 1 のまま。
- ページ情報と写真が食い違う場合は `invalid_page` で生成を中止する（`generateGenbafotoJob.ts`）。

### 5.5 Excel直接作成モード（.genbafoto と Helper）
1. ブラウザが `/api/create-genbafoto-job`（`api/create-genbafoto-job.ts`）を呼ぶ。Bearer 認証。ユーザー権限（RLS）で対象写真を取得し、**all-or-nothing**（1枚でも取得できなければ失敗）。
2. 各写真は `storage_path`（クラウド保存済み）が必須。サーバー側（service_role）が `photo-compressed` バケットの署名付きURLを発行する（有効期限 1800秒、100枚ずつ）。API は読み取り専用で、DB書き込み・Stripe処理は行わない。
3. 1ジョブの最大写真枚数は 300（`MAX_PHOTOS`）。
4. ブラウザは .genbafoto をダウンロードし、関連付けられた Windows Helper が署名付きURLから写真を取得して Excel（COM）で .xlsx を作成する。
5. 開発用の Vite サーバーは `api/` を提供しない（Vercel 環境が必要）。

**Helper との互換性（STEP 6-A／6-D／7／8 の記録に基づく。いずれも開発段階）**
- Helper 1.1.0：`no` を表示番号として読み（連番でない場合は位置から採番）、任意の `page` を読む。ページ選択出力では対象外フェーズのシートを削除する（標準／大写真）。Microsoft 365 での実機確認（選択ページ・全ページ）と、Excel 2019 での生成済み .xlsx の表示確認は済み。
- Helper 1.0.0：`page` を無視することを、ローカルで 1.0.0 のバイナリを使った試験で確認した。**実際に1.0.0をインストールした本番相当環境での確認は未実施**で、互換性を断定しない。1.0.0 のテンプレートは旧レイアウト（フェーズ行あり・施工前後の日付行あり）のため、高互換出力でも 1.0.0 と 1.1.0 でレイアウトが異なる。
- 未確認：本番Webからの E2E、実プラン（free／Pro）アカウントでの制限、実写真・署名URL期限切れ、他PCでの SmartScreen 等。

### 5.6 ファイル名（`src/lib/excelFileName.ts`）
| 台帳 | ファイル名 |
|---|---|
| 標準台帳 | `{工事名}_標準台帳.xlsx` |
| 大写真台帳 | `{工事名}_大判台帳.xlsx` |
| 施工前後比較 | `{工事名}_施工前後台帳.xlsx` |

- 工事名は前後の空白（全角含む）を除去し、制御文字と ` / : * ? " < > |` を `_` に置換。空なら「現場フォト」。100文字以内（サロゲートペアを壊さない）。
- 全ページ／選択ページで名前は変えない（ページ番号は付けない）。標準モード・Excel直接作成モードで共通。
- 同名ファイル：標準モードはブラウザの重複処理に従う。Excel直接作成モードは Helper が ` (1)`、` (2)` を付けて**上書きしない**。

### 5.7 画像埋め込み共通仕様（`embedImage` / `photoToJpegBase64`）
優先順位:
1. IndexedDBの600px圧縮版
2. 原本を600pxにリサイズ
3. `thumbnail_data_url`にフォールバック

埋め込み失敗時は枠線のみ残し、出力自体は継続する。

---

## 6. 認証エラーメッセージの仕様（2026-06-13追加）

`src/pages/auth/SignupPage.tsx` の `getSignupErrorMessage()` で、Supabaseのエラーコードに応じてメッセージを出し分ける。

| エラーコード | 表示メッセージ |
|---|---|
| `over_email_send_rate_limit` | 確認メール送信回数の上限に達しました。しばらく時間を空けて再度お試しください。 |
| `user_already_exists` / `email_exists` | このメールアドレスは既に登録されています。ログイン画面からログインしてください。 |
| `weak_password` | パスワードの強度が不十分です。別のパスワードをお試しください。 |
| `email_address_invalid` | このメールアドレスは登録できません。別のメールアドレスをお試しください。 |
| `signup_disabled` | 現在、新規登録を受け付けていません。 |
| `over_request_rate_limit` | リクエストが多すぎます。しばらく時間を空けて再度お試しください。 |
| `status`未設定（通信失敗） | 通信エラーが発生しました。ネットワーク接続を確認してもう一度お試しください。 |
| その他不明なエラー | アカウントの作成に失敗しました。もう一度お試しください。 |

複数行メッセージ対応のため`AlertDescription`に`whitespace-pre-line`を付与。

**注意**: `LoginPage.tsx`は未対応で、失敗時は常に「メールアドレスまたはパスワードが正しくありません」固定（→7節参照）。

---

## 7. 未実装機能

実装済み機能と比較して、現状「未対応・未着手」のもの。

| 項目 | 現状 |
|---|---|
| 複数選択での一括削除 | `BatchActionBar`はフェーズ変更・未分類化のみ。削除は1枚ずつ |
| LoginPageのエラーメッセージ改善 | 6節の改善はSignupPageのみ。LoginPageは原因に関わらず固定文言 |
| パスワードリセット | LoginPageに「パスワードを忘れた方 ›」の表示はあるが`<span>`のみでリンク・機能なし |
| 写真原本の外部バックアップ | 原本は端末の IndexedDB のみで、クラウド・他端末へは同期されない（4.2節）。外部バックアップは未実装・仕様未確定 |
| 同期失敗の通知 | 多くはコンソールログのみで画面に出ない（4.2節） |
| `/settings/templates`画面 | ルーティングはコメントアウト状態。カスタムテンプレートの追加・削除は`TemplateDropdown`内で完結しており、専用画面は未着手 |
| 報告書型Excelテンプレート | `docs/week8-candidates.md`の②。追加入力項目（部位・状況等）の設計が必要 |
| フラクショナルインデックスでの並べ替え | `docs/system-design.md`記載の中間値計算は未実装。現状は隣接swapのみ |
| HEIC非対応環境のフォールバック | 一部ブラウザでCanvas読み込み不可の場合の代替表示・案内文言なし |
| PWA本番動作の確認 | Service Worker登録は`import.meta.env.PROD`時のみ。`vite dev`では未登録（`pre-launch-checklist.md`参照） |

---

## 8. 今後の候補機能（優先順位順）

| 優先度 | 機能 | 理由・難易度 |
|---|---|---|
| 高 | 複数選択での一括削除 | `usePhotos.removePhoto`の並列呼び出しで実装可能。難易度低・写真枚数が多い現場で即効性高 |
| 高 | LoginPageのエラーメッセージ改善 | SignupPageと同パターン（`AuthError.code`分岐）を適用するだけ。実装コスト低 |
| 中 | パスワードリセット機能 | Supabaseの`resetPasswordForEmail`を使った実装が必要。UIの導線は用意済み |
| 中 | 報告書型Excelテンプレート | 需要はあるが「部位」「状況」等の入力項目設計が必要（データモデル変更を伴う） |
| 中 | 写真原本の外部バックアップ対応 | 未実装・仕様未確定。第一候補は端末の写真フォルダ保存＋Googleフォト、第二候補は Google Drive API（`docs/feature-priority.md`）。Helper 1.1.0 と Web 新レイアウトの正式リリース後に検討 |
| 低 | HEIC非対応環境向けの案内文言 | 表示できない場合に代替アイコン＋説明を出す程度の小改修 |
| 低〜中 | PDF出力 | `docs/feature-priority.md` P1。Excel不要な現場向けの提出書類完結 |
| 低 | 工事看板挿入 | Canvas APIで写真に工事名・日付を合成。差別化要素だが優先度は低 |
| 低 | Google Drive連携・複数ユーザー共有 | 法人プラン向けの構想（`docs/feature-priority.md` P2。**コードに法人プランは存在しない**）。データ同期基盤が前提 |

---

## 関連ドキュメント

- `docs/requirements.md` … 初期要件定義（一部は現状と差異あり）
- `docs/system-design.md` … 番号管理・Excel・レスポンシブ設計の方針
- `docs/week8-candidates.md` … Excel複数テンプレート・一括操作の検討メモ（①は本書7-8節で更新）
- `docs/feature-priority.md` … 収益観点での機能優先順位
- `docs/pre-launch-checklist.md` … 公開前の動作確認チェックリスト（Helper 1.1.0 ＋ Web 同時リリースの確認項目を含む）
