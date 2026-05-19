import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getItems, getActiveSession, createSession,
  getScanEntries, upsertScanEntry
} from '../lib/supabase'

const LOCATIONS = ['PRIMARY', 'HEATED']

export default function Count() {
  const qc = useQueryClient()
  const [location, setLocation] = useState('PRIMARY')
  const [skuInput, setSkuInput] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [matchedItem, setMatchedItem] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [qty, setQty] = useState(1)
  const [btnFlash, setBtnFlash] = useState(null) // 'plus' | 'minus' | null
  const [listening, setListening] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [scanning, setScanning] = useState(false)
  const skuRef = useRef(null)
  const scannerRef = useRef(null)
  const recognitionRef = useRef(null)
  const lastTapRef = useRef({ plus: 0, minus: 0 })

  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: getItems })
  const { data: session } = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession })

  const createMutation = useMutation({
    mutationFn: () => createSession(new Date().toISOString().slice(0, 10)),
    onSuccess: () => qc.invalidateQueries(['activeSession']),
  })
  // Auto-create session if none exists
  if (session === null && !createMutation.isPending) createMutation.mutate()

  const { data: scanEntries = [] } = useQuery({
    queryKey: ['scanEntries', session?.id],
    queryFn: () => getScanEntries(session.id),
    enabled: !!session?.id,
  })

  const saveMutation = useMutation({
    mutationFn: ({ itemId, qty }) => upsertScanEntry(session.id, itemId, location, qty),
    onSuccess: (_, { itemName }) => {
      qc.invalidateQueries(['scanEntries', session?.id])
      qc.invalidateQueries(['counts', session?.id])
      setFeedback(`Saved: ${itemName}`)
      setTimeout(() => setFeedback(null), 2000)
      resetInput()
    },
  })

  // SKU lookup map
  const itemBySkuMap = Object.fromEntries(
    items.flatMap(i => {
      const entries = []
      if (i.internal_sku) entries.push([i.internal_sku.toLowerCase(), i])
      if (i.hd_sku) entries.push([i.hd_sku.toLowerCase(), i])
      if (i.menards_sku) entries.push([i.menards_sku.toLowerCase(), i])
      if (i.amazon_sku) entries.push([i.amazon_sku.toLowerCase(), i])
      if (i.idi_code) entries.push([i.idi_code.toLowerCase(), i])
      if (i.applied_code) entries.push([i.applied_code.toLowerCase(), i])
      return entries
    })
  )

  function lookupSku(raw) {
    const clean = raw.trim().replace(/^\*|\*$/g, '').toLowerCase()
    return itemBySkuMap[clean] || null
  }

  function resetInput() {
    setSkuInput('')
    setNameSearch('')
    setMatchedItem(null)
    setNotFound(false)
    setQty(1)
    setTimeout(() => skuRef.current?.focus(), 50)
  }

  function selectItem(item) {
    setMatchedItem(item)
    setNotFound(false)
    setNameSearch('')
    setQty(1)
  }

  function handleSkuChange(val) {
    setSkuInput(val)
    setNotFound(false)
    const found = lookupSku(val)
    if (found) selectItem(found)
    else setMatchedItem(null)
  }

  function handleSkuKeyDown(e) {
    if (e.key === 'Enter' && skuInput.trim()) {
      const found = lookupSku(skuInput)
      if (found) { selectItem(found) }
      else { setNotFound(true) }
    }
  }

  function handleSave() {
    if (!matchedItem || !session) return
    saveMutation.mutate({
      itemId: matchedItem.id,
      qty: Number(qty),
      itemName: `${matchedItem.name} ${matchedItem.size || ''}`.trim(),
    })
  }

  function increment() {
    const now = Date.now()
    if (now - lastTapRef.current.plus < 150) return
    lastTapRef.current.plus = now
    setQty(q => q + 1)
    setBtnFlash('plus')
    setTimeout(() => setBtnFlash(null), 120)
  }

  function decrement() {
    const now = Date.now()
    if (now - lastTapRef.current.minus < 150) return
    lastTapRef.current.minus = now
    setQty(q => Math.max(0, q - 1))
    setBtnFlash('minus')
    setTimeout(() => setBtnFlash(null), 120)
  }

  // Camera barcode scanning via Quagga
  async function startCameraScanner() {
    const Quagga = (await import('quagga')).default
    setScanning(true)
    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: scannerRef.current,
        constraints: { facingMode: 'environment', width: 640, height: 480 },
      },
      decoder: { readers: ['code_128_reader', 'code_39_reader', 'ean_reader'] },
    }, err => {
      if (err) { console.error(err); setScanning(false); return }
      Quagga.start()
    })
    Quagga.onDetected(result => {
      const code = result.codeResult.code
      Quagga.stop()
      setScanning(false)
      setSkuInput(code)
      const found = lookupSku(code)
      if (found) { selectItem(found) }
      else { setNotFound(true) }
    })
  }

  // Voice quantity input
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported in this browser.'); return }
    const r = new SR()
    r.lang = 'en-US'
    r.interimResults = false
    r.maxAlternatives = 1
    r.onresult = e => {
      const spoken = e.results[0][0].transcript.trim()
      const num = parseFloat(spoken.replace(/[^0-9.]/g, ''))
      if (!isNaN(num)) setQty(Math.round(num))
      setListening(false)
    }
    r.onerror = () => setListening(false)
    r.onend = () => setListening(false)
    recognitionRef.current = r
    r.start()
    setListening(true)
  }

  // Name search results
  const nameResults = nameSearch.trim().length >= 2
    ? items.filter(i =>
        i.name?.toLowerCase().includes(nameSearch.toLowerCase()) ||
        i.size?.toLowerCase().includes(nameSearch.toLowerCase()) ||
        i.internal_sku?.toLowerCase().includes(nameSearch.toLowerCase())
      ).slice(0, 6)
    : []

  const sessionItemIds = new Set(scanEntries.map(e => e.item_id))
  const progress = items.length > 0 ? Math.round((sessionItemIds.size / items.length) * 100) : 0
  const recentEntries = scanEntries.slice(0, 8)

  return (
    <div>
      {/* Location toggle */}
      <div className="flex mx-4 mt-3 bg-gray-100 rounded-xl p-1">
        {LOCATIONS.map(loc => (
          <button
            key={loc}
            onClick={() => { setLocation(loc); resetInput() }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              location === loc ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {loc === 'PRIMARY' ? 'Primary Storage' : 'Heated Area'}
          </button>
        ))}
      </div>

      {/* Matched item card */}
      {matchedItem && (
        <div className="mx-4 mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-green-700">{matchedItem.name} {matchedItem.size}</div>
            <div className="text-xs text-green-600 mt-0.5">{matchedItem.internal_sku} · {matchedItem.primary_supplier}</div>
          </div>
          <button onClick={resetInput} className="text-xs text-green-600 font-semibold underline ml-2">Change</button>
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div className="mx-4 mt-2 bg-green-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 text-center">
          {feedback}
        </div>
      )}

      {/* Camera scanner */}
      {scanning ? (
        <div className="mx-4 mt-3">
          <div ref={scannerRef} className="scanner-viewport rounded-xl overflow-hidden bg-black" />
          <button onClick={() => setScanning(false)}
            className="w-full mt-2 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm">
            Cancel
          </button>
        </div>
      ) : (
        <>
          {/* Only show scan + search when no item matched yet */}
          {!matchedItem && (
            <>
              <button
                onClick={startCameraScanner}
                className="mx-4 mt-3 w-[calc(100%-2rem)] bg-blue-50 border-2 border-dashed border-blue-300 rounded-xl py-4 flex flex-col items-center gap-1.5"
              >
                <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 9V6a1 1 0 011-1h3M3 15v3a1 1 0 001 1h3m11-4v3a1 1 0 01-1 1h-3m4-11V6a1 1 0 00-1-1h-3M7 9h10M7 12h10M7 15h4" />
                </svg>
                <span className="text-sm font-semibold text-blue-600">Tap to scan barcode</span>
              </button>

              {/* SKU input */}
              <div className="mx-4 mt-2">
                <input
                  ref={skuRef}
                  value={skuInput}
                  onChange={e => handleSkuChange(e.target.value)}
                  onKeyDown={handleSkuKeyDown}
                  placeholder="Scan barcode or type SKU…"
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </div>

              {/* Not found message */}
              {notFound && (
                <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-semibold">
                  Barcode not found — search by name below
                </div>
              )}

              {/* Name search */}
              <div className="mx-4 mt-2">
                <input
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                  placeholder="Search by item name…"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-blue-400"
                />
              </div>

              {/* Name search results */}
              {nameResults.length > 0 && (
                <div className="mx-4 mt-1 border border-gray-200 rounded-xl overflow-hidden">
                  {nameResults.map(item => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 active:bg-gray-50"
                    >
                      <div className="text-sm font-semibold text-gray-800">{item.name} {item.size}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{item.internal_sku} · {item.primary_supplier}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Qty controls — shown once item is selected */}
          {matchedItem && (
            <>
              {/* Big +/- counter */}
              <div className="flex mx-4 mt-4 gap-3 items-center">
                <button
                  onClick={decrement}
                  className={`w-16 h-16 text-4xl rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                    btnFlash === 'minus' ? 'bg-gray-400 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={qty}
                  onChange={e => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    setQty(v === '' ? '' : parseInt(v))
                  }}
                  onFocus={e => e.target.select()}
                  onBlur={e => { if (e.target.value === '' || isNaN(qty)) setQty(0) }}
                  className="flex-1 min-w-0 text-center text-5xl font-extrabold border-2 border-blue-300 rounded-2xl py-3 outline-none focus:border-blue-500 bg-blue-50"
                />
                <button
                  onClick={increment}
                  className={`w-16 h-16 text-4xl rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                    btnFlash === 'plus' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  +
                </button>
              </div>
              <p className="text-center text-xs text-blue-500 font-semibold mt-1">Tap number to type quantity</p>

              <button
                onClick={startVoice}
                className={`mx-4 mt-2 w-[calc(100%-2rem)] flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
                  listening ? 'bg-red-50 border-2 border-red-300 text-red-600' : 'bg-gray-100 text-gray-600'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {listening ? 'Listening…' : 'Speak quantity'}
              </button>

              <div className="flex gap-3 mx-4 mt-3">
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex-1 bg-green-700 text-white font-bold rounded-xl py-4 text-base disabled:opacity-60"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save & Next'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Progress bar */}
      <div className="mx-4 mt-5">
        <div className="flex justify-between text-xs text-gray-500 mb-1.5">
          <span>Session progress</span>
          <span>{sessionItemIds.size} / {items.length} scanned</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Recent scans */}
      {recentEntries.length > 0 && (
        <>
          <div className="flex items-center justify-between px-4 pt-5 pb-2">
            <h2 className="text-sm font-bold text-gray-800">This Session</h2>
            <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              {scanEntries.length} scanned
            </span>
          </div>
          <p className="px-4 text-xs text-gray-400 mb-2">Tap any entry to correct the count</p>
          <div className="border-t border-gray-100">
            {recentEntries.map(e => (
              <button
                key={e.id}
                onClick={() => {
                  const item = items.find(i => i.id === e.item_id)
                  if (!item) return
                  setMatchedItem(item)
                  setQty(e.quantity)
                  setSkuInput('')
                  setNameSearch('')
                  setNotFound(false)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-100 active:bg-gray-50 text-left"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-800">{e.items?.name} {e.items?.size}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {e.location} · {new Date(e.scanned_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-base font-bold text-blue-700">{e.quantity}</div>
                  <svg className="w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
