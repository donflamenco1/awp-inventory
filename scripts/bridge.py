"""
AWP Inventory – Brother QL-800 Print Bridge
============================================
Run this script on the PC that has the Brother QL-800 connected via USB.
It listens on port 5757 and accepts label print jobs from the web app.

SETUP (run once):
    pip install flask flask-cors brother_ql pillow python-barcode[images]

USAGE:
    python scripts/bridge.py

Then in Vercel → Settings → Environment Variables, set:
    VITE_PRINT_BRIDGE_URL = http://<this-pc-ip>:5757

FIND YOUR PC IP:
    Open Command Prompt and run:  ipconfig
    Look for "IPv4 Address" under your active network adapter.
"""

import io
import os
import sys
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
# USB identifier for Brother QL-800.
# Run `python -m brother_ql discover` to find your printer's identifier.
PRINTER_ID    = os.environ.get('PRINTER_ID', 'usb://0x04f9:0x20c0')
LABEL_MODEL   = os.environ.get('LABEL_MODEL', 'QL-800')
LABEL_TAPE    = os.environ.get('LABEL_TAPE', '62')   # 62mm continuous (DK-2205)
PORT          = int(os.environ.get('PORT', 5757))

# 62mm tape at 300 DPI ≈ 696px wide
TAPE_W_PX = 696
PAD       = 20


# ── Font helpers ──────────────────────────────────────────────────────────────
def _font(size, bold=False):
    windows_bold   = ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/calibrib.ttf']
    windows_normal = ['C:/Windows/Fonts/arial.ttf',   'C:/Windows/Fonts/calibri.ttf']
    linux_bold     = ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']
    linux_normal   = ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']
    candidates = (windows_bold + linux_bold) if bold else (windows_normal + linux_normal)
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def _text_size(font, text):
    bb = font.getbbox(text)
    return bb[2] - bb[0], bb[3] - bb[1]


# ── Label renderer ────────────────────────────────────────────────────────────
def render_label(d: dict) -> Image.Image:
    """
    Render one label as a grayscale PIL Image sized for 62mm QL-800 tape.
    Layout (top to bottom):
      • Header:  ITEM NAME (large bold) + size + SKU (right-aligned)
      • Divider line
      • Barcode (Code 128 of the SKU)
      • Divider line
      • 4-column data table: PRIMARY CAP | BACKSTOCK CAP | SHELF MIN | ORD MULT
    """
    name    = (d.get('name')             or '').upper()
    size_s  = (d.get('size')             or '').upper()
    sku     = (d.get('sku') or d.get('internal_sku') or 'NOSKU').upper()
    p_max   = str(d.get('primary_max',       0))
    b_cap   = str(d.get('backstock_target',  0))
    s_min   = str(d.get('reorder_point',     0))
    o_mult  = str(d.get('order_increment',   1))

    # Fonts
    fn = _font(78, bold=True)   # item name
    fs = _font(44)              # size subtitle
    fk = _font(34)              # sku
    fh = _font(26)              # table header
    fv = _font(54, bold=True)   # table value

    # ── Barcode image ─────────────────────────────────────────────────────────
    bc_img = None
    try:
        import barcode as bc_lib
        from barcode.writer import ImageWriter
        code = bc_lib.get('code128', sku, writer=ImageWriter())
        buf  = io.BytesIO()
        code.write(buf, options={
            'module_width': 0.55, 'module_height': 8.0,
            'font_size': 5, 'text_distance': 2.0,
            'background': 'white', 'foreground': 'black',
            'quiet_zone': 2.0, 'write_text': True,
        })
        buf.seek(0)
        raw = Image.open(buf).convert('L')
        bc_img = raw.resize((TAPE_W_PX - PAD * 2, 96), Image.LANCZOS)
    except Exception as e:
        print(f'  [bridge] barcode generation skipped: {e}')

    # ── Measure sections ──────────────────────────────────────────────────────
    nw, nh = _text_size(fn, name or 'ITEM')
    sw, sh = _text_size(fs, size_s) if size_s else (0, 0)
    kw, kh = _text_size(fk, sku)

    header_h  = PAD + nh + (sh + 6 if size_s else 0) + kh + PAD
    div_h     = 3
    bc_h      = (96 + PAD * 2) if bc_img else 0
    table_h   = 44 + 60 + PAD   # header row + value row + bottom pad
    total_h   = header_h + div_h + bc_h + div_h + table_h

    img  = Image.new('L', (TAPE_W_PX, total_h), color=255)
    draw = ImageDraw.Draw(img)

    # ── Header ────────────────────────────────────────────────────────────────
    y = PAD
    draw.text((PAD, y), name or 'ITEM', font=fn, fill=0)
    y += nh + 4
    if size_s:
        draw.text((PAD, y), size_s, font=fs, fill=80)
        y += sh + 6
    # SKU right-aligned on same line as name (top-right)
    draw.text((TAPE_W_PX - PAD - kw, PAD), sku, font=fk, fill=120)
    y += kh + PAD

    # ── Divider ───────────────────────────────────────────────────────────────
    draw.rectangle([PAD, y, TAPE_W_PX - PAD, y + div_h], fill=0)
    y += div_h + PAD

    # ── Barcode ───────────────────────────────────────────────────────────────
    if bc_img:
        img.paste(bc_img, (PAD, y))
        y += 96 + PAD
        draw.rectangle([PAD, y, TAPE_W_PX - PAD, y + div_h], fill=0)
        y += div_h + PAD

    # ── 4-column data table ───────────────────────────────────────────────────
    cols     = [('PRIMARY\nCAP', p_max), ('BACKSTOCK\nCAP', b_cap),
                ('SHELF\nMIN',   s_min), ('ORD\nMULT',      o_mult)]
    col_w    = (TAPE_W_PX - PAD * 2) // 4
    hdr_row  = 44
    val_row  = 60

    for ci, (hdr, val) in enumerate(cols):
        x0 = PAD + ci * col_w
        x1 = x0 + col_w
        # Outer border
        draw.rectangle([x0, y, x1, y + hdr_row + val_row], outline=0, width=2)
        # Header background
        draw.rectangle([x0 + 2, y + 2, x1 - 2, y + hdr_row - 2], fill=220)
        # Header text (2 lines, centered)
        for li, line in enumerate(hdr.split('\n')):
            lw, lh = _text_size(fh, line)
            draw.text((x0 + (col_w - lw) // 2, y + 4 + li * (lh + 2)), line, font=fh, fill=0)
        # Value (centered)
        vw, vh = _text_size(fv, val)
        draw.text((x0 + (col_w - vw) // 2, y + hdr_row + (val_row - vh) // 2), val, font=fv, fill=0)

    return img


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': LABEL_MODEL, 'tape': LABEL_TAPE})


@app.route('/print', methods=['POST'])
def print_labels():
    data   = request.get_json(force=True)
    labels = data.get('labels', [])
    if not labels:
        return jsonify({'error': 'No labels provided'}), 400

    printed = 0
    errors  = []

    for label_data in labels:
        copies = int(label_data.get('_copies', 1))
        for _ in range(copies):
            try:
                img = render_label(label_data)
                _send_to_printer(img)
                printed += 1
            except Exception as e:
                errors.append({'label': label_data.get('name'), 'error': str(e)})
                print(f'  [bridge] print error: {e}')

    return jsonify({'printed': printed, 'errors': errors})


@app.route('/preview', methods=['POST'])
def preview_label():
    """Return the rendered label as a PNG so the browser can show a real preview."""
    data = request.get_json(force=True)
    img  = render_label(data)
    buf  = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')


def _send_to_printer(img: Image.Image):
    from brother_ql.conversion import convert
    from brother_ql.backends.helpers import send
    from brother_ql.raster import BrotherQLRaster

    qlr = BrotherQLRaster(LABEL_MODEL)
    instructions = convert(
        qlr=qlr,
        images=[img],
        label=LABEL_TAPE,
        rotate='0',
        threshold=70,
        dither=False,
        compress=False,
        red=False,
        dpi_600=False,
        hq=True,
        cut=True,
    )
    send(
        instructions=instructions,
        printer_identifier=PRINTER_ID,
        backend_identifier='pyusb',
        blocking=True,
    )


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('=' * 60)
    print('  AWP Inventory – Brother QL-800 Print Bridge')
    print('=' * 60)
    print(f'  Printer : {PRINTER_ID}')
    print(f'  Model   : {LABEL_MODEL}')
    print(f'  Tape    : {LABEL_TAPE}mm continuous (DK-2205)')
    print(f'  Port    : {PORT}')
    print()
    print('  To find your PC IP address, open Command Prompt and run:')
    print('    ipconfig')
    print()
    print('  Bridge URL (already configured in app):')
    print(f'    http://192.168.40.220:{PORT}')
    print('=' * 60)
    app.run(host='0.0.0.0', port=PORT, debug=False)
