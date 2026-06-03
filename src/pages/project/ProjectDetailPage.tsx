import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Pencil, Camera } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject } = useProjects()

  const project = getProject(projectId ?? '')
  if (!project) return <Navigate to="/" replace />

  return (
    <>
      <Header
        title={project.name}
        left={
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        right={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/projects/${project.id}/edit`)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />

      {/* Week 3 で写真グリッド・台帳ビューを実装 */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4 p-4">
        <div className="rounded-full bg-muted p-6">
          <Camera className="h-10 w-10 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">写真管理は Week 3 で実装予定</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            グリッドビュー・台帳ビュー・コメント入力・フェーズ設定などを追加します
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate(`/projects/${project.id}/edit`)}>
          プロジェクトを編集
        </Button>
      </div>
    </>
  )
}
