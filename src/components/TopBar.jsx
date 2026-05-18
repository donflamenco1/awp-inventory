export default function TopBar({ title, sub }) {
  return (
    <header className="bg-blue-700 text-white px-4 pt-3.5 pb-2.5 flex items-center justify-between sticky top-0 z-50">
      <div>
        <div className="text-lg font-bold tracking-tight">{title}</div>
        {sub && <div className="text-xs opacity-75 mt-0.5">{sub}</div>}
      </div>
    </header>
  )
}
