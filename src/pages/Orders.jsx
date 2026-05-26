import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getItems, getActiveSession, getCurrentCounts } from '../lib/supabase'
import ExcelJS from 'exceljs'

const MAIN_SUPPLIERS = ['APPLIED', 'HOME DEPOT', 'MENARDS', 'AMAZON', 'IDI']

function fmtCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function calcOrderQty(item, total) {
  // Only trigger an order when at or below the shelf minimum (reorder_point)
  if (total > (item.reorder_point || 0)) return 0
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

  async function exportXlsx() {
    const date = new Date().toISOString().slice(0, 10)
    const wb   = new ExcelJS.Workbook()

    const HEADERS = ['SKU / Code', 'Item Name', 'Size', 'Unit', 'Order Qty', 'Unit Price', 'Est. Cost', 'On Hand', 'Target']
    const COL_WIDTHS = [18, 32, 12, 8, 10, 12, 12, 9, 9]

    // Header style — dark blue background, white bold text
    const headerStyle = {
      font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        bottom: { style: 'thin', color: { argb: 'FF1B3A6B' } },
      },
    }

    // Alternating row fills
    const fillEven = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }  // light blue
    const fillOdd  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }  // white

    // Totals row style
    const totalStyle = {
      font: { bold: true, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } },
      border: { top: { style: 'thin', color: { argb: 'FF1B3A6B' } } },
    }

    const suppliersToExport = [...MAIN_SUPPLIERS, 'OTHER'].filter(s => (ordersBySupplier[s] || []).length > 0)

    for (const sup of suppliersToExport) {
      const list      = ordersBySupplier[sup] || []
      const sheetName = sup === 'HOME DEPOT' ? 'Home Depot' : sup === 'OTHER' ? 'Other' : sup
      const ws        = wb.addWorksheet(sheetName)

      // Column widths
      ws.columns = COL_WIDTHS.map((w, i) => ({ header: HEADERS[i], width: w }))

      // Header row styling
      const hRow = ws.getRow(1)
      hRow.height = 22
      HEADERS.forEach((_, ci) => {
        const cell = hRow.getCell(ci + 1)
        cell.value = HEADERS[ci]
        Object.assign(cell, headerStyle)
        cell.font      = { ...headerStyle.font }
        cell.fill      = headerStyle.fill
        cell.alignment = headerStyle.alignment
        cell.border    = headerStyle.border
      })

      // Data rows
      list.forEach((item, idx) => {
        const price = parseFloat(item.current_price) || 0
        const cost  = item.order_qty * price
        const row   = ws.addRow([
          item.vendor_sku || item.internal_sku || '',
          item.name || '',
          item.size || '',
          item.unit || '',
          item.order_qty,
          price,
          cost,
          item.current_total,
          item.ideal,
        ])
        row.height = 18
        const fill = idx % 2 === 0 ? fillEven : fillOdd
        row.eachCell(cell => { cell.fill = fill })
        // Currency format
        row.getCell(6).numFmt = '"$"#,##0.00'
        row.getCell(7).numFmt = '"$"#,##0.00'
        // Number format
        row.getCell(5).numFmt = '#,##0'
        row.getCell(8).numFmt = '#,##0'
        row.getCell(9).numFmt = '#,##0'
      })

      // Totals row
      const totalQty  = list.reduce((s, i) => s + i.order_qty, 0)
      const totalCost = list.reduce((s, i) => s + i.order_qty * (parseFloat(i.current_price) || 0), 0)
      const totRow = ws.addRow(['', 'TOTAL', '', '', totalQty, '', totalCost, '', ''])
      totRow.height = 20
      totRow.eachCell(cell => {
        cell.font   = totalStyle.font
        cell.fill   = totalStyle.fill
        cell.border = totalStyle.border
      })
      totRow.getCell(5).numFmt = '#,##0'
      totRow.getCell(7).numFmt = '"$"#,##0.00'

      // Autofilter on header row
      ws.autoFilter = { from: 'A1', to: `I1` }
    }

    // Download
    const buffer = await wb.xlsx.writeBuffer()
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url    = URL.createObjectURL(blob)
    const a      = document.createElement('a')
    a.href       = url
    a.download   = `AWP_Orders_${date}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
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
            onClick={exportXlsx}
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
