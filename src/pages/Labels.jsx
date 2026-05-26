import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getItems } from '../lib/supabase'

const BRIDGE_URL = import.meta.env.VITE_PRINT_BRIDGE_URL || 'https://192.168.40.220:5757'

function buildSku(item) {
  const cat = (item.category || '').substring(0, 2).toUpperCase()
  const nm  = (item.name || '').substring(0, 3).toUpperCase().replace(/\s/g, '')
  const sz  = (item.size || '').toUpperCase().replace(/\s/g, '')
  return item.internal_sku || `${cat}-${nm}${sz ? '-' + sz : ''}`
}

function itemToLabel(item) {
  return {
    name:             item.name || '',
    size:             item.size || '',
    category:         item.category || '',
    unit:             item.unit || 'EACH',
    primary_max:      item.primary_max || 0,
    backstock_target: item.backstock_target || 0,
    reorder_point:    item.reorder_point || 0,
    order_increment:  item.order_increment || 1,
    internal_sku:     item.internal_sku || '',
    sku:              buildSku(item),
  }
}

export default function Labels() {
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: getItems })

  const [form, setForm] = useState({
    name: 'PIPE', size: '4IN', category: 'Standard', unit: 'BOXES',
    primary_max: 5, backstock_target: 3, reorder_point: 1, order_increment: 3,
    internal_sku: '',
  })
  const [queue, setQueue] = useState([])   // [{ ...labelData, _copies, _qid }]
  const [printing, setPrinting] = useState(false)
  const [printStatus, setPrintStatus] = useState(null)
  const [search, setSearch] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState('unknown') // 'ok' | 'error' | 'unknown'

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const sku = buildSku(form)

  // Ping bridge on mount
  useEffect(() => {
    fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? setBridgeStatus('ok') : setBridgeStatus('error'))
      .catch(() => setBridgeStatus('error'))
  }, [])

  function loadItem(item) {
    setForm(itemToLabel(item))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function addToQueue(labelData, copies = 1) {
    if (!labelData.name) return
    const entry = { ...labelData, sku: buildSku(labelData), _copies: copies, _qid: Date.now() + Math.random() }
    setQueue(q => [...q, entry])
  }

  function removeFromQueue(qid) {
    setQueue(q => q.filter(i => i._qid !== qid))
  }

  function setCopies(qid, copies) {
    setQueue(q => q.map(i => i._qid === qid ? { ...i, _copies: Math.max(1, copies) } : i))
  }

  async function printAll() {
    if (!queue.length) return
    setPrinting(true)
    setPrintStatus(null)
    try {
      const res = await fetch(`${BRIDGE_URL}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: queue }),
      })
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`)
      const data = await res.json()
      setPrintStatus({ ok: true, msg: `${data.printed} label${data.printed !== 1 ? 's' : ''} sent to QL-800` })
      setQueue([])
      setBridgeStatus('ok')
    } catch (err) {
      setBridgeStatus('error')
      setPrintStatus({ ok: false, msg: `Print bridge not reachable. Make sure bridge.py is running on the printer PC. (${err.message})` })
    } finally {
      setPrinting(false)
    }
  }

  const filteredItems = items.filter(i => {
    if (!search) return true
    const q = search.toLowerCase()
    return i.name?.toLowerCase().includes(q) || i.internal_sku?.toLowerCase().includes(q) || i.size?.toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Bridge status banner */}
      <div className={`mx-4 mt-3 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs font-semibold ${
        bridgeStatus === 'ok'    ? 'bg-green-50 text-green-700' :
        bridgeStatus === 'error' ? 'bg-red-50 text-red-600' :
                                   'bg-gray-50 text-gray-500'
      }`}>
        <div className={`w-2 h-2 rounded-full ${
          bridgeStatus === 'ok' ? 'bg-green-500' :
          bridgeStatus === 'error' ? 'bg-red-400' : 'bg-gray-300'
        }`} />
        {bridgeStatus === 'ok'    ? 'Print bridge connected — QL-800 ready' :
         bridgeStatus === 'error' ? 'Print bridge offline — run bridge.py on printer PC' :
                                    'Checking print bridge…'}
      </div>

      {/* Label preview */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">Label Preview</h2>
          <span className="text-xs text-gray-400">62mm · Brother QL-800</span>
        </div>
        <LabelPreview item={{ ...form, sku }} />
      </div>

      {/* Edit fields */}
      <div className="mx-4 mt-1 bg-gray-50 rounded-xl p-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Edit Label</div>
        <div className="grid grid-cols-2 gap-3">
          <LabelField label="Item Name">
            <input value={form.name} onChange={e => set('name', e.target.value.toUpperCase())}
              className={FI} autoCapitalize="characters" />
          </LabelField>
          <LabelField label="Size">
            <input value={form.size} onChange={e => set('size', e.target.value.toUpperCase())}
              className={FI} />
          </LabelField>
          <LabelField label="Primary Cap">
            <input type="number" min="0" value={form.primary_max}
              onChange={e => set('primary_max', parseInt(e.target.value) || 0)} className={FI} />
          </LabelField>
          <LabelField label="Backstock Cap">
            <input type="number" min="0" value={form.backstock_target}
              onChange={e => set('backstock_target', parseInt(e.target.value) || 0)} className={FI} />
          </LabelField>
          <LabelField label="Shelf Min">
            <input type="number" min="0" value={form.reorder_point}
              onChange={e => set('reorder_point', parseInt(e.target.value) || 0)} className={FI} />
          </LabelField>
          <LabelField label="Order Mult">
            <input type="number" min="1" value={form.order_increment}
              onChange={e => set('order_increment', parseInt(e.target.value) || 1)} className={FI} />
          </LabelField>
        </div>
      </div>

      <div className="px-4 mt-3">
        <button
          onClick={() => addToQueue({ ...form })}
          disabled={!form.name}
          className="w-full bg-blue-700 text-white font-semibold rounded-xl py-3.5 text-sm disabled:opacity-50"
        >
          + Add to Print Queue
        </button>
      </div>

      {/* Print queue */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <h2 className="text-sm font-bold text-gray-800">Print Queue</h2>
        <span className="bg-blue-700 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
          {queue.reduce((s, i) => s + i._copies, 0)} labels
        </span>
      </div>

      {printStatus && (
        <div className={`mx-4 mb-3 rounded-xl px-4 py-3 text-sm font-medium ${
          printStatus.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
        }`}>
          {printStatus.msg}
        </div>
      )}

      {queue.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-4 px-4">
          No labels queued — tap an item below or fill in the form above.
        </div>
      ) : (
        <div className="border-t border-gray-100">
          {queue.map(item => (
            <div key={item._qid} className="flex items-center px-4 py-3 border-b border-gray-100 gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{item.name} {item.size}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {item.sku} · Cap {item.primary_max} · Min {item.reorder_point}
                </div>
              </div>
              {/* Copies stepper */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setCopies(item._qid, item._copies - 1)}
                  className="w-7 h-7 bg-gray-100 rounded-lg text-lg font-bold text-gray-600 flex items-center justify-center">
                  −
                </button>
                <span className="w-6 text-center text-sm font-bold">{item._copies}</span>
                <button onClick={() => setCopies(item._qid, item._copies + 1)}
                  className="w-7 h-7 bg-gray-100 rounded-lg text-lg font-bold text-gray-600 flex items-center justify-center">
                  +
                </button>
              </div>
              <button
                onClick={() => removeFromQueue(item._qid)}
                className="bg-red-50 text-red-600 font-bold text-xs rounded-lg px-3 py-1.5 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-3 px-4 py-3">
            <button
              onClick={printAll}
              disabled={printing}
              className="flex-1 bg-green-700 text-white font-semibold rounded-xl py-3.5 text-sm disabled:opacity-60"
            >
              {printing ? 'Sending to printer…' : `Print ${queue.reduce((s, i) => s + i._copies, 0)} Label${queue.reduce((s, i) => s + i._copies, 0) !== 1 ? 's' : ''}`}
            </button>
            <button onClick={() => setQueue([])}
              className="bg-gray-100 text-gray-700 font-semibold rounded-xl px-4 text-sm">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* From catalog */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-bold text-gray-800">From Item Catalog</h2>
        <p className="text-xs text-gray-400 mt-0.5">Tap to load · 🖨 to quick-add to queue</p>
      </div>
      <div className="px-4 pb-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400"
        />
      </div>
      <div className="border-t border-gray-100 mb-8">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className="flex items-center px-4 py-3 border-b border-gray-100 gap-3"
          >
            <button
              onClick={() => loadItem(item)}
              className="flex-1 text-left active:bg-gray-50 min-w-0"
            >
              <div className="text-sm font-semibold text-gray-800 truncate">{item.name} {item.size}</div>
              <div className="text-xs text-gray-400 mt-0.5">{item.internal_sku} · {item.primary_supplier}</div>
            </button>
            <button
              onClick={() => addToQueue(itemToLabel(item))}
              className="shrink-0 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg px-3 py-1.5"
            >
              🖨 Queue
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function LabelPreview({ item }) {
  return (
    <div className="border-2 border-gray-300 rounded-lg p-3 font-['Arial',sans-serif] bg-white shadow-sm">
      <div className="flex justify-between items-start border-b border-black pb-2 mb-2">
        <div>
          <div className="text-xl font-black text-black leading-tight">{item.name || 'ITEM'}</div>
          <div className="text-sm font-bold text-gray-600 mt-0.5">{item.size}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-gray-600 tracking-wide">{item.sku}</div>
          <div className="text-[9px] text-gray-400 mt-0.5">{item.category}</div>
        </div>
      </div>
      {/* Simulated barcode */}
      <div className="flex justify-center my-2">
        <div>
          <div className="h-9 w-48 rounded-sm" style={{
            background: 'repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 8px,#000 8px,#000 9px,#fff 9px,#fff 11px,#000 11px,#000 14px,#fff 14px,#fff 16px,#000 16px,#000 17px,#fff 17px,#fff 20px,#000 20px,#000 22px,#fff 22px,#fff 24px,#000 24px,#000 26px,#fff 26px,#fff 28px)',
          }} />
          <div className="text-[8px] text-center text-gray-600 font-mono tracking-widest mt-1">
            *{item.sku}*
          </div>
        </div>
      </div>
      {/* Data table */}
      <table className="w-full border-collapse text-center">
        <thead>
          <tr>
            {['PRIMARY CAP', 'BACKSTOCK CAP', 'SHELF MIN', 'ORD MULT'].map(h => (
              <td key={h} className="border border-black px-1 py-0.5 text-[7px] font-bold text-gray-500 bg-gray-50">
                {h}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {[item.primary_max, item.backstock_target, item.reorder_point, item.order_increment].map((v, i) => (
              <td key={i} className="border border-black px-1 py-1 text-sm font-black text-black">
                {v}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="text-right text-[9px] text-gray-500 mt-1">Unit: {item.unit}</div>
    </div>
  )
}

function LabelField({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}

const FI = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white'
