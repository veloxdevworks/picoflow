# Absolute mouse HID device (report ID 2, 16-bit, logical 0–32767).
# Starting point: Neradoc / bitboy85; no wheel byte (v1 non-goal).

ABS_MOUSE_REPORT_DESCRIPTOR = bytes((
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x02,        # Usage (Mouse)
    0xA1, 0x01,        # Collection (Application)
    0x09, 0x01,        #   Usage (Pointer)
    0xA1, 0x00,        #   Collection (Physical)
    0x85, 0x02,        #     Report ID (2)
    0x05, 0x09,        #     Usage Page (Button)
    0x19, 0x01,        #     Usage Minimum (1)
    0x29, 0x03,        #     Usage Maximum (3)
    0x15, 0x00,        #     Logical Minimum (0)
    0x25, 0x01,        #     Logical Maximum (1)
    0x95, 0x03,        #     Report Count (3)
    0x75, 0x01,        #     Report Size (1)
    0x81, 0x02,        #     Input (Data,Var,Abs)
    0x95, 0x01,        #     Report Count (1)
    0x75, 0x05,        #     Report Size (5)
    0x81, 0x03,        #     Input (Const,Var,Abs)
    0x05, 0x01,        #     Usage Page (Generic Desktop)
    0x09, 0x30,        #     Usage (X)
    0x09, 0x31,        #     Usage (Y)
    0x16, 0x00, 0x00,  #     Logical Minimum (0)
    0x26, 0xFF, 0x7F,  #     Logical Maximum (32767)
    0x75, 0x10,        #     Report Size (16)
    0x95, 0x02,        #     Report Count (2)
    0x81, 0x02,        #     Input (Data,Var,Abs)  # NOT 0x06 relative
    0xC0,              #   End Collection
    0xC0,              # End Collection
))


def _build_absolute_mouse():
    try:
        import usb_hid
    except ImportError:
        return None
    return usb_hid.Device(
        report_descriptor=ABS_MOUSE_REPORT_DESCRIPTOR,
        usage_page=0x01,
        usage=0x02,
        report_ids=(2,),
        in_report_lengths=(5,),  # 1 button byte + 2 + 2 XY
        out_report_lengths=(0,),
    )


ABSOLUTE_MOUSE = _build_absolute_mouse()
