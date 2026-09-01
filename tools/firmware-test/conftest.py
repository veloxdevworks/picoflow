"""CPython path setup for the CircuitPython runtime (no hardware).

Do not put `assets/firmware/runtime` on sys.path — `code.py` would shadow
the stdlib `code` module that pdb imports.
"""

import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "assets" / "firmware" / "runtime"
LIB = RUNTIME / "lib"
GOLDEN_SEQUENCE = ROOT / "crates" / "picoflow-core" / "tests" / "fixtures" / "sequence_v1.json"
DEFAULT_SEQUENCE = RUNTIME / "sequence.default.json"

if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))


def _stub(name, **attrs):
    mod = sys.modules.get(name)
    if mod is None:
        mod = ModuleType(name)
        sys.modules[name] = mod
    for key, value in attrs.items():
        setattr(mod, key, value)
    return mod


_stub("micropython", const=lambda x: x)

class _UsbHidDevice:
    KEYBOARD = None
    MOUSE = None
    CONSUMER_CONTROL = None

    def __init__(
        self,
        report_descriptor=None,
        usage_page=None,
        usage=None,
        report_ids=(),
        in_report_lengths=(),
        out_report_lengths=(),
    ):
        self.report_descriptor = report_descriptor
        self.usage_page = usage_page
        self.usage = usage
        self.report_ids = report_ids
        self.in_report_lengths = in_report_lengths
        self.out_report_lengths = out_report_lengths


_stub("usb_hid", Device=_UsbHidDevice, devices=(), enable=lambda *a, **k: None)
