import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getItems, getActiveSession, createSession, getScanEntries,
  getCurrentCounts, submitWeek
} from '../lib/supabase'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmtCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showSubmit, setShowSubmit] = useState(false)
  const [showMissing, setShowMissing] = useState(false)

  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: getItems })
  const { data: session } = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession })
  const { data: scanEntries = [] } = useQuery({
    queryKey: ['scanEntries', session?.id],
    queryFn: () => getScanEntries(session.id),
    enabled: !!session?.id,
  })
  const { data: counts = {} } = useQuery({
    queryKey: ['counts', session?.id],
    queryFn: () => getCurrentCounts(session.id),
    enabled: !!session?.id,
  })

  const startMutation = useMutation({
    mutationFn: () => createSession(today()),
    onSuccess: () => { qc.invalidateQueries(['activeSession']); navigate('/count') },
  })

  const submitMutation = useMutation({
    mutationFn: () => submitWeek(session.id, session.week_ending),
    onSuccess: () => {
      qc.invalidateQueries()
      setShowSubmit(false)
    },
  })

  // Compute stats
  const scannedItemIds = new Set(scanEntries.map(e => e.item_id))
  const missingItems = items.filter(i => !scannedItemIds.has(i.id))
  const hasMissing = missingItems.length > 0

  const onHandValue = items.reduce((sum, item) => {
    const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
    return sum + total * (parseFloat(item.current_price) || 0)
  }, 0)

  const SUPPLIERS = ['APPLIED', 'HOME DEPOT', 'MENARDS', 'AMAZON', 'IDI']
  const reorderItems = items.filter(item => {
    const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
    const ideal = (item.primary_max || 0) + (item.backstock_target || 0)
    return total <= (item.reorder_point || 0) && ideal > 0
  })

  const sessionProgress = items.length > 0
    ? Math.round((scannedItemIds.size / items.length) * 100)
    : 0

  return (
    <div>
      {/* Reorder alert */}
      {reorderItems.length > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl px-4 py-3 text-sm font-medium">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {reorderItems.length} item{reorderItems.length !== 1 ? 's' : ''} need reordering
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 px-4 mt-3">
        <StatCard label="Items tracked" value={items.length} color="text-blue-700" />
        <StatCard label="On-hand value" value={fmtCurrency(onHandValue)} color="text-green-700" />
        <StatCard label="Reorder triggered" value={reorderItems.length} color="text-orange-600" />
        <StatCard label="Missing scans" value={missingItems.length} color="text-red-600" />
      </div>

      {/* Session progress */}
      {session && (
        <div className="mx-4 mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Session progress</span>
            <span>{scannedItemIds.size} / {items.length} scanned</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${sessionProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 px-4 mt-3">
        {session ? (
          <>
            <button
              onClick={() => navigate('/count')}
              className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3.5 text-sm"
            >
              Continue Counting
            </button>
            <button
              onClick={() => setShowSubmit(true)}
              className="bg-gray-100 text-gray-700 font-semibold rounded-xl px-4 py-3.5 text-sm"
            >
              Submit Week
            </button>
          </>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3.5 text-sm disabled:opacity-60"
          >
            {startMutation.isPending ? 'Starting…' : 'Start Counting'}
          </button>
        )}
      </div>

      {/* Reorder alerts list */}
      {reorderItems.length > 0 && (
        <>
          <SectionHeader title="Reorder Alerts">
            <span className="text-xs font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
              {reorderItems.length} items
            </span>
          </SectionHeader>
          <div className="border-t border-gray-100">
            {reorderItems.slice(0, 8).map(item => {
              const total = (counts[item.id]?.primary || 0) + (counts[item.id]?.heated || 0)
              const ideal = (item.primary_max || 0) + (item.backstock_target || 0)
              const gap = ideal - total
              const isOut = total === 0
              return (
                <div key={item.id} className="flex items-center px-4 py-3 border-b border-gray-100 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">
                      {item.name} {item.size}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {SUPPLIERS.includes(item.primary_supplier) ? item.primary_supplier : item.primary_supplier || 'Other'} · {item.internal_sku}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold ${isOut ? 'text-red-600' : 'text-orange-500'}`}>
                      {total} / {ideal}
                    </div>
                    <div className="text-xs text-gray-400">order {gap}</div>
                  </div>
                </div>
              )
            })}
            {reorderItems.length > 8 && (
              <button
                onClick={() => navigate('/orders')}
                className="w-full text-center text-sm text-blue-700 font-semibold py-3"
              >
                View all {reorderItems.length} on Orders page
              </button>
            )}
          </div>
        </>
      )}

      {/* Submit Week Modal */}
      {showSubmit && (
        <Modal onClose={() => setShowSubmit(false)}>
          <h3 className="text-lg font-extrabold mb-1">Submit Week</h3>
          <p className="text-sm text-gray-500 mb-5">
            Week ending {session?.week_ending}
          </p>
          <CheckRow ok={!hasMissing}>
            {hasMissing
              ? <span className="text-red-600 font-semibold">{missingItems.length} items never scanned</span>
              : 'All items scanned'}
          </CheckRow>
          <CheckRow ok>
            {scannedItemIds.size} of {items.length} items counted
          </CheckRow>
          <CheckRow ok>
            {reorderItems.length} reorder triggers calculated
          </CheckRow>
          <CheckRow ok>
            On-hand value: {fmtCurrency(onHandValue)}
          </CheckRow>

          {hasMissing && (
            <div className="mt-3 bg-red-50 rounded-xl px-4 py-3 text-sm text-red-600">
              Cannot submit — {missingItems.length} items missing. Scan all items before submitting (enter 0 if none on hand).
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setShowSubmit(false)}
              className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm"
            >
              Cancel
            </button>
            {hasMissing ? (
              <button
                onClick={() => { setShowSubmit(false); setShowMissing(true) }}
                className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm"
              >
                Show Missing
              </button>
            ) : (
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex-1 bg-green-700 text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-60"
              >
                {submitMutation.isPending ? 'Submitting…' : 'Confirm Submit'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Missing Scans Modal */}
      {showMissing && (
        <Modal onClose={() => setShowMissing(false)}>
          <h3 className="text-lg font-extrabold mb-1">Missing Scans</h3>
          <p className="text-sm text-gray-500 mb-4">
            These items haven't been scanned. Scan each one and enter 0 if none on hand.
          </p>
          <div className="max-h-72 overflow-y-auto -mx-5 px-5">
            {missingItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100">
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">{item.name} {item.size}</div>
                  <div className="text-xs text-gray-400">{item.internal_sku}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setShowMissing(false)}
              className="flex-1 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm"
            >
              Close
            </button>
            <button
              onClick={() => { setShowMissing(false); navigate('/count') }}
              className="flex-1 bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm"
            >
              Go to Count
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3.5">
      <div className={`text-2xl font-extrabold leading-none ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function SectionHeader({ title, children }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-2">
      <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      {children}
    </div>
  )
}

function CheckRow({ ok, children }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 text-sm">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${ok ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-600'}`}>
        {ok ? '✓' : '!'}
      </div>
      <span>{children}</span>
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end z-50 max-w-[480px] left-1/2 -translate-x-1/2"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl w-full px-5 pt-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
