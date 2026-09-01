# MSC lock for Android composite rejection. Unused until the HID spike
# says otherwise; both boot templates import and call apply().
ENABLE_STORAGE_LOCK = False

AUTHOR_PIN = "GP15"


def apply():
    """If ENABLE_STORAGE_LOCK, hide CIRCUITPY unless GP15 is held to GND."""
    if not ENABLE_STORAGE_LOCK:
        return
    import board
    import digitalio
    import storage

    pin = digitalio.DigitalInOut(getattr(board, AUTHOR_PIN))
    pin.switch_to_input(pull=digitalio.Pull.UP)
    # Held to GND at plug-in = author mode; keep the drive.
    if pin.value:
        storage.disable_usb_drive()
