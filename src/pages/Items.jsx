import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getItems, upsertItem, deleteItem, getCurrentCounts, getActiveSession } from '../lib/supabase'

const SUPPLIERS = ['APPLIED', 'HOME DEPOT', 'MENARDS', 'AMAZON', 'IDI', 'OTHER']
const UNITS = ['BOXES', 'EACH', 'ROLL', 'BAG', 'CASE', 'PAIR', 'SET']

const BLANK = {
  category: 'Standard', name: '', size: '', unit: 'EACH',
  primary_max: 0, reorder_point: 0, backstock_target: 0, order_increment: 1,
  primary_supplier: 'APPLIED', current_price: '',
  hd_sku: '', menards_sku: '', amazon_sku: '', idi_code: '', applied_code: '',
}

function buildSku(item) {
  if (!item.category || !item.name) return ''
  const cat = item.category.substring(0, 2).toUpperCase()
  const nm  = item.name.substring(0, 3).toUpperCase().replace(/\s/g, '')
  const sz  = (item.size || '').toUpperCase().replace(/\s/g, '')
  return `${cat}-${nm}${sz ? '-' + sz : ''}`
}

export default function Items() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [editItem, setEditItem] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { data: items = [], isLoading } = useQuery({ queryKey: ['items'], queryFn: getItems })
  const { data: session } = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession })
  const { data: counts = {} } = useQuery({
    queryKey: ['counts', session?.id],
    queryFn: () => getCurrentCounts(session.id),
    enabled: !!session?.id,
  })

  const categories = useMemo(() => {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort()
    return ['All', ...cats]
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (catFilter !== 'All') list = list.filter(i => i.category === catFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.name?.toLowerCase().includes(q) ||
        i.internal_sku?.toLowerCase().includes(q) ||
        i.size?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, catFilter, search])

  const saveMutation = useMutation({
    mutationFn: (item) => {
      const sku = item.internal_sku || buildSku(item)
      return upsertItem({ ...item, internal_sku: sku })
    },
    onSuccess: () => { qc.invalidateQueries(['items']); setEditItem(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => { qc.invalidateQueries(['items']); setConfirmDelete(null) },
  })

  function stockStatus(item) {
    const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
    if (total === 0 && (item.reorder_point || 0) >= 0) return 'red'
    if (total <= (item.reorder_point || 0)) return 'yellow'
    return 'green'
  }

  return (
    <div>
      {/* Search */}
      <div className="flex gap-2 mx-4 mt-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="border-2 border-gray-200 rounded-xl px-4 text-sm text-gray-500">
            Clear
          </button>
        )}
      </div>

      {/* Category pills */}
      <div className="flex gap-2 px-4 mt-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCatFilter(cat)}
            className={`shrink-0 border-2 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              catFilter === cat
                ? 'bg-blue-700 border-blue-700 text-white'
                : 'border-gray-200 text-gray-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Add button */}
      <div className="px-4 mt-3">
        <button
          onClick={() => setEditItem({ ...BLANK })}
          className="w-full bg-blue-700 text-white font-semibold rounded-xl py-3.5 text-sm"
        >
          + Add New Item
        </button>
      </div>

      {/* Item list */}
      {isLoading ? (
        <div className="text-center text-sm text-gray-400 py-12">Loading…</div>
      ) : (
        <div className="mt-2 border-t border-gray-100">
          {filtered.map(item => {
            const status = stockStatus(item)
            const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
            return (
              <div
                key={item.id}
                className="flex items-center px-4 py-3 border-b border-gray-100 gap-3 active:bg-gray-50"
                onClick={() => setEditItem({ ...item })}
              >
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  status === 'green' ? 'bg-green-400' :
                  status === 'yellow' ? 'bg-yellow-400' : 'bg-red-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">
                    {item.name} {item.size}
                  </div>
                  <div className="text-[10px] font-bold text-gray-400 mt-0.5">
                    {item.internal_sku} · {item.primary_supplier}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {item.unit} · Max {item.primary_max} · Reorder at {item.reorder_point}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-800">
                    ${parseFloat(item.current_price || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">on hand: {total}</div>
                </div>
              </div>
            )
          })}
          <div className="text-center text-xs text-gray-400 py-3">
            {filtered.length} of {items.length} items
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {editItem && (
        <ItemModal
          item={editItem}
          onChange={setEditItem}
          onSave={() => saveMutation.mutate(editItem)}
          onDelete={editItem.id ? () => setConfirmDelete(editItem.id) : null}
          onClose={() => setEditItem(null)}
          saving={saveMutation.isPending}
          error={saveMutation.error?.message}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6 max-w-[480px] left-1/2 -translate-x-1/2">
          <div className="bg-white rounded-2xl p-6 w-full">
            <h3 className="font-extrabold text-base mb-2">Delete item?</h3>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm">
                Cancel
              </button>
              <button
                onClick={() => { deleteMutation.mutate(confirmDelete); setEditItem(null) }}
                className="flex-1 bg-red-600 text-white font-semibold rounded-xl py-3 text-sm">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemModal({ item, onChange, onSave, onDelete, onClose, saving, error }) {
  const set = (k, v) => onChange(prev => ({ ...prev, [k]: v }))
  const autoSku = buildSku(item)

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start pt-5 z-50 max-w-[480px] left-1/2 -translate-x-1/2 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full mx-4 p-5 mb-8"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-extrabold mb-4">
          {item.id ? 'Edit Item' : 'Add New Item'}
        </h3>

        <div className="flex flex-col gap-3 mb-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Item Name">
              <input value={item.name} onChange={e => set('name', e.target.value)}
                className={INPUT} placeholder="e.g. PIPE" autoCapitalize="characters" />
            </Field>
            <Field label="Size / Detail">
              <input value={item.size || ''} onChange={e => set('size', e.target.value)}
                className={INPUT} placeholder="e.g. 4IN" autoCapitalize="characters" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <input value={item.category} onChange={e => set('category', e.target.value)}
                className={INPUT} placeholder="Standard" />
            </Field>
            <Field label="Unit">
              <select value={item.unit} onChange={e => set('unit', e.target.value)} className={INPUT}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Primary Supplier">
            <input
              value={item.primary_supplier}
              onChange={e => set('primary_supplier', e.target.value.toUpperCase())}
              className={INPUT}
              placeholder="APPLIED, HOME DEPOT, MENARDS, AMAZON, IDI…"
              list="supplier-list"
            />
            <datalist id="supplier-list">
              {SUPPLIERS.map(s => <option key={s} value={s} />)}
            </datalist>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost Price ($)">
              <input type="number" step="0.01" min="0" value={item.current_price}
                onChange={e => set('current_price', e.target.value)} className={INPUT} placeholder="0.00" />
            </Field>
            <Field label="Order Increment">
              <input type="number" min="1" value={item.order_increment}
                onChange={e => set('order_increment', parseInt(e.target.value) || 1)} className={INPUT} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Primary Max">
              <input type="number" min="0" value={item.primary_max}
                onChange={e => set('primary_max', parseInt(e.target.value) || 0)} className={INPUT} />
            </Field>
            <Field label="Backstock Cap">
              <input type="number" min="0" value={item.backstock_target}
                onChange={e => set('backstock_target', parseInt(e.target.value) || 0)} className={INPUT} />
            </Field>
            <Field label="Shelf Min">
              <input type="number" min="0" value={item.reorder_point}
                onChange={e => set('reorder_point', parseInt(e.target.value) || 0)} className={INPUT} />
            </Field>
          </div>
        </div>

        {/* Supplier SKUs */}
        <div className="bg-gray-50 rounded-xl p-3 mb-3 mt-3">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Supplier SKUs</div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Applied Code">
                <input value={item.applied_code || ''} onChange={e => set('applied_code', e.target.value)}
                  className={INPUT_SM} placeholder="e.g. DV207" />
              </Field>
              <Field label="IDI Code">
                <input value={item.idi_code || ''} onChange={e => set('idi_code', e.target.value)}
                  className={INPUT_SM} placeholder="e.g. 12345" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Home Depot SKU">
                <input value={item.hd_sku || ''} onChange={e => set('hd_sku', e.target.value)}
                  className={INPUT_SM} />
              </Field>
              <Field label="Menards SKU">
                <input value={item.menards_sku || ''} onChange={e => set('menards_sku', e.target.value)}
                  className={INPUT_SM} />
              </Field>
            </div>
            <Field label="Amazon ASIN">
              <input value={item.amazon_sku || ''} onChange={e => set('amazon_sku', e.target.value)}
                className={INPUT_SM} />
            </Field>
          </div>
        </div>

        {/* Auto SKU preview */}
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500 mb-4">
          Auto SKU: <span className="font-bold text-blue-700">{item.internal_sku || autoSku || '—'}</span>
          {!item.id && autoSku && (
            <span className="text-gray-400"> (generated)</span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 rounded-xl px-3 py-2 text-sm mb-3">{error}</div>
        )}

        <div className="flex gap-3">
          {onDelete && (
            <button onClick={onDelete}
              className="bg-red-50 text-red-600 font-semibold rounded-xl px-4 py-3 text-sm">
              Delete
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || !item.name}
            className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

const INPUT = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white'
const INPUT_SM = 'w-full border-2 border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-400 bg-white'
