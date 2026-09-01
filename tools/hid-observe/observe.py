#!/usr/bin/env python3
"""Host HID observer for PicoFlow. Split IN reports by report ID 1/2/3."""

from __future__ import annotations

import argparse
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "firmware", "runtime", "lib"))
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

from picoflow.descriptors import ABS_MOUSE_REPORT_DESCRIPTOR
from picoflow.digitizer import (
    DIGITIZER_REPORT_DESCRIPTOR,
    IN_RANGE,
    IN_REPORT_LENGTH as DIGITIZER_IN_LEN,
    TIP_SWITCH,
)

# CircuitPython raspberry_pi_pico 10.3.0 UF2 (bytes 9A 23 F4 80).
ADAFRUIT_VID = 0x239A
PICO_PID = 0x80F4

# CircuitPython usb_hid.Device.KEYBOARD (not a PicoFlow descriptor).
KEYBOARD_REPORT_ID = 1
KEYBOARD_IN_LEN = 8
ABS_MOUSE_IN_LEN = 5


def report_id_from_descriptor(descriptor):
    data = bytes(descriptor)
    idx = data.find(b"\x85")
    if idx < 0 or idx + 1 >= len(data):
        raise ValueError("descriptor missing report id")
    return data[idx + 1]


ABS_MOUSE_REPORT_ID = report_id_from_descriptor(ABS_MOUSE_REPORT_DESCRIPTOR)
DIGITIZER_REPORT_ID = report_id_from_descriptor(DIGITIZER_REPORT_DESCRIPTOR)

_KEYCODE_NAMES = None


def _keycode_names():
    global _KEYCODE_NAMES
    if _KEYCODE_NAMES is None:
        from adafruit_hid.keycode import Keycode

        names = {}
        for name in dir(Keycode):
            if name.startswith("_"):
                continue
            value = getattr(Keycode, name)
            if isinstance(value, int) and value not in names:
                names[value] = name
        _KEYCODE_NAMES = names
    return _KEYCODE_NAMES


def _u16(lo, hi):
    return int(lo) | (int(hi) << 8)


def _payload(data, length):
    body = bytes(data)
    if len(body) < length:
        body = body + bytes(length - len(body))
    return body[:length]


def decode_key(payload):
    body = _payload(payload, KEYBOARD_IN_LEN)
    modifiers = body[0]
    names = _keycode_names()
    keys = []
    for code in body[2:8]:
        if not code:
            continue
        keys.append(names.get(code, "0x%02x" % code))
    keys_s = ",".join(keys) if keys else "-"
    return "id=%d key modifiers=0x%02x keys=%s" % (KEYBOARD_REPORT_ID, modifiers, keys_s)


def decode_mouse(payload):
    body = _payload(payload, ABS_MOUSE_IN_LEN)
    buttons = body[0]
    x = _u16(body[1], body[2])
    y = _u16(body[3], body[4])
    return "id=%d move(%d,%d) btn=0x%02x" % (ABS_MOUSE_REPORT_ID, x, y, buttons)


def decode_digitizer(payload):
    body = _payload(payload, DIGITIZER_IN_LEN)
    flags = body[0]
    tip = 1 if flags & TIP_SWITCH else 0
    in_range = 1 if flags & IN_RANGE else 0
    x = _u16(body[1], body[2])
    y = _u16(body[3], body[4])
    return "id=%d move(%d,%d) tip=%d in_range=%d" % (
        DIGITIZER_REPORT_ID,
        x,
        y,
        tip,
        in_range,
    )


def decode_report(data):
    """Frame an IN report by report ID using the shipped descriptors."""
    if not data:
        return None
    raw = bytes(data)
    report_id = raw[0]
    payload = raw[1:]
    if report_id == KEYBOARD_REPORT_ID:
        return decode_key(payload)
    if report_id == ABS_MOUSE_REPORT_ID:
        return decode_mouse(payload)
    if report_id == DIGITIZER_REPORT_ID:
        return decode_digitizer(payload)
    return "id=%d unknown %s" % (report_id, payload.hex() or "-")


def matching_devices(infos, vid=ADAFRUIT_VID, pid=PICO_PID):
    matched = []
    for info in infos or ():
        if info.get("vendor_id") == vid and info.get("product_id") == pid:
            matched.append(info)
    return matched


def _format_info(info):
    path = info.get("path")
    if isinstance(path, bytes):
        path = path.decode("utf-8", "replace")
    return "path=%s usage_page=0x%04x usage=0x%04x product=%s" % (
        path,
        int(info.get("usage_page") or 0),
        int(info.get("usage") or 0),
        info.get("product_string") or "",
    )


def _import_hid():
    try:
        import hid
    except ImportError:
        print("hid-observe requires hidapi: pip install hidapi", file=sys.stderr)
        return None
    return hid


def observe(vid=ADAFRUIT_VID, pid=PICO_PID, list_only=False):
    hid = _import_hid()
    if hid is None:
        return 1
    found = matching_devices(hid.enumerate(), vid=vid, pid=pid)
    if not found:
        print("no Pico HID (vid=0x%04X pid=0x%04X)" % (vid, pid), file=sys.stderr)
        return 1
    for info in found:
        print(_format_info(info), flush=True)
    if list_only:
        return 0

    opened = []
    try:
        for info in found:
            device = hid.device()
            device.open_path(info["path"])
            device.set_nonblocking(True)
            opened.append(device)
        while True:
            for device in opened:
                data = device.read(64)
                if not data:
                    continue
                line = decode_report(data)
                if line:
                    print(line, flush=True)
            time.sleep(0.001)
    except KeyboardInterrupt:
        return 0
    finally:
        for device in opened:
            try:
                device.close()
            except Exception:
                pass
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Observe PicoFlow HID IN reports framed by report ID 1/2/3."
    )
    parser.add_argument(
        "--vid",
        type=lambda s: int(s, 0),
        default=ADAFRUIT_VID,
        help="USB VID (default 0x239A)",
    )
    parser.add_argument(
        "--pid",
        type=lambda s: int(s, 0),
        default=PICO_PID,
        help="USB PID (default 0x80F4, CircuitPython Pico)",
    )
    parser.add_argument("--list", action="store_true", help="list matching devices and exit")
    args = parser.parse_args(argv)
    return observe(vid=args.vid, pid=args.pid, list_only=args.list)


if __name__ == "__main__":
    sys.exit(main())
