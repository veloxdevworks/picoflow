# Digitizer HID device (usage page 0x0D, Tip Switch + In Range, report ID 3).
# Replacement pointing device — not additive with the absolute mouse.

USAGE_PAGE = 0x0D
USAGE = 0x04  # Touch Screen
REPORT_ID = 3
IN_REPORT_LENGTH = 5  # tip+range byte + 2 + 2 XY (report ID is not counted)

TIP_SWITCH = 0x01
IN_RANGE = 0x02
CONTACT = TIP_SWITCH | IN_RANGE  # v1: both bits follow contact

HID_MAX = 32767

DIGITIZER_REPORT_DESCRIPTOR = bytes((
    0x05, 0x0D,        # Usage Page (Digitizer)
    0x09, 0x04,        # Usage (Touch Screen)
    0xA1, 0x01,        # Collection (Application)
    0x85, 0x03,        #   Report ID (3)
    0x09, 0x22,        #   Usage (Finger)
    0xA1, 0x02,        #   Collection (Logical)
    0x09, 0x42,        #     Usage (Tip Switch)
    0x09, 0x32,        #     Usage (In Range)
    0x15, 0x00,        #     Logical Minimum (0)
    0x25, 0x01,        #     Logical Maximum (1)
    0x75, 0x01,        #     Report Size (1)
    0x95, 0x02,        #     Report Count (2)
    0x81, 0x02,        #     Input (Data,Var,Abs)
    0x95, 0x01,        #     Report Count (1)
    0x75, 0x06,        #     Report Size (6)
    0x81, 0x03,        #     Input (Const)
    0x05, 0x01,        #     Usage Page (Generic Desktop)
    0x09, 0x30,        #     Usage (X)
    0x09, 0x31,        #     Usage (Y)
    0x16, 0x00, 0x00,  #     Logical Minimum (0)
    0x26, 0xFF, 0x7F,  #     Logical Maximum (32767)
    0x75, 0x10,        #     Report Size (16)
    0x95, 0x02,        #     Report Count (2)
    0x81, 0x02,        #     Input (Data,Var,Abs)
    0xC0,
    0xC0,
))


def make_digitizer_device(device_cls):
    """usb_hid.Device kwargs; in_report_lengths matches the 5-byte IN payload."""
    return device_cls(
        report_descriptor=DIGITIZER_REPORT_DESCRIPTOR,
        usage_page=USAGE_PAGE,
        usage=USAGE,
        report_ids=(REPORT_ID,),
        in_report_lengths=(IN_REPORT_LENGTH,),
        out_report_lengths=(0,),
    )


def _build_digitizer():
    try:
        import usb_hid
    except ImportError:
        return None
    return make_digitizer_device(usb_hid.Device)


DIGITIZER = _build_digitizer()


def _clamp(value, lo, hi):
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


class Digitizer:
    """5-byte digitizer: [tip|in_range, x_lo, x_hi, y_lo, y_hi]. Player-compatible."""

    def __init__(self, devices):
        from adafruit_hid import find_device

        self._device = find_device(devices, usage_page=USAGE_PAGE, usage=USAGE)
        self.report = bytearray(IN_REPORT_LENGTH)

    def move(self, x, y):
        x = int(_clamp(int(x), 0, HID_MAX))
        y = int(_clamp(int(y), 0, HID_MAX))
        self.report[1] = x & 0xFF
        self.report[2] = (x >> 8) & 0xFF
        self.report[3] = y & 0xFF
        self.report[4] = (y >> 8) & 0xFF
        self._device.send_report(self.report)

    def press(self, buttons):
        if buttons:
            self.report[0] = CONTACT
        self._device.send_report(self.report)

    def release(self, buttons):
        self.report[0] = 0
        self._device.send_report(self.report)

    def release_all(self):
        self.report[0] = 0
        self._device.send_report(self.report)

    def click(self, buttons):
        self.press(buttons)
        self.release(buttons)
