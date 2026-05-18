import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getItems, getActiveSession, getCurrentCounts } from '../lib/supabase'

const MAIN_SUPPLIERS = ['APPLIED', 'HOME DEPOT', 'MENARDS', 'AMAZON', 'IDI']

function fmtCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function calcOrderQty(item, total) {
  const ideal = (item.primary_max || 0) + (item.backstock_target || 0)
  const gap = Math.max(0, ideal - total)
  if (gap === 0) return 0
  const inc = Math.max(1, item.order_increment || 1)
  return Math.ceil(gap / inc) * inc
}

export default function Orders() {
  const [activeSupplier, setActiveSupplier] = useState('APPLIED')

  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: getItems })
  const { data: session } = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession })
  const { data: counts = {} } = useQuery({
    queryKey: ['counts', session?.id],
    queryFn: () => getCurrentCounts(session.id),
    enabled: !!session?.id,
  })

  // Build reorder list grouped by supplier
  const ordersBySupplier = useMemo(() => {
    const grouped = {}
    for (const item of items) {
      const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
      const orderQty = calcOrderQty(item, total)
      if (orderQty <= 0) continue

      const sup = item.primary_supplier?.toUpperCase() || 'OTHER'
      const bucket = MAIN_SUPPLIERS.includes(sup) ? sup : 'OTHER'
      if (!grouped[bucket]) grouped[bucket] = []
      grouped[bucket].push({
        ...item,
        current_total: total,
        ideal: (item.primary_max || 0) + (item.backstock_target || 0),
        order_qty: orderQty,
        vendor_sku: bucket === 'HOME DEPOT' ? item.hd_sku
          : bucket === 'MENARDS' ? item.menards_sku
          : bucket === 'AMAZON' ? item.amazon_sku
          : bucket === 'IDI' ? item.idi_code
          : bucket === 'APPLIED' ? item.applied_code
          : null,
        display_supplier: item.primary_supplier,
      })
    }
    return grouped
  }, [items, counts])

  const allSuppliers = [...MAIN_SUPPLIERS, 'OTHER']
  const currentList = ordersBySupplier[activeSupplier] || []
  const totalItems = currentList.length
  const totalCost = currentList.reduce((sum, i) => sum + i.order_qty * (parseFloat(i.current_price) || 0), 0)

  function copyOrderList() {
    const lines = currentList.map(i =>
      `${i.vendor_sku || i.internal_sku}\t${i.order_qty}\t${i.name} ${i.size || ''}`
    ).join('\n')
    navigator.clipboard.writeText(lines).then(() => alert('Order list copied to clipboard'))
  }

  return (
    <div>
      {/* Sample data notice when no session */}
      {!session && (
        <div className="mx-4 mt-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
          No active count session — showing reorder status based on last submitted counts.
        </div>
      )}

      {/* Supplier tabs */}
      <div className="flex flex-wrap gap-2 px-4 mt-3">
        {allSuppliers.map(sup => {
          const count = (ordersBySupplier[sup] || []).length
          return (
            <button
              key={sup}
              onClick={() => setActiveSupplier(sup)}
              className={`border-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                activeSupplier === sup
                  ? 'bg-blue-700 border-blue-700 text-white'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              {sup === 'HOME DEPOT' ? 'Home Depot'
                : sup === 'OTHER' ? 'Other'
                : sup === 'IDI' ? 'IDI'
                : sup.charAt(0) + sup.slice(1).toLowerCase()}
              {count > 0 && (
                <span className={`ml-1.5 text-xs font-bold ${activeSupplier === sup ? 'opacity-75' : 'text-red-500'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Summary stats */}
      <div className="flex gap-3 px-4 mt-3">
        <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2.5 text-center">
          <div className="text-xl font-extrabold text-gray-800">{totalItems}</div>
          <div className="text-xs text-gray-500 mt-0.5">Items to order</div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2.5 text-center">
          <div className="text-xl font-extrabold text-gray-800">{fmtCurrency(totalCost)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Est. total</div>
        </div>
      </div>

      {/* Action buttons */}
      {currentList.length > 0 && (
        <div className="flex gap-3 px-4 mt-3">
          <button
            onClick={copyOrderList}
            className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm"
          >
            Copy Order List
          </button>
          <button
            onClick={() => alert('Export coming soon — will generate .xlsx matching your Order sheets')}
            className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm"
          >
            Export .xlsx
          </button>
        </div>
      )}

      {/* Order items */}
      {currentList.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-16">
          Nothing to order from {activeSupplier === 'OTHER' ? 'Other suppliers' : activeSupplier}
        </div>
      ) : (
        <div className="mt-3 border-t border-gray-100">
          {currentList.map(item => (
            <div key={item.id} className="flex items-center px-4 py-3 border-b border-gray-100 gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">
                  {item.name} {item.size}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {item.vendor_sku || item.internal_sku} · {item.unit}
                  {activeSupplier === 'OTHER' && item.display_supplier && (
                    <span className="ml-1 text-orange-500 font-semibold">· {item.display_supplier}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Have {item.current_total} · Need {item.ideal} · Gap {item.ideal - item.current_total}
                </div>
              </div>
              <div className="bg-red-50 text-red-600 text-base font-extrabold px-3 py-1.5 rounded-lg shrink-0">
                ×{item.order_qty}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
