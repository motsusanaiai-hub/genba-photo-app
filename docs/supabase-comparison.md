# Supabase あり vs なし 構成比較

対象アプリ: 工事写真管理アプリ（現場フォト）
比較日: 2026-05-31

---

## 前提：「Supabaseなし」の代替構成

Supabaseを使わない場合、以下を組み合わせて構築する。

| 役割 | 採用候補 |
|---|---|
| 認証 | Firebase Authentication |
| データベース | Firebase Firestore または PlanetScale（MySQL） |
| ストレージ | Firebase Storage または Cloudinary |
| APIサーバー | Node.js（Hono / Express）+ Vercel / Railway |
| ORM | Prisma（PlanetScale構成時） |

---

## 1. メリット

### Supabase あり

- **認証・DB・ストレージが1サービスで完結**し、サービス間の接続設定が不要
- **Row Level Security（RLS）** により、DBレベルでユーザーごとのアクセス制御を宣言的に記述できる
- **自動生成されるTypeScript型**（`supabase gen types`）でDB型とフロントが常に同期される
- **Supabase Studio**（管理画面）でデータをGUIで確認・編集できる
- **リアルタイムサブスクリプション**が標準装備（将来のチーム機能に有利）
- **Edge Functions**（Deno）でサーバーサイド処理を後から追加できる
- PostgreSQLなので複雑なSQLクエリ・JOINが使える
- **無料枠が大きく**、スモールスタートのコストがほぼゼロ

### Supabase なし

- **特定サービスへの依存がない**ため、ベンダーリスクをゼロにできる
- APIサーバーを自前で持つため、**ビジネスロジックの実装に制約がない**
- Firebase構成にすれば**モバイルSDK（iOS/Android）との相性が非常に良い**
- Cloudinaryを使えば**写真変換・リサイズ・フィルター処理をSaaS側に委譲**できる
- 各コンポーネントを独立してスケール・交換できる
- Google Cloud / AWS との統合が深いサービスを選べる

---

## 2. デメリット

### Supabase あり

- **RLSのデバッグが難しい**。ポリシーの設定ミスは「データが見えない」という形で現れ、原因特定に時間がかかる
- **Edge Functions（Deno）はNode.jsと互換性が完全ではなく**、一部npmライブラリが使えない
- **ストレージの変換機能が弱い**（画像リサイズ等はクライアントまたは別サービスが必要）
- Supabaseのサービス障害時にDBもストレージも認証もまとめて止まる（単一障害点）
- 無料プランはプロジェクトが**7日間非アクティブで一時停止**される
- **大量の画像を扱う場合のストレージ転送コスト**が予想より高くなる場合がある
- 独自ドメインのメール送信は設定が必要（Sendgrid等との連携）

### Supabase なし

- **認証・DB・ストレージを別々にセットアップする手間**がかかり、初期構築に時間がかかる
- APIサーバーの**デプロイ・監視・スケーリングを自前で管理**する必要がある
- **セキュリティ実装が分散**する（APIサーバー側の実装漏れがそのまま脆弱性になる）
- Firebase Firestoreは**NoSQLのためJOINができず**、複雑なクエリが難しい
- PlanetScale＋Prisma構成はFirebaseより設定が複雑
- TypeScriptの型管理を自前で行う必要がある
- Firestore の**データ構造設計ミスが後から修正しにくい**

---

## 3. 開発工数

### Supabase あり

| フェーズ | 工数 |
|---|---|
| 初期環境構築 | 1〜2日（プロジェクト作成・RLS設定・型生成） |
| 認証実装 | 1〜2日（メール認証・セッション管理） |
| DB設計〜CRUD実装 | 5〜7日 |
| ストレージ（写真アップロード） | 2〜3日 |
| **Phase 1 MVP 合計** | **約8週間** |

### Supabase なし（Firebase + Vercel構成）

| フェーズ | 工数 |
|---|---|
| 初期環境構築 | 3〜5日（Firebase設定・APIサーバー雛形・デプロイ設定） |
| 認証実装 | 2〜3日（Firebase Auth + APIサーバー連携） |
| DB設計〜CRUD実装 | 7〜10日（Firestore設計 or PlanetScale+Prisma） |
| ストレージ（写真アップロード） | 3〜4日（署名付きURL生成・バケット設定） |
| **Phase 1 MVP 合計** | **約12〜14週間** |

**差分：Supabase採用で約1ヶ月の短縮が見込める。**

---

## 4. 月額コスト

### Supabase あり

| 規模 | プラン | 費用 | 含まれるもの |
|---|---|---|---|
| MVP期（〜100ユーザー） | Free | $0 | DB 500MB・Storage 1GB・50,000 MAU |
| 成長期（〜1,000ユーザー） | Pro | $25/月 | DB 8GB・Storage 100GB・100,000 MAU |
| 拡大期（〜10,000ユーザー） | Pro + 従量課金 | $25〜$100/月 | Storage追加$0.021/GB |

写真1枚をWebP圧縮（平均500KB）と仮定した場合のStorage試算：
- Free枠（1GB） → 約2,000枚
- Pro枠（100GB） → 約200,000枚

### Supabase なし（Firebase + Vercel構成）

| 役割 | サービス | 費用 |
|---|---|---|
| 認証 | Firebase Auth | 無料（50,000 MAU） |
| データベース | Firestore | 無料枠超過後 $0.06/10万読み取り |
| ストレージ | Firebase Storage | 5GB無料・超過後 $0.026/GB |
| APIサーバー | Vercel Pro | $20/月 |
| **合計（MVP期）** | | **$20〜$30/月** |
| **合計（成長期）** | | **$50〜$150/月**（アクセス量次第） |

**Supabase Freeは無料でスタートできるが、Supabaseなし構成はAPIサーバー分が固定費になる。**
**成長期以降はFirestoreの読み取り課金が積み上がりやすく、Supabaseより高くなるケースがある。**

---

## 5. 運用コスト

### Supabase あり

| 項目 | 内容 |
|---|---|
| インフラ管理 | 不要（Supabaseがフルマネージド） |
| DBバックアップ | Proプランで自動（日次） |
| セキュリティ更新 | Supabase側で自動適用 |
| 監視・アラート | Supabase Dashboardで基本的な監視が可能 |
| スケーリング | Proプラン以上で自動スケール |
| **運用負荷** | **低い** |

### Supabase なし

| 項目 | 内容 |
|---|---|
| インフラ管理 | APIサーバーのデプロイ・ヘルスチェックが必要 |
| DBバックアップ | 自前で設定（PlanetScale は自動対応） |
| セキュリティ更新 | Node.js・依存パッケージの定期更新が必要 |
| 監視・アラート | Vercel Analytics + 別途監視ツール（Sentry等）が必要 |
| スケーリング | Vercelは自動・Firestoreは自動・APIサーバーは要確認 |
| **運用負荷** | **中〜高い** |

---

## 6. 将来の拡張性

### Supabase あり

| 拡張機能 | 対応しやすさ | 補足 |
|---|---|---|
| チーム・複数ユーザー共有 | ◎ | RLSのポリシー追加で対応 |
| リアルタイム通知 | ◎ | Supabase Realtimeが標準装備 |
| スマホアプリ（PWA） | ◯ | Supabase JSクライアントをそのまま利用 |
| スマホアプリ（ネイティブ） | △ | Supabase Swift/Kotlin SDKあり、ただし成熟度はFirebaseより低い |
| 大規模ユーザー対応 | △ | 数万〜数十万規模はEnterprise対応が必要 |
| 独自サーバー移行 | △ | PostgreSQLデータの移行は可能だが認証移行が煩雑 |

### Supabase なし

| 拡張機能 | 対応しやすさ | 補足 |
|---|---|---|
| チーム・複数ユーザー共有 | ◯ | APIサーバーで柔軟に実装できる |
| リアルタイム通知 | △ | WebSocket等を別途実装が必要 |
| スマホアプリ（PWA） | ◯ | APIを変えなければ対応可能 |
| スマホアプリ（ネイティブ） | ◎ | Firebase SDKがiOS/Androidで非常に成熟している |
| 大規模ユーザー対応 | ◎ | APIサーバーを水平スケール可能 |
| 独自サーバー移行 | ◎ | 最初から自前なので移行コスト不要 |

---

## 7. Google Drive連携との相性

Google Drive連携はOAuth 2.0でユーザーのGoogleアカウントと接続し、写真をDriveに保存する機能。

### Supabase あり

| 項目 | 内容 |
|---|---|
| OAuth実装箇所 | Supabase Auth の Social Login（Google Provider）と連携可能 |
| アクセストークン管理 | Supabase AuthのセッションにGoogle OAuthトークンを保持できる |
| Drive APIの呼び出し | クライアントサイドまたはEdge Functionから呼び出す |
| 注意点 | Drive APIのスコープ（`drive.file`）を追加するには設定が必要 |
| 相性 | **良好**。ただしEdge Function（Deno）からのHTTPSリクエストで実装する形になる |

### Supabase なし

| 項目 | 内容 |
|---|---|
| OAuth実装箇所 | APIサーバー（Node.js）でGoogleOAuth2フローを完全制御できる |
| アクセストークン管理 | Node.jsのgoogle-auth-libraryで管理。DBにリフレッシュトークンを保存 |
| Drive APIの呼び出し | googleapis npmパッケージがNode.jsで完全動作する |
| 注意点 | なし（Node.js環境はGoogle公式SDKと完全互換） |
| 相性 | **非常に良好**。GoogleのNode.js SDKをそのまま利用できる |

**Google Drive連携についてはSupabaseなし（Node.js APIサーバー）のほうが実装しやすい。**
Supabase Edge FunctionはDenoのため、Node.js向けのgoogleapis SDKが使えず、代わりにFetch APIで直接REST呼び出しが必要になる点が手間。

---

## 8. MVP開発への適性

### Supabase あり

| 観点 | 評価 | 理由 |
|---|---|---|
| セットアップの速さ | ◎ | ダッシュボードから即座に使い始められる |
| 認証の手軽さ | ◎ | メール認証が数行で実装できる |
| セキュリティ | ◎ | RLSで「他人のデータが見える」バグを構造的に防げる |
| 学習コスト | ◯ | RLSの概念に慣れる必要があるが、ドキュメントが充実 |
| ピボットへの対応 | ◯ | DBスキーマはマイグレーションで変更可能 |
| **総合評価** | **◎ MVP向き** | |

### Supabase なし

| 観点 | 評価 | 理由 |
|---|---|---|
| セットアップの速さ | △ | 複数サービスの設定に数日かかる |
| 認証の手軽さ | ◯ | Firebase Authは比較的簡単だが、APIサーバー連携が必要 |
| セキュリティ | △ | APIサーバー側の実装次第でセキュリティの質が変わる |
| 学習コスト | ◯ | Node.js APIサーバーに慣れていれば問題なし |
| ピボットへの対応 | ◎ | 各コンポーネントを独立して変更できる |
| **総合評価** | **△ MVPには過剰** | |

---

## 総合比較表

| 比較項目 | Supabase あり | Supabase なし |
|---|---|---|
| メリット | 開発速度・一体設計・型安全 | 柔軟性・ベンダー非依存 |
| デメリット | RLSの難しさ・単一障害点 | 構築コスト・運用負荷 |
| 開発工数 | **約8週間** | **約12〜14週間** |
| 月額コスト（MVP期） | **$0**（Free枠） | **$20〜$30**（Vercel固定費） |
| 月額コスト（成長期） | $25〜$100 | $50〜$150 |
| 運用コスト | **低い** | 中〜高い |
| 将来の拡張性 | 中（ネイティブアプリは△） | 高い |
| Google Drive連携 | 良好（制約あり） | **非常に良好** |
| MVP開発への適性 | **◎** | △ |

---

## 推奨構成

### MVP時点

**推奨: Supabase あり**

```
フロントエンド: React + TypeScript + Vite
バックエンド:   Supabase（Auth + PostgreSQL + Storage）
ホスティング:  Vercel（フロントのみ）
```

**理由**
- 市場検証が最優先。1ヶ月の短縮は大きなアドバンテージ
- 職人・一人親方にとっての「他人の写真が見える」バグは致命的。RLSで構造的に防げる
- Free枠でコストゼロのままPMF検証できる
- Google Drive連携はこの時点では未実装なので、Denoの制約は問題にならない

---

### 有料版リリース時点

**推奨: Supabase あり + Edge Functions追加**

```
フロントエンド: React + TypeScript + Vite（PWA化）
バックエンド:   Supabase Pro（Auth + PostgreSQL + Storage）
サーバー処理:  Supabase Edge Functions（Excel生成・PDF生成・Google Drive連携）
決済:          Stripe
ホスティング:  Vercel
```

**理由**
- Supabaseの運用実績が積まれており、移行コストをかける必要がない
- Excel出力はクライアントサイド（exceljs）で動作するため、Edge Functionは不要
- Google Drive連携はEdge FunctionでREST API直接呼び出しで対応（googleapis SDKなしでも実装できる）
- Pro（$25/月）で商用運用に必要な機能がすべて揃う

---

### 法人版リリース時点

**推奨: Supabase Enterprise + 専用APIサーバー（ハイブリッド構成）**

```
フロントエンド: React + TypeScript + Vite（PWA）
                + React Native（ネイティブアプリ）
バックエンド:   Supabase Enterprise（Auth + PostgreSQL + Storage）
APIサーバー:   Node.js + Hono（複雑なビジネスロジック・Google Drive連携）
ホスティング:  Vercel + Railway（APIサーバー）
モニタリング:  Sentry + Datadog
```

**理由**
- チーム機能・組織管理・権限制御など、複雑なビジネスロジックはAPIサーバーで実装する
- Google Drive連携（法人のShared Drive対応）はgoogleapis Node.js SDKで実装
- ネイティブアプリ化に備え、Firebase AuthへのID連携またはSupabase Auth継続を選択する
- Supabase EnterpriseはSLAと専用サポートがあり、法人契約に耐えられる
- この時点でDBとストレージをSupabaseに残しながら、ビジネスロジックをAPIサーバーに移すことで段階的移行が可能

**移行のトリガー（以下のいずれかに該当したら法人版構成への移行を検討）**
- 月間アクティブユーザーが10,000人を超えた
- 企業からSLA・セキュリティ要件の提示があった
- Google Drive連携のEdge Function実装が限界に達した
- ネイティブスマホアプリの開発が決定した
