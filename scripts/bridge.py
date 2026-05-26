"""
AWP Inventory – Brother QL-800 Print Bridge
============================================
Run this script on the PC that has the Brother QL-800 connected via USB.
It listens on port 5757 (HTTPS) and accepts label print jobs from the web app.

SETUP (run once):
    pip install flask flask-cors brother_ql pillow python-barcode[images] cryptography

USAGE:
    python scripts/bridge.py

FIRST RUN:
    A self-signed SSL certificate is generated automatically (bridge_cert.pem / bridge_key.pem).
    Each phone/tablet that needs to print must trust this certificate ONCE:
      1. Open Safari on the phone and go to:  https://192.168.40.220:5757/health
      2. Tap "Show Details" → "visit this website" → enter your passcode if prompted.
      3. Go to Settings → General → About → Certificate Trust Settings
         and toggle ON "AWP Print Bridge".
    Desktop Chrome: click "Advanced" → "Proceed to 192.168.40.220 (unsafe)" on first visit.

Then in Vercel → Settings → Environment Variables, set:
    VITE_PRINT_BRIDGE_URL = https://192.168.40.220:5757
"""

import io
import os
import sys
import glob
import datetime
import ipaddress

# ── Windows: help pyusb find the libusb DLL ───────────────────────────────────
if sys.platform == 'win32':
    _patterns = [
        os.path.join(sys.prefix, '**', 'libusb-1.0.dll'),
        os.path.join(sys.prefix, '**', 'libusb*.dll'),
        'C:/Windows/System32/libusb-1.0.dll',
        'C:/Windows/SysWOW64/libusb-1.0.dll',
    ]
    for _pat in _patterns:
        _dlls = glob.glob(_pat, recursive=True)
        if _dlls:
            _dll_dir = os.path.dirname(_dlls[0])
            try:
                os.add_dll_directory(_dll_dir)
                print(f'[bridge] libusb found: {_dlls[0]}')
            except Exception:
                pass
            break

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont

# python-barcode uses the removed ANTIALIAS constant — patch it back
if not hasattr(Image, 'ANTIALIAS'):
    Image.ANTIALIAS = Image.LANCZOS

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
# USB identifier for Brother QL-800.
# Run `python -m brother_ql discover` to find your printer's identifier.
PRINTER_ID    = os.environ.get('PRINTER_ID', 'usb://0x04f9:0x20c0')
LABEL_MODEL   = os.environ.get('LABEL_MODEL', 'QL-800')
LABEL_TAPE    = os.environ.get('LABEL_TAPE', '62')   # 62mm continuous (DK-2205)
PORT          = int(os.environ.get('PORT', 5757))
BRIDGE_IP     = os.environ.get('BRIDGE_IP', '192.168.40.220')

# SSL cert files (generated once in same folder as this script)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CERT_FILE   = os.path.join(_SCRIPT_DIR, 'bridge_cert.pem')
KEY_FILE    = os.path.join(_SCRIPT_DIR, 'bridge_key.pem')

# Label dimensions: 2.4" × 4.5" landscape on 62mm tape at 300 DPI
# Landscape: width=4.5"=1350px (along tape), height=2.4"=720px (tape width)
# We create in landscape then rotate 90° for brother_ql
LABEL_W = 1350   # px along tape length
LABEL_H = 720    # px = tape width (62mm @ 300dpi)
PAD     = 24


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
    Render a 2.4" x 4.5" landscape label matching the original Shelf Labels.lbx layout:
      TOP:    Item Name (large) + Detail/Size
      MIDDLE: 4-row table on left (PRIMARY CAP / BACKSTOCK CAP / SHELF MIN / ORD MULT)
              SKU + Unit + Category on right
      BOTTOM: Full-width Code 39 barcode
    Image is created landscape (1350x720) then rotated 90° for brother_ql.
    """
    name   = (d.get('name')            or '').upper()
    size_s = (d.get('size')            or '').upper()
    sku    = (d.get('sku') or d.get('internal_sku') or 'NOSKU').upper()
    unit   = (d.get('unit')            or 'EACH').upper()
    cat    = (d.get('category')        or '').upper()
    p_max  = str(d.get('primary_max',      0))
    b_cap  = str(d.get('backstock_target', 0))
    s_min  = str(d.get('reorder_point',    0))
    o_mult = str(d.get('order_increment',  1))

    # Fonts (sized for 300 DPI landscape label)
    f_name  = _font(92, bold=True)   # item name
    f_size  = _font(64, bold=True)   # detail/size
    f_lbl   = _font(30, bold=True)   # table row labels
    f_val   = _font(52, bold=True)   # table row values
    f_small = _font(28, bold=True)   # SKU / unit / category

    W, H = LABEL_W, LABEL_H
    img  = Image.new('L', (W, H), color=255)
    draw = ImageDraw.Draw(img)

    # ── Section heights ───────────────────────────────────────────────────────
    top_h    = 200   # item name + size strip
    bottom_h = 150   # barcode strip
    mid_y    = top_h
    mid_h    = H - top_h - bottom_h   # ~370px for table + right info

    # ── TOP: Item Name + Size ─────────────────────────────────────────────────
    # Background
    draw.rectangle([0, 0, W, top_h], fill=255)
    draw.rectangle([0, top_h - 3, W, top_h], fill=0)  # bottom border

    # Item name centered
    nw, nh = _text_size(f_name, name or 'ITEM')
    draw.text(((W - nw) // 2, PAD), name or 'ITEM', font=f_name, fill=0)

    # Size centered below name
    if size_s:
        sw, sh = _text_size(f_size, size_s)
        draw.text(((W - sw) // 2, PAD + nh + 6), size_s, font=f_size, fill=60)

    # ── MIDDLE: Table (left) + Info (right) ───────────────────────────────────
    table_x  = PAD
    table_w  = 480   # left table width
    info_x   = table_x + table_w + PAD
    info_w   = W - info_x - PAD

    rows = [
        ('PRIMARY CAP',   p_max),
        ('BACKSTOCK CAP', b_cap),
        ('SHELF MIN',     s_min),
        ('ORD MULT',      o_mult),
    ]
    row_h = mid_h // len(rows)
    lbl_col_w = 310   # label column width
    val_col_w = table_w - lbl_col_w

    for ri, (lbl, val) in enumerate(rows):
        ry0 = mid_y + ri * row_h
        ry1 = ry0 + row_h
        # Row border
        draw.rectangle([table_x, ry0, table_x + table_w, ry1], outline=0, width=2)
        # Alternating row background
        if ri % 2 == 0:
            draw.rectangle([table_x + 2, ry0 + 2, table_x + table_w - 2, ry1 - 2], fill=240)
        # Label (right-aligned in label column)
        lw, lh = _text_size(f_lbl, lbl)
        draw.text((table_x + lbl_col_w - lw - 8, ry0 + (row_h - lh) // 2), lbl, font=f_lbl, fill=0)
        # Divider between label and value
        draw.line([table_x + lbl_col_w, ry0, table_x + lbl_col_w, ry1], fill=0, width=2)
        # Value (centered in value column)
        vw, vh = _text_size(f_val, val)
        draw.text((table_x + lbl_col_w + (val_col_w - vw) // 2, ry0 + (row_h - vh) // 2), val, font=f_val, fill=0)

    # Right side: SKU, Unit, Category
    iy = mid_y + PAD
    for label_txt, value_txt in [('SKU', sku), ('UNIT', unit), ('CATEGORY', cat)]:
        if not value_txt:
            continue
        lw, lh = _text_size(f_small, label_txt + ':')
        draw.text((info_x, iy), label_txt + ':', font=f_small, fill=120)
        vw, vh = _text_size(f_val, value_txt)
        # Value on same line if it fits, else next line
        if lw + 12 + vw <= info_w:
            draw.text((info_x + lw + 12, iy + (lh - vh) // 2), value_txt, font=f_val, fill=0)
            iy += max(lh, vh) + 16
        else:
            iy += lh + 4
            draw.text((info_x, iy), value_txt, font=f_val, fill=0)
            iy += vh + 16

    # ── BOTTOM: Code 39 barcode ───────────────────────────────────────────────
    bc_y = H - bottom_h
    draw.rectangle([0, bc_y, W, bc_y + 2], fill=0)

    try:
        import barcode as bc_lib
        from barcode.writer import ImageWriter
        code = bc_lib.get('code39', sku, writer=ImageWriter())
        buf  = io.BytesIO()
        code.write(buf, options={
            'module_width': 0.9, 'module_height': 10.0,
            'font_size': 6, 'text_distance': 2.5,
            'background': 'white', 'foreground': 'black',
            'quiet_zone': 2.5, 'write_text': True,
        })
        buf.seek(0)
        bc_raw = Image.open(buf).convert('L')
        bc_img = bc_raw.resize((W - PAD * 2, bottom_h - 12), Image.LANCZOS)
        img.paste(bc_img, (PAD, bc_y + 8))
    except Exception as e:
        print(f'  [bridge] barcode skipped: {e}')
        draw.text((PAD, bc_y + 10), f'*{sku}*', font=f_small, fill=0)

    # Rotate landscape→portrait for brother_ql (tape width becomes image width)
    img = img.rotate(90, expand=True)

    # Tag with 300 DPI so brother_ql doesn't rescale
    buf = io.BytesIO()
    img.save(buf, format='PNG', dpi=(300, 300))
    buf.seek(0)
    return Image.open(buf)


# ── SSL certificate (generated once, reused on every restart) ─────────────────
def _ensure_ssl_cert():
    """Generate a self-signed cert if one doesn't exist yet."""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        print(f'  [bridge] SSL cert found: {CERT_FILE}')
        return
    print('  [bridge] Generating self-signed SSL certificate (one-time)...')
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME,          u'AWP Print Bridge'),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME,    u'All Weather Plus'),
        ])
        san = x509.SubjectAlternativeName([
            x509.IPAddress(ipaddress.IPv4Address(BRIDGE_IP)),
            x509.IPAddress(ipaddress.IPv4Address('127.0.0.1')),
            x509.DNSName(u'localhost'),
        ])
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=820))  # iOS requires ≤825 days
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True,
                content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False,
            ), critical=True)
            .add_extension(x509.ExtendedKeyUsage([
                x509.ExtendedKeyUsageOID.SERVER_AUTH,
                x509.ExtendedKeyUsageOID.CLIENT_AUTH,
            ]), critical=False)
            .add_extension(san, critical=False)
            .sign(key, hashes.SHA256())
        )
        with open(CERT_FILE, 'wb') as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(KEY_FILE, 'wb') as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        print(f'  [bridge] SSL cert written: {CERT_FILE}')
    except ImportError:
        print('  [bridge] WARNING: cryptography package not installed.')
        print('  [bridge] Run:  pip install cryptography')
        print('  [bridge] Falling back to HTTP (mobile devices may not work).')


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': LABEL_MODEL, 'tape': LABEL_TAPE})


@app.route('/cert', methods=['GET'])
def download_cert():
    """Serve a .mobileconfig profile so iOS installs the cert properly."""
    if not os.path.exists(CERT_FILE):
        return 'Certificate not found — bridge may be running in HTTP mode.', 404

    # Read cert and convert to DER base64 for the mobileconfig payload
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization
        import base64, uuid

        with open(CERT_FILE, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())
        cert_der_b64 = base64.b64encode(
            cert.public_bytes(serialization.Encoding.DER)
        ).decode('ascii')

        mobileconfig = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>AWP_Print_Bridge.cer</string>
            <key>PayloadContent</key>
            <data>{cert_der_b64}</data>
            <key>PayloadDescription</key>
            <string>Trusts the AWP Print Bridge HTTPS certificate</string>
            <key>PayloadDisplayName</key>
            <string>AWP Print Bridge</string>
            <key>PayloadIdentifier</key>
            <string>com.awp.printbridge.cert</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>{uuid.uuid4()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Trusts the AWP Print Bridge SSL certificate for label printing</string>
    <key>PayloadDisplayName</key>
    <string>AWP Print Bridge</string>
    <key>PayloadIdentifier</key>
    <string>com.awp.printbridge</string>
    <key>PayloadOrganization</key>
    <string>All Weather Plus</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{uuid.uuid4()}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>'''

        buf = io.BytesIO(mobileconfig.encode('utf-8'))
        buf.seek(0)
        return send_file(
            buf,
            mimetype='application/x-apple-aspen-config',
            as_attachment=True,
            download_name='AWP_Print_Bridge.mobileconfig',
        )
    except Exception as e:
        return f'Error generating profile: {e}', 500


@app.route('/discover', methods=['GET'])
def discover_printers():
    """List all detected printers — open http://192.168.40.220:5757/discover in a browser to check."""
    from brother_ql.backends.helpers import discover
    results = {}
    for backend in ('pyusb', 'linux_kernel'):
        try:
            found = discover(backend_identifier=backend)
            results[backend] = [p['identifier'] for p in found]
        except Exception as e:
            results[backend] = f'error: {e}'
    return jsonify(results)


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


def _detect_printer():
    """Auto-detect the QL-800 USB identifier. Returns (identifier, backend)."""
    from brother_ql.backends.helpers import discover
    for backend in ('pyusb', 'linux_kernel'):
        try:
            printers = discover(backend_identifier=backend)
            print(f'  [bridge] {backend} found: {printers}')
            if printers:
                found = printers[0]['identifier']
                print(f'  [bridge] using printer: {found} (backend: {backend})')
                return found, backend
        except Exception as e:
            print(f'  [bridge] {backend} unavailable: {e}')

    # Last resort — try the known QL-800 USB vendor/product ID directly
    print('  [bridge] falling back to known QL-800 USB ID: usb://0x04f9:0x20c0')
    return 'usb://0x04f9:0x20c0', 'pyusb'


def _make_instructions(img: Image.Image) -> bytes:
    from brother_ql.conversion import convert
    from brother_ql.raster import BrotherQLRaster
    qlr = BrotherQLRaster(LABEL_MODEL)
    return convert(
        qlr=qlr,
        images=[img],
        label=LABEL_TAPE,
        rotate='0',   # already rotated in render_label
        threshold=70,
        dither=False,
        compress=False,
        red=False,
        dpi_600=False,
        hq=True,
        cut=True,
    )


def _send_via_windows_spooler(instructions: bytes):
    """Send raw raster instructions through the Windows print spooler."""
    import win32print
    # Find the Brother QL-800 in installed Windows printers
    all_printers = [p[2] for p in win32print.EnumPrinters(
        win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    )]
    print(f'  [bridge] Windows printers: {all_printers}')
    ql = next((p for p in all_printers if 'QL-800' in p or 'QL800' in p), None)
    if not ql:
        # Try any Brother printer
        ql = next((p for p in all_printers if 'Brother' in p), None)
    if not ql:
        raise RuntimeError(f'Brother QL-800 not found in Windows printers. Found: {all_printers}')
    print(f'  [bridge] printing to Windows printer: {ql}')
    hp = win32print.OpenPrinter(ql)
    try:
        win32print.StartDocPrinter(hp, 1, ('AWP Label', None, 'RAW'))
        win32print.StartPagePrinter(hp)
        win32print.WritePrinter(hp, bytes(instructions))
        win32print.EndPagePrinter(hp)
        win32print.EndDocPrinter(hp)
    finally:
        win32print.ClosePrinter(hp)


def _send_to_printer(img: Image.Image):
    instructions = _make_instructions(img)

    # Try Windows spooler first (no libusb needed)
    if sys.platform == 'win32':
        try:
            _send_via_windows_spooler(instructions)
            return
        except ImportError:
            print('  [bridge] pywin32 not installed, falling back to pyusb')
        except Exception as e:
            print(f'  [bridge] Windows spooler failed: {e} — trying pyusb')

    # Fall back to pyusb
    from brother_ql.backends.helpers import send
    printer_id, backend = _detect_printer()
    send(
        instructions=instructions,
        printer_identifier=printer_id,
        backend_identifier=backend,
        blocking=True,
    )


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    _ensure_ssl_cert()

    ssl_ctx = None
    protocol = 'http'
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        ssl_ctx = (CERT_FILE, KEY_FILE)
        protocol = 'https'

    print('=' * 60)
    print('  AWP Inventory – Brother QL-800 Print Bridge')
    print('=' * 60)
    print(f'  Printer  : {PRINTER_ID}')
    print(f'  Model    : {LABEL_MODEL}')
    print(f'  Tape     : {LABEL_TAPE}mm continuous (DK-2205)')
    print(f'  Port     : {PORT}')
    print(f'  Protocol : {protocol.upper()}')
    print()
    print(f'  Bridge URL: {protocol}://{BRIDGE_IP}:{PORT}')
    print()
    if protocol == 'https':
        print('  FIRST-TIME PHONE SETUP (one-time per device):')
        print(f'    1. Open Safari and go to: https://{BRIDGE_IP}:{PORT}/health')
        print('    2. Tap "Show Details" → "visit this website"')
        print('    3. Settings → General → About → Certificate Trust Settings')
        print('       → Enable "AWP Print Bridge"')
    print('=' * 60)
    app.run(host='0.0.0.0', port=PORT, debug=False, ssl_context=ssl_ctx)
