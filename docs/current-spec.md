# 現状仕様書（開発者向け）

最終更新: 2026-06-13

このドキュメントは genba-photo-app の **現在実際に動作している仕様** をまとめたものです。

`docs/requirements.md` ・ `docs/system-design.md` は実装前の設計書であり、
Supabaseへのデータ保存（projects/photos テーブル）や `/settings/templates` 画面など、
**実装と異なる部分（未着手のまま設計のみ残っている部分）が多く存在します。**

「今のアプリが何をできるか」を確認・説明する際は、本ドキュメントを正として参照してください。

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
| Excel出力（通常） | 表紙＋フェーズ別シート、A4印刷最適化 | `src/lib/generateExcel.ts` |
| Excel出力（施工前後） | 表紙＋施工前後ペアシート | `src/lib/generateBeforeAfterExcel.ts` |
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
ヘッダーのExcel出力ボタン（通常／施工前後）
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

### 4.2 保存先（重要：端末ローカルのみ）
| データ | 保存先 | 備考 |
|---|---|---|
| プロジェクト・写真メタ情報・コメント | `localStorage`（zustand persist） | `src/store/photoStore.ts`, `projectStore.ts` |
| 写真原本 | `IndexedDB`（idb-keyval, key=`photo:{id}`） | `src/lib/photoStorage.ts` |
| Excel出力用600px圧縮版 | `IndexedDB`（key=`photo:{id}:c:600`） | アップロード時に生成 |
| 認証情報のみ | Supabase（クラウド） | `isSupabaseConfigured`時のみ実通信、未設定時はlocalStorageモック |

→ **写真・プロジェクト・コメントは端末間で同期されない**（1台＝1データ）。詳細は`docs/pre-launch-checklist.md`参照。

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

### 5.1 通常出力（`generateExcel.ts`）
- 表紙シート: 工事名・現場・出力日・写真枚数
- フェーズ別シート（施工前／施工中／施工後）を分割。**未分類は出力対象外**
- A4印刷最適化: 2列×3段＝1ページ6枚、余白0.20〜0.25インチ、`fitToWidth:1`
- 各セル: 番号（シートをまたいで連番）・画像（アスペクト比維持・中央寄せ）・フェーズ・コメント

### 5.2 施工前後出力（`generateBeforeAfterExcel.ts`）
- 表紙シート（タイトル「施工前後写真台帳」）
- `before`/`after`をそれぞれ`sort_order`昇順に並べ、同インデックス同士をペアリング（`during`は対象外）
- 列ヘッダー（施工前=青系／施工後=緑系）、各ペアに番号・画像・フェーズ・撮影日・コメント
- 枚数が異なる場合は少ない側を空欄表示

### 5.3 画像埋め込み共通仕様（`embedImage` / `photoToJpegBase64`）
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
| デバイス間データ同期 | 写真・プロジェクト・コメントはlocalStorage/IndexedDBのみ。Supabaseには未保存（要件定義8.1とのギャップ） |
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
| 中 | デバイス間データ同期の方針決定・案内 | Supabaseへの移行は大規模。まずは「1台＝1データ」である旨をユーザーに案内する文言整備から |
| 低 | HEIC非対応環境向けの案内文言 | 表示できない場合に代替アイコン＋説明を出す程度の小改修 |
| 低〜中 | PDF出力 | `docs/feature-priority.md` P1。Excel不要な現場向けの提出書類完結 |
| 低 | 工事看板挿入 | Canvas APIで写真に工事名・日付を合成。差別化要素だが優先度は低 |
| 低 | Google Drive連携・複数ユーザー共有 | 法人プラン向け（`docs/feature-priority.md` P2）。データ同期基盤が前提 |

---

## 関連ドキュメント

- `docs/requirements.md` … 初期要件定義（一部は現状と差異あり）
- `docs/system-design.md` … 番号管理・Excel・レスポンシブ設計の方針
- `docs/week8-candidates.md` … Excel複数テンプレート・一括操作の検討メモ（①は本書7-8節で更新）
- `docs/feature-priority.md` … 収益観点での機能優先順位
- `docs/pre-launch-checklist.md` … 公開前の動作確認チェックリスト
