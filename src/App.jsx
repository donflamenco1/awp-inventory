import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Count from './pages/Count'
import Items from './pages/Items'
import Orders from './pages/Orders'
import History from './pages/History'
import Labels from './pages/Labels'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/count" element={<Count />} />
            <Route path="/items" element={<Items />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/history" element={<History />} />
            <Route path="/labels" element={<Labels />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
