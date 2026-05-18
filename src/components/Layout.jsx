import { Outlet, useLocation } from 'react-router-dom'
import TopBar from './TopBar'
import NavBar from './NavBar'

const titles = {
  '/dashboard': ['All Weather Plus', 'Inventory System'],
  '/count':     ['Count Inventory', 'Scan or type SKU'],
  '/items':     ['Item Catalog', 'Manage items & pricing'],
  '/orders':    ['Reorder List', 'Items below threshold'],
  '/history':   ['Count History', 'Value over time'],
  '/labels':    ['Shelf Labels', 'Brother QL-800'],
}

export default function Layout() {
  const { pathname } = useLocation()
  const [title, sub] = titles[pathname] || ['AWP Inventory', '']

  return (
    <div className="flex flex-col min-h-dvh max-w-[480px] mx-auto bg-white shadow-xl relative">
      <TopBar title={title} sub={sub} />
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>
      <NavBar />
    </div>
  )
}
