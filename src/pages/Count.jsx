import { useState, useEffect, useRef, useCallback } from 'react'
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
  const [matchedItem, setMatchedItem] = useState(null)
  const [qty, setQty] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [listening, setListening] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const skuRef = useRef(null)
  const qtyRef = useRef(null)
  const scannerRef = useRef(null)
  const recognitionRef = useRef(null)

  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: getItems })
  const { data: session } = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession })

  // Auto-create session if none exists
  const createMutation = useMutation({
    mutationFn: () => createSession(new Date().toISOString().slice(0, 10)),
    onSuccess: () => qc.invalidateQueries(['activeSession']),
  })
  useEffect(() => {
    if (session === null) createMutation.mutate()
  }, [session])

  const { data: scanEntries = [] } = useQuery({
    queryKey: ['scanEntries', session?.id],
    queryFn: () => getScanEntries(session.id),
    enabled: !!session?.id,
  })

  const saveMutation = useMutation({
    mutationFn: ({ itemId, qty }) =>
      upsertScanEntry(session.id, itemId, location, qty),
    onSuccess: (_, { itemName }) => {
      qc.invalidateQueries(['scanEntries', session?.id])
      qc.invalidateQueries(['counts', session?.id])
      setFeedback(`Saved: ${itemName}`)
      setTimeout(() => setFeedback(null), 2000)
      resetInput()
    },
  })

  // Build lookup map by SKU
  const itemBySkuMap = Object.fromEntries(
    items.flatMap(i => {
      const matches = []
      if (i.internal_sku) matches.push([i.internal_sku.toLowerCase(), i])
      if (i.hd_sku) matches.push([i.hd_sku.toLowerCase(), i])
      if (i.menards_sku) matches.push([i.menards_sku.toLowerCase(), i])
      if (i.amazon_sku) matches.push([i.amazon_sku.toLowerCase(), i])
      if (i.idi_code) matches.push([i.idi_code.toLowerCase(), i])
      if (i.applied_code) matches.push([i.applied_code.toLowerCase(), i])
      return matches
    })
  )

  function lookupSku(raw) {
    const clean = raw.trim().replace(/^\*|\*$/g, '').toLowerCase()
    return itemBySkuMap[clean] || null
  }

  function resetInput() {
    setSkuInput('')
    setMatchedItem(null)
    setQty(0)
    setTimeout(() => skuRef.current?.focus(), 50)
  }

  function handleSkuChange(val) {
    setSkuInput(val)
    const found = lookupSku(val)
    if (found) {
      setMatchedItem(found)
      setQty(0)
      setTimeout(() => qtyRef.current?.focus(), 50)
    } else {
      setMatchedItem(null)
    }
  }

  // Bluetooth scanner fires Enter after barcode
  function handleSkuKeyDown(e) {
    if (e.key === 'Enter' && skuInput.trim()) {
      const found = lookupSku(skuInput)
      if (found) {
        setMatchedItem(found)
        setQty(0)
        setTimeout(() => qtyRef.current?.focus(), 50)
      }
    }
  }

  function handleQtyKeyDown(e) {
    if (e.key === 'Enter' && matchedItem) handleSave()
  }

  function handleSave() {
    if (!matchedItem || !session) return
    saveMutation.mutate({
      itemId: matchedItem.id,
      qty: Number(qty),
      itemName: `${matchedItem.name} ${matchedItem.size || ''}`.trim(),
    })
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
      if (found) {
        setMatchedItem(found)
        setQty(0)
        setTimeout(() => qtyRef.current?.focus(), 50)
      }
    })
  }

  // Voice input via Web Speech API
  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Voice input not supported in this browser.'); return }
    const r = new SpeechRecognition()
    r.lang = 'en-US'
    r.interimResults = false
    r.maxAlternatives = 1
    r.onresult = e => {
      const spoken = e.results[0][0].transcript.trim().toLowerCase()
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

  const sessionItemIds = new Set(scanEntries.map(e => e.item_id))
  const progress = items.length > 0
    ? Math.round((sessionItemIds.size / items.length) * 100) : 0

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
              location === loc
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500'
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
            <div className="text-sm font-bold text-green-700">
              {matchedItem.name} {matchedItem.size}
            </div>
            <div className="text-xs text-green-600 mt-0.5">
              {matchedItem.internal_sku} · {matchedItem.primary_supplier}
            </div>
          </div>
          <div className="text-3xl font-extrabold text-green-700">{qty}</div>
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div className="mx-4 mt-2 bg-green-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 text-center">
          {feedback}
        </div>
      )}

      {/* Camera scanner area */}
      {scanning ? (
        <div className="mx-4 mt-3">
          <div ref={scannerRef} className="scanner-viewport rounded-xl overflow-hidden bg-black" />
          <button
            onClick={() => setScanning(false)}
            className="w-full mt-2 bg-gray-100 text-gray-700 font-semibold rounded-xl py-3 text-sm"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {/* Scan prompt box */}
          {!matchedItem && (
            <button
              onClick={startCameraScanner}
              className="mx-4 mt-3 w-[calc(100%-2rem)] bg-blue-50 border-2 border-dashed border-blue-300 rounded-xl py-5 flex flex-col items-center gap-2"
            >
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 9V6a1 1 0 011-1h3M3 15v3a1 1 0 001 1h3m11-4v3a1 1 0 01-1 1h-3m4-11V6a1 1 0 00-1-1h-3M7 9h10M7 12h10M7 15h4" />
              </svg>
              <span className="text-sm font-semibold text-blue-600">Tap to scan with camera</span>
              <span className="text-xs text-blue-400">Bluetooth scanner also works — just scan</span>
            </button>
          )}

          {/* SKU input */}
          <div className="flex gap-2 mx-4 mt-2">
            <input
              ref={skuRef}
              value={skuInput}
              onChange={e => handleSkuChange(e.target.value)}
              onKeyDown={handleSkuKeyDown}
              placeholder="SKU or barcode…"
              autoComplete="off"
              autoCapitalize="characters"
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400"
            />
            {matchedItem && (
              <button
                onClick={resetInput}
                className="border-2 border-gray-200 rounded-xl px-4 text-sm font-semibold text-gray-500"
              >
                Clear
              </button>
            )}
          </div>

          {/* Qty entry */}
          {matchedItem && (
            <>
              <div className="flex mx-4 mt-3 border-2 border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setQty(q => Math.max(0, q - 1))}
                  className="w-14 h-14 bg-gray-100 text-2xl text-gray-700 font-light shrink-0 active:bg-gray-200"
                >
                  −
                </button>
                <input
                  ref={qtyRef}
                  type="number"
                  min={0}
                  value={qty}
                  onChange={e => setQty(Math.max(0, parseInt(e.target.value) || 0))}
                  onKeyDown={handleQtyKeyDown}
                  className="flex-1 text-center text-3xl font-extrabold border-none outline-none py-2"
                />
                <button
                  onClick={() => setQty(q => q + 1)}
                  className="w-14 h-14 bg-gray-100 text-2xl text-gray-700 font-light shrink-0 active:bg-gray-200"
                >
                  +
                </button>
              </div>

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

              <div className="flex gap-3 mx-4 mt-2">
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex-1 bg-green-700 text-white font-semibold rounded-xl py-3.5 text-sm disabled:opacity-60"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save & Next Item'}
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
          <div className="border-t border-gray-100">
            {recentEntries.map(e => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                <div>
                  <div className="text-sm font-semibold text-gray-800">
                    {e.items?.name} {e.items?.size}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {e.location} · {new Date(e.scanned_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-base font-bold text-blue-700">{e.quantity}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
