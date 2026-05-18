import { useQuery } from '@tanstack/react-query'
import { getSessions, getValueHistory } from '../lib/supabase'

function fmtCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function History() {
  const { data: sessions = [] } = useQuery({ queryKey: ['sessions'], queryFn: getSessions })
  const { data: valueHistory = [] } = useQuery({ queryKey: ['valueHistory'], queryFn: getValueHistory })

  const chartData = [...valueHistory].reverse().slice(-8)
  const maxVal = Math.max(...chartData.map(v => parseFloat(v.on_hand_value) || 0), 1)

  return (
    <div>
      {/* Value chart */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-bold text-gray-800 mb-3">On-Hand Value Over Time</h2>
        {chartData.length === 0 ? (
          <div className="bg-blue-50 rounded-xl h-28 flex items-center justify-center text-sm text-blue-400">
            No history yet — submit your first week to see data
          </div>
        ) : (
          <div className="bg-blue-50 rounded-xl px-4 pt-4 pb-3 flex items-end gap-2 h-36 overflow-hidden">
            {chartData.map((v, i) => {
              const pct = Math.max(8, ((parseFloat(v.on_hand_value) || 0) / maxVal) * 100)
              const isLast = i === chartData.length - 1
              return (
                <div key={v.id} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className={`w-full rounded-t ${isLast ? 'bg-blue-700' : 'bg-blue-300'}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-[9px] font-semibold ${isLast ? 'text-blue-700' : 'text-gray-400'}`}>
                    {new Date(v.week_ending + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sessions list */}
      <div className="px-4 pb-2">
        <h2 className="text-sm font-bold text-gray-800 mb-2">Count Sessions</h2>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-12">
          No submitted sessions yet
        </div>
      ) : (
        <div className="border-t border-gray-100">
          {sessions.map(s => {
            const vh = valueHistory.find(v => v.week_ending === s.week_ending)
            return (
              <div key={s.id} className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
                <div>
                  <div className="text-sm font-bold text-gray-800">{fmtDate(s.week_ending)}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Submitted {new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-extrabold text-green-700">
                    {vh ? fmtCurrency(vh.on_hand_value) : '—'}
                  </div>
                  {vh?.order_value > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      Ordered {fmtCurrency(vh.order_value)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
