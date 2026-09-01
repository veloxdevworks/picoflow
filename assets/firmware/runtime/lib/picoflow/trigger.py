# Run-mode waits. Auto-run is the default and does not call these.
import sys
import time

DEFAULT_PIN = "GP15"


def wait_button(pin_name=DEFAULT_PIN):
    """GP15 pull-up; fire on press to GND."""
    import board
    import digitalio

    name = pin_name or DEFAULT_PIN
    pin = digitalio.DigitalInOut(getattr(board, name))
    pin.switch_to_input(pull=digitalio.Pull.UP)
    while pin.value:
        time.sleep(0.01)
    time.sleep(0.02)


def wait_serial(stdin=None):
    """Fire when a USB CDC line contains the token GO."""
    stream = stdin if stdin is not None else sys.stdin
    while True:
        line = stream.readline()
        if not line:
            time.sleep(0.05)
            continue
        if "GO" in line:
            return
