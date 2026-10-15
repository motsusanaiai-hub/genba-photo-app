import { Link } from 'react-router-dom'
import { LegalLayout, LegalPending, LegalSection, LegalSummary } from '@/components/legal/LegalLayout'
import { LEGAL } from '@/lib/legalInfo'

/**
 * プライバシーポリシー（/privacy）。ログイン不要の公開ページ。
 * 現在の実装に合わせた説明のみを書く（将来の仕様は先取りしない）：
 *   元画像＝端末のIndexedDB / 圧縮画像（600px程度のJPEG）＝Supabase Storageの公開バケット（公開URLで取得）
 *   工事案件の削除＝クラウド上は論理削除・端末内の写真は残る / ログアウトでは端末内のデータは消えない
 *   アカウント削除機能は未実装 / 外部サービス＝Supabase・Vercel・Stripe（過去の決済用。新規販売は停止中）
 *   広告配信サービス・アクセス解析サービスは使っていない（自社広告へのリンクのみ）
 * 未確定の項目は LegalPending で明示してあり、運営者が確定してから差し替える（src/lib/legalInfo.ts 参照）。
 */
export function PrivacyPage() {
  return (
    <LegalLayout title="プライバシーポリシー">
      <p className="mt-2 text-xs text-muted-foreground">
        制定日・施行日：<LegalPending item="enactedAt" />
      </p>

      <p className="mt-4">
        {LEGAL.operatorName}（以下「当社」）は、「{LEGAL.serviceName}」（以下「本サービス」）でお預かりする情報を、
        次のとおり取り扱います。<Link to="/terms" className="underline">利用規約</Link>とあわせてご覧ください。
      </p>

      <LegalSummary>
        <p className="font-medium">写真の保存について（要点）</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>元の写真</strong>は、お使いの端末のブラウザ内にだけ保存されます。当社のサーバーには送られません。</li>
          <li><strong>小さくした写真（圧縮画像）</strong>は、クラウドに保存されます。</li>
          <li>
            クラウドの圧縮画像は、現在<strong>公開URL</strong>で取得する方式です。
            <strong>URL を知っている人は、ログインしなくても、その圧縮画像を見ることができます。</strong>
            URL を他の人に共有しないでください。
          </li>
        </ul>
      </LegalSummary>

      <LegalSection id="info" title="1. 取得する情報">
        <ul>
          <li>
            <strong>アカウント情報</strong>：表示名、メールアドレス、パスワード。パスワードは認証サービス（Supabase）が管理し、
            当社は、パスワードそのものを保存しません。
          </li>
          <li>
            <strong>工事案件の情報</strong>：工事名、場所、開始日・終了日など、利用者が入力した内容。
          </li>
          <li>
            <strong>写真に付随する情報</strong>：コメント、階数、場所、撮影日時、元のファイル名、写真の大きさ（容量・縦横）、
            並び順、施工前・施工中・施工後の分類。撮影日時は、写真に記録された撮影日時から読み取ります（読み取れない場合は、
            ファイルの更新日時を使います）。
          </li>
          <li>
            <strong>圧縮画像</strong>：写真を 600px 程度の JPEG に小さくしたもの。写真に写っている内容を含みます。
            小さくする際に作り直すため、元の写真に含まれる位置情報などの付加情報は、圧縮画像には引き継がれません。
          </li>
          <li>
            <strong>通信の記録</strong>：本サービスの配信や障害対応のため、アクセスの日時やIPアドレスなどの記録が、
            サーバーの運用上、残ることがあります。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="purpose" title="2. 利用目的">
        <ol>
          <li>本サービスの提供、運営、本人確認のため。</li>
          <li>写真の整理と、Excel 台帳の作成のため。</li>
          <li>端末間で、工事案件や写真の情報を同期するため。</li>
          <li>障害への対応、不正な利用の防止のため。</li>
          <li>お問い合わせへの対応のため。</li>
          <li>本サービスに関する重要なお知らせのため。</li>
        </ol>
      </LegalSection>

      <LegalSection id="storage" title="3. 写真データの保存方法">
        <ul>
          <li>
            <strong>元の写真（原本）</strong>：お使いの端末のブラウザ内（IndexedDB）にだけ保存されます。
            ブラウザのデータ削除、端末の故障・紛失・買い替えなどで失われることがあります。端末を変えても、
            原本は自動では引き継がれません。重要な写真は、ご自身でバックアップしてください。
          </li>
          <li>
            <strong>圧縮画像</strong>：クラウド（Supabase のストレージ）に保存され、台帳の作成や、端末間の同期に使われます。
            クラウドに保存されるのは圧縮画像のみで、原本を復元することはできません。
          </li>
          <li>
            <strong>公開URLについて</strong>：現在、クラウドの圧縮画像は、公開URLで取得する方式です。
            URL には推測されにくいランダムな文字列が含まれていますが、
            <strong>URL を知っている第三者は、ログインしなくても、その圧縮画像を取得できる可能性があります</strong>。
            URL を SNS などで共有しないようご注意ください。工事案件や写真の一覧は、ログインした本人の画面にだけ表示されます。
            この方式は、今後見直す場合があり、その際は、このポリシーでお知らせします。
          </li>
          <li>
            <strong>Excel 直接作成（Windows 専用ヘルパー）</strong>：ご利用のパソコンで、一時的な URL（約 30 分で無効になります）を書いた
            ファイルを使って、圧縮画像を取得し、Excel 台帳を作成します。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="device" title="4. 端末内に保存される情報">
        <p>
          本サービスは、お使いの端末のブラウザ内に、ログイン状態、写真と工事案件の情報、表示の設定、元の写真を保存します。
          ブラウザのデータを消去すると、これらは失われます。
        </p>
      </LegalSection>

      <LegalSection id="external" title="5. 外部サービスの利用">
        <p>本サービスは、次の外部サービスを利用しています。</p>
        <ul>
          <li><strong>Supabase</strong>：ログイン（認証）、工事案件・写真情報のデータベース、圧縮画像の保存。</li>
          <li><strong>Vercel</strong>：本サービスの配信と、サーバー側の処理。</li>
          <li>
            <strong>Stripe</strong>：以前に提供していた有料プランの決済処理。現在は、有料プランの新規販売を行っていません。
            カード番号などの決済情報は、当社では保持しません。
          </li>
        </ul>
        <p>
          画面に表示する広告は、当社のサービス（ACE-DX）の広告です。広告配信サービスやアクセス解析サービスは、現時点では
          使っていません。広告のリンクを開くと、リンク先のサイトに情報が送られます。
          外部の広告やアクセス解析を導入する場合は、このポリシーを更新してお知らせします。
        </p>
      </LegalSection>

      <LegalSection id="thirdparty" title="6. 第三者への提供">
        <p>
          法令に基づく場合を除き、ご本人の同意なく、個人情報を第三者に提供しません。上記の外部サービスには、
          本サービスの提供に必要な範囲で、情報の取り扱いを任せています。
        </p>
      </LegalSection>

      <LegalSection id="security" title="7. 安全管理">
        <ul>
          <li>通信は暗号化（HTTPS）されます。</li>
          <li>データベースには、本人のデータだけを扱えるアクセス制御を設けています。</li>
          <li>
            ただし、現在の圧縮画像は公開URL方式のため、URL が第三者に知られた場合は、第3項のとおり、圧縮画像を取得される可能性があります。
          </li>
          <li>インターネット上での取り扱いに、完全な安全を保証することはできません。</li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title="8. データの保存と削除">
        <ul>
          <li>
            <strong>保存期間</strong>：現在、クラウドのデータを自動で削除する仕組みはありません。今後、保存期間や容量の制限を
            導入する場合は、事前に本サービス上でお知らせします。
          </li>
          <li>
            <strong>写真の削除</strong>：端末内の原本と圧縮画像、クラウドの圧縮画像、クラウドの写真情報が削除されます。
          </li>
          <li>
            <strong>工事案件の削除</strong>：クラウドの写真情報と圧縮画像が削除され、クラウド上の工事案件は「削除済み」として
            扱われます。工事名などの情報は、削除済みの記録としてクラウドに残ります。
            <strong>この端末内の写真（原本・圧縮画像）は削除されず、そのまま残ります。</strong>
          </li>
          <li>通信の状況などにより、クラウド側の削除が完了しない場合があります。</li>
          <li>
            <strong>ログアウト</strong>：ログイン状態は解除されますが、端末内の原本や、写真・工事案件の情報は消えません。
            共用の端末では、ご注意ください。
          </li>
          <li>
            <strong>アカウントの削除（退会）</strong>：<strong>現在、アプリ内に機能がありません。</strong>
            受付方法：<LegalPending item="withdrawal" />
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="requests" title="9. 開示・訂正・削除などのご請求">
        <p>
          ご自身の情報の開示、訂正、削除などをご希望の場合は、下記のお問い合わせ先へご連絡ください。
        </p>
      </LegalSection>

      <LegalSection id="contact" title="10. 事業者の情報とお問い合わせ">
        <ul>
          <li>事業者：{LEGAL.operatorName}</li>
          <li>
            所在地・代表者名：<LegalPending item="operatorAddress" />
          </li>
          <li>
            お問い合わせ先：<LegalPending item="contact" />
          </li>
          <li>
            運営者の Web サイト：
            <a href={LEGAL.operatorSiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {LEGAL.operatorSiteUrl}
            </a>
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="changes" title="11. ポリシーの変更">
        <p>
          必要に応じて、このポリシーを変更することがあります。変更するときは、変更後の内容と施行日を、本サービス上でお知らせします。
          重要な変更は、事前にわかりやすい方法でお知らせします。
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
