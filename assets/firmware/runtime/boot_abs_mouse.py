# Install copies this file to CIRCUITPY/boot.py.
# HID enablement lives here; power-cycle after copy for it to take effect.
import usb_hid
from picoflow import storage_lock
from picoflow.descriptors import ABSOLUTE_MOUSE

storage_lock.apply()

# Keyboard (report ID 1) + custom absolute mouse (report ID 2).
# Do not also enable CircuitPython's default relative mouse.
usb_hid.enable((usb_hid.Device.KEYBOARD, ABSOLUTE_MOUSE))
