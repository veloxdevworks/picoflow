# Install copies this file to CIRCUITPY/boot.py (digitizer_keyboard profile).
# HID enablement lives here; power-cycle after copy for it to take effect.
import usb_hid
from picoflow import storage_lock
from picoflow.digitizer import DIGITIZER

storage_lock.apply()

# Keyboard (report ID 1) + digitizer (report ID 3).
# Digitizer replaces absolute mouse; do not also enable MOUSE.
usb_hid.enable((usb_hid.Device.KEYBOARD, DIGITIZER))
