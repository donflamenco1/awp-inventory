"""
Import items from Inventory 5.18.xlsm into Supabase.

Usage:
  python -m pip install openpyxl python-dotenv requests
  python scripts/import_inventory.py
"""

import os, sys, json
from pathlib import Path
import requests
from dotenv import load_dotenv
import openpyxl

load_dotenv()

SPREADSHEET = Path(r"C:\Users\eric\Documents\All Weather Plus\Inventory\Inventory\Inventory Macro Enabled most recent 5.18 - UPDATED.xlsm")

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["VITE_SUPABASE_ANON_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

def clean(v):
    if v is None: return None
    s = str(v).strip()
    return s if s else None

def clean_num(v):
    try: return float(str(v).replace('$','').replace(',',''))
    except: return 0.0

def clean_int(v):
    try: return int(float(str(v)))
    except: return 0

def main():
    print(f"Loading {SPREADSHEET}...")
    wb = openpyxl.load_workbook(SPREADSHEET, read_only=True, keep_vba=False, data_only=True)
    ws = wb["Master List"]

    items = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[8]:
            continue

        sku_raw = clean(row[1])
        if sku_raw and sku_raw.startswith('='):
            sku_raw = None

        name = clean(row[8])
        if not name or name.startswith('='):
            continue

        def col(i):
            return row[i] if i < len(row) else None

        # Columns: 0=BARCODE, 1=Internal SKU, 2=HD SKU, 3=Menards SKU,
        # 4=Amazon SKU, 5=IDI Code, 6=Applied Code, 7=Category,
        # 8=Item Name, 9=Detail/Size, 10=Unit, 11=Primary Max,
        # 12=Reorder Point, 13=Backstock Target, 14=Total Ideal,
        # 15=Order Increment, 16=Primary Supplier, 17=Current Price
        item = {
            "internal_sku":     sku_raw,
            "hd_sku":           clean(col(2)),
            "menards_sku":      clean(col(3)),
            "amazon_sku":       clean(col(4)),
            "idi_code":         clean(col(5)),
            "applied_code":     clean(col(6)),
            "category":         clean(col(7)) or "Standard",
            "name":             name,
            "size":             clean(col(9)),
            "unit":             clean(col(10)) or "EACH",
            "primary_max":      clean_int(col(11)),
            "reorder_point":    clean_int(col(12)),
            "backstock_target": clean_int(col(13)),
            "order_increment":  clean_int(col(15)) or 1,
            "primary_supplier": (clean(col(16)) or "APPLIED").upper(),
            "current_price":    clean_num(col(17)),
        }

        if not item["internal_sku"]:
            cat = (item["category"] or "ST")[:2].upper()
            nm  = (item["name"] or "XXX")[:3].upper().replace(" ", "")
            sz  = (item["size"] or "").upper().replace(" ", "")
            item["internal_sku"] = f"{cat}-{nm}{'-' + sz if sz else ''}"

        items.append(item)

    print(f"Found {len(items)} items to import")

    seen = {}
    for item in items:
        seen[item["internal_sku"]] = item
    items = list(seen.values())
    print(f"{len(items)} unique SKUs")

    # Clear existing items first
    print("Clearing existing items...")
    del_res = requests.delete(
        f"{SUPABASE_URL}/rest/v1/items?id=neq.00000000-0000-0000-0000-000000000000",
        headers=HEADERS,
    )
    if del_res.status_code not in (200, 204):
        print(f"  WARNING clearing table: {del_res.status_code} {del_res.text}")

    BATCH = 50
    imported = 0
    for i in range(0, len(items), BATCH):
        batch = items[i:i+BATCH]
        res = requests.post(
            f"{SUPABASE_URL}/rest/v1/items",
            headers=HEADERS,
            data=json.dumps(batch),
        )
        if res.status_code not in (200, 201):
            print(f"  ERROR on batch {i}: {res.status_code} {res.text}")
            sys.exit(1)
        imported += len(batch)
        print(f"  Imported {imported}/{len(items)}...")

    print(f"\nDone! {imported} items imported into Supabase.")

if __name__ == "__main__":
    main()
