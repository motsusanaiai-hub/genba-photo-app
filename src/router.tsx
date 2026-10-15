import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ProjectNewPage } from '@/pages/project/ProjectNewPage'
import { ProjectDetailPage } from '@/pages/project/ProjectDetailPage'
import { ProjectEditPage } from '@/pages/project/ProjectEditPage'
import { CheckoutSuccessPage } from '@/pages/billing/CheckoutSuccessPage'
import { ProCheckoutSuccessPage } from '@/pages/billing/ProCheckoutSuccessPage'
import { TermsPage } from '@/pages/legal/TermsPage'
import { PrivacyPage } from '@/pages/legal/PrivacyPage'

export const router = createBrowserRouter([
  // 利用規約・プライバシーポリシー：ログイン不要の公開ページ（AuthGuard の外）。直接URLでも開ける。
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
    ],
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects/new', element: <ProjectNewPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'projects/:projectId/edit', element: <ProjectEditPage /> },
      { path: 'billing/success', element: <CheckoutSuccessPage /> },
      { path: 'billing/pro/success', element: <ProCheckoutSuccessPage /> },
      // Week 5: /settings/templates
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
