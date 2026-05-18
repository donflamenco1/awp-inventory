"""
AWP Inventory — Brother QL-800 Print Bridge
Runs on your PC. Receives label jobs from the web app and prints to the QL-800 via USB.

Setup (one time):
  pip install flask brother_ql pillow

Run:
  python print-bridge/bridge.py

The bridge listens on port 5757. Keep it running while using the Labels screen.
"""

import sys
import json
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    from brother_ql.conversion import convert
    from brother_ql.backends.helpers import send
    from brother_ql.raster import BrotherQLRaster
    from PIL import Image, ImageDraw, ImageFont
    BROTHER_AVAILABLE = True
except ImportError:
    BROTHER_AVAILABLE = False
    print("WARNING: brother_ql not installed — will simulate printing")
    print("Run: pip install brother_ql pillow flask flask-cors")

app = Flask(__name__)
CORS(app)  # Allow requests from Vercel / localhost

# ── Config ──────────────────────────────────────────────────────────────────
PRINTER_MODEL  = "QL-800"
LABEL_SIZE     = "62"          # 62mm continuous tape
# On Windows, find your printer ID with: python -m brother_ql discover
PRINTER_IDENT  = "usb://0x04f9:0x209b"   # QL-800 USB VID:PID (common default)


def build_label_image(label: dict) -> "Image":
    """Render one label as a PIL Image sized for 62mm tape (~696px wide)."""
    W, H = 696, 270
    img  = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    try:
        font_lg = ImageFont.truetype("arial.ttf", 60)
        font_md = ImageFont.truetype("arial.ttf", 36)
        font_sm = ImageFont.truetype("arial.ttf", 24)
        font_xs = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font_lg = font_md = font_sm = font_xs = ImageFont.load_default()

    name = str(label.get("name", "")).upper()
    size = str(label.get("size", ""))
    sku  = str(label.get("sku", label.get("internal_sku", "")))
    unit = str(label.get("unit", ""))

    pmax  = str(label.get("primary_max", ""))
    bstk  = str(label.get("backstock_target", ""))
    smin  = str(label.get("reorder_point", ""))
    omult = str(label.get("order_increment", ""))

    # Item name + size
    draw.text((10, 8),  name, fill="black", font=font_lg)
    draw.text((10, 72), size, fill="#444444", font=font_md)

    # SKU top-right
    draw.text((W - 10, 8),  sku,  fill="#555555", font=font_sm, anchor="ra")

    # Divider
    draw.line([(10, 120), (W - 10, 120)], fill="black", width=2)

    # Data table: 4 columns
    cols = ["PRIMARY CAP", "BACKSTOCK CAP", "SHELF MIN", "ORD MULT"]
    vals = [pmax, bstk, smin, omult]
    col_w = (W - 20) // 4
    for i, (col, val) in enumerate(zip(cols, vals)):
        x = 10 + i * col_w
        draw.rectangle([x, 130, x + col_w, 200], outline="black", width=1)
        draw.text((x + col_w // 2, 138), col, fill="#555555", font=font_xs, anchor="mt")
        draw.text((x + col_w // 2, 163), val, fill="black",   font=font_md, anchor="mt")

    # Unit
    draw.text((W - 10, 210), f"Unit: {unit}", fill="#888888", font=font_xs, anchor="ra")

    return img


def print_label(label: dict) -> bool:
    """Print one label to the QL-800."""
    if not BROTHER_AVAILABLE:
        print(f"[SIMULATE] Would print: {label.get('name')} {label.get('size')} (SKU: {label.get('sku')})")
        return True

    try:
        img = build_label_image(label)
        qlr = BrotherQLRaster(PRINTER_MODEL)
        convert(qlr=qlr, images=[img], label=LABEL_SIZE, cut=True)
        send(instructions=qlr.data, printer_identifier=PRINTER_IDENT,
             backend_identifier="pyusb", blocking=True)
        print(f"[PRINTED] {label.get('name')} {label.get('size')}")
        return True
    except Exception as e:
        print(f"[ERROR] {e}")
        return False


@app.route("/print", methods=["POST"])
def print_labels():
    data = request.get_json(force=True)
    labels = data.get("labels", [])
    if not labels:
        return jsonify({"error": "No labels provided"}), 400

    printed = 0
    errors  = []
    for label in labels:
        ok = print_label(label)
        if ok: printed += 1
        else:  errors.append(label.get("sku", "unknown"))

    return jsonify({"printed": printed, "errors": errors})


@app.route("/status")
def status():
    return jsonify({
        "status": "ok",
        "brother_ql": BROTHER_AVAILABLE,
        "printer": PRINTER_MODEL,
        "ident": PRINTER_IDENT,
    })


if __name__ == "__main__":
    print("=" * 50)
    print("  AWP Inventory — Print Bridge")
    print(f"  Listening on http://localhost:5757")
    print(f"  Printer: {PRINTER_MODEL} at {PRINTER_IDENT}")
    print(f"  brother_ql installed: {BROTHER_AVAILABLE}")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5757, debug=False)
