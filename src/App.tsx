import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useAuth } from '@/hooks/useAuth'

export default function App() {
  const { initialize } = useAuth()

  useEffect(() => {
    initialize()
  }, [initialize])

  return <RouterProvider router={router} />
}
