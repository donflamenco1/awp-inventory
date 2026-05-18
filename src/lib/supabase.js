import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('Supabase env vars not set — running in demo mode')
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder'
)

// ── Items ────────────────────────────────────────────────
export async function getItems() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('category')
    .order('name')
  if (error) throw error
  return data
}

export async function upsertItem(item) {
  const { data, error } = await supabase
    .from('items')
    .upsert(item, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteItem(id) {
  const { error } = await supabase.from('items').delete().eq('id', id)
  if (error) throw error
}

// ── Sessions ─────────────────────────────────────────────
export async function getActiveSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .is('submitted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createSession(weekEnding) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ week_ending: weekEnding })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .not('submitted_at', 'is', null)
    .order('week_ending', { ascending: false })
  if (error) throw error
  return data
}

// ── Scan entries ─────────────────────────────────────────
export async function getScanEntries(sessionId) {
  const { data, error } = await supabase
    .from('scan_entries')
    .select('*, items(name, size, internal_sku, primary_supplier)')
    .eq('session_id', sessionId)
    .order('scanned_at', { ascending: false })
  if (error) throw error
  return data
}

export async function upsertScanEntry(sessionId, itemId, location, quantity) {
  const { data, error } = await supabase
    .from('scan_entries')
    .upsert(
      { session_id: sessionId, item_id: itemId, location, quantity },
      { onConflict: 'session_id,item_id,location' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Submit week ───────────────────────────────────────────
export async function submitWeek(sessionId, weekEnding) {
  // Get all scan entries with item data
  const { data: entries, error: eErr } = await supabase
    .from('scan_entries')
    .select('*, items(*)')
    .eq('session_id', sessionId)
  if (eErr) throw eErr

  // Compute per-item totals (PRIMARY + HEATED)
  const totals = {}
  for (const e of entries) {
    if (!totals[e.item_id]) totals[e.item_id] = { item: e.items, primary: 0, heated: 0 }
    if (e.location === 'PRIMARY') totals[e.item_id].primary += e.quantity
    else totals[e.item_id].heated += e.quantity
  }

  // Compute on-hand value and orders
  let onHandValue = 0
  let orderValue = 0
  const orderRows = []

  for (const [, v] of Object.entries(totals)) {
    const { item, primary, heated } = v
    const total = primary + heated
    const price = parseFloat(item.current_price) || 0
    onHandValue += total * price

    const gap = Math.max(0, (item.primary_max + item.backstock_target) - total)
    const orderQty = gap > 0 ? Math.ceil(gap / item.order_increment) * item.order_increment : 0
    if (orderQty > 0) {
      orderValue += orderQty * price
      orderRows.push({
        week_ending: weekEnding,
        item_id: item.id,
        item_name: `${item.name} ${item.size || ''}`.trim(),
        order_qty: orderQty,
        supplier: item.primary_supplier,
      })
    }
  }

  // Insert value history
  const { error: vErr } = await supabase
    .from('value_history')
    .insert({ week_ending: weekEnding, on_hand_value: onHandValue, order_value: orderValue })
  if (vErr) throw vErr

  // Insert order history
  if (orderRows.length > 0) {
    const { error: oErr } = await supabase.from('order_history').insert(orderRows)
    if (oErr) throw oErr
  }

  // Mark session as submitted
  const { error: sErr } = await supabase
    .from('sessions')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (sErr) throw sErr
}

// ── Value history ─────────────────────────────────────────
export async function getValueHistory() {
  const { data, error } = await supabase
    .from('value_history')
    .select('*')
    .order('week_ending', { ascending: false })
    .limit(12)
  if (error) throw error
  return data
}

// ── Current counts (derived) ──────────────────────────────
export async function getCurrentCounts(sessionId) {
  const { data, error } = await supabase
    .from('scan_entries')
    .select('item_id, location, quantity')
    .eq('session_id', sessionId)
  if (error) throw error

  const counts = {}
  for (const e of data) {
    if (!counts[e.item_id]) counts[e.item_id] = { primary: 0, heated: 0 }
    if (e.location === 'PRIMARY') counts[e.item_id].primary += e.quantity
    else counts[e.item_id].heated += e.quantity
  }
  return counts
}
