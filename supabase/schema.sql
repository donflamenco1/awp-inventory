-- AWP Inventory — Supabase schema
-- Run this in the Supabase SQL editor to set up the database

-- Items (Master List)
CREATE TABLE IF NOT EXISTS items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_sku     text UNIQUE,
  hd_sku           text,
  menards_sku      text,
  amazon_sku       text,
  idi_code         text,
  applied_code     text,
  category         text DEFAULT 'Standard',
  name             text NOT NULL,
  size             text,
  unit             text DEFAULT 'EACH',
  primary_max      int  DEFAULT 0,
  reorder_point    int  DEFAULT 0,
  backstock_target int  DEFAULT 0,
  order_increment  int  DEFAULT 1,
  primary_supplier text DEFAULT 'APPLIED',
  current_price    numeric(10,2) DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- Sessions (one per weekly count)
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending  date NOT NULL,
  notes        text,
  submitted_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- Scan entries (PRIMARY and HEATED counts per session)
CREATE TABLE IF NOT EXISTS scan_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location   text NOT NULL CHECK (location IN ('PRIMARY', 'HEATED')),
  quantity   int  NOT NULL DEFAULT 0,
  scanned_at timestamptz DEFAULT now()
);

-- One entry per item+location per session
CREATE UNIQUE INDEX IF NOT EXISTS scan_entries_unique
  ON scan_entries (session_id, item_id, location);

-- Value history (snapshot per submitted week)
CREATE TABLE IF NOT EXISTS value_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending    date NOT NULL,
  on_hand_value  numeric(10,2) DEFAULT 0,
  order_value    numeric(10,2) DEFAULT 0,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- Order history (what was ordered each week)
CREATE TABLE IF NOT EXISTS order_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending date NOT NULL,
  item_id     uuid REFERENCES items(id) ON DELETE SET NULL,
  item_name   text,
  order_qty   int  DEFAULT 0,
  supplier    text,
  created_at  timestamptz DEFAULT now()
);

-- Auto-update updated_at on items
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security (open policy — single user, no auth)
ALTER TABLE items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all" ON items         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON sessions      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON scan_entries  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON value_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON order_history FOR ALL USING (true) WITH CHECK (true);
