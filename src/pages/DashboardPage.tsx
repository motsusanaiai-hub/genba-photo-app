import { Link, useNavigate } from 'react-router-dom'
import { FolderOpen, Plus } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { ProjectCard } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/Header'
import { AdSlot } from '@/components/common/AdSlot'
import { ManageSubscriptionCard } from '@/components/billing/ManageSubscriptionCard'

export function DashboardPage() {
  const navigate = useNavigate()
  const { projects, removeProject } = useProjects()

  const handleDelete = async (projectId: string, projectName: string) => {
    const confirmed = window.confirm(
      `「${projectName}」を削除しますか？\n\nこの操作は取り消せません。`,
    )
    if (confirmed) await removeProject(projectId)
  }

  // 新規作成の入口（ヘッダーボタン・FAB共通）。工事案件数の上限はない。
  const handleNewProjectClick = () => {
    navigate('/projects/new')
  }

  return (
    <>
      <Header
        title="現場フォト"
        right={
          <Button size="sm" className="hidden lg:flex" onClick={handleNewProjectClick}>
            <Plus className="h-4 w-4" />
            新規作成
          </Button>
        }
      />

      <div className="p-4 lg:p-6">
        {projects.length === 0 ? (
          <EmptyState onAction={() => navigate('/projects/new')} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/projects/${project.id}`)}
                onEdit={() => navigate(`/projects/${project.id}/edit`)}
                onDelete={() => handleDelete(project.id, project.name)}
              />
            ))}
          </div>
        )}

        {/* 既存の月額契約者だけに出る契約管理（Stripe Customer Portal）。契約が残っていない人には何もrenderしない。
            新規購入・アップグレードの導線は置かない。 */}
        <ManageSubscriptionCard className="mt-6" />

        {/* 広告枠（free限定の自社広告。広告削除の購入者・Pro契約者ではAdSlot自体が何もrenderしない）。
            広告の表示場所はダッシュボードのみ。 */}
        <AdSlot className="mt-6" />

        {/* 写真の保存についての短い説明と、規約へのリンク。モバイルFAB（bottom-20〜136px帯）と重ならないよう下に余白を確保する。 */}
        <footer className="mx-auto mb-24 mt-6 w-full max-w-2xl space-y-2 text-xs text-muted-foreground lg:mb-6">
          <details>
            <summary className="cursor-pointer select-none py-1">写真の保存について</summary>
            <div className="space-y-1 pb-1 pt-1 leading-relaxed">
              <p>元の写真は、この端末のブラウザ内にだけ保存されます。大切な写真は、別の場所にも保存してください。</p>
              <p>
                小さくした写真（圧縮画像）は、クラウドに保存されます。現在は公開URL方式のため、URLを知っている人は、
                ログインしなくても見ることができます。URLを共有しないでください。
              </p>
              <p>
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                  くわしくはプライバシーポリシー
                </Link>
              </p>
            </div>
          </details>
          <nav className="flex gap-4" aria-label="規約">
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
              利用規約
            </Link>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
              プライバシーポリシー
            </Link>
          </nav>
        </footer>
      </div>

      {/* スマホ用 FAB */}
      <button
        onClick={handleNewProjectClick}
        className="lg:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="工事を登録する"
      >
        <Plus className="h-6 w-6" />
      </button>
    </>
  )
}

function EmptyState({ onAction }: { onAction: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
      <div className="rounded-full bg-muted p-6">
        <FolderOpen className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">工事がまだ登録されていません</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          最初の工事プロジェクトを登録して、写真と台帳を管理しましょう
        </p>
      </div>
      <Button onClick={onAction}>
        <Plus className="h-4 w-4" />
        工事を登録する
      </Button>
    </div>
  )
}
