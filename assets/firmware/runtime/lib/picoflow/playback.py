# Timestamp-driven HID playback. wait is a no-op; no loop after the last event.
import time

from picoflow import hidmap

HID_MAX = 32767
HID_CENTER = 16383
SWIPE_STEP_MS = 16
CHAR_GAP_MS = 20
DEFAULT_TAP_HOLD_MS = 60
DEFAULT_KEY_HOLD_MS = 50

LEFT_BUTTON = 1
RIGHT_BUTTON = 2
MIDDLE_BUTTON = 4

_BUTTON_BITS = {
    "left": LEFT_BUTTON,
    "right": RIGHT_BUTTON,
    "middle": MIDDLE_BUTTON,
}


def clamp(value, lo, hi):
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def to_hid(norm):
    return int(round(clamp(float(norm), 0.0, 1.0) * HID_MAX))


class AbsoluteMouse:
    """5-byte absolute mouse: [buttons, x_lo, x_hi, y_lo, y_hi]."""

    LEFT_BUTTON = LEFT_BUTTON
    RIGHT_BUTTON = RIGHT_BUTTON
    MIDDLE_BUTTON = MIDDLE_BUTTON

    def __init__(self, devices):
        from adafruit_hid import find_device

        self._device = find_device(devices, usage_page=0x01, usage=0x02)
        self.report = bytearray(5)

    def move(self, x, y):
        x = int(clamp(int(x), 0, HID_MAX))
        y = int(clamp(int(y), 0, HID_MAX))
        self.report[1] = x & 0xFF
        self.report[2] = (x >> 8) & 0xFF
        self.report[3] = y & 0xFF
        self.report[4] = (y >> 8) & 0xFF
        self._device.send_report(self.report)

    def press(self, buttons):
        self.report[0] |= buttons
        self._device.send_report(self.report)

    def release(self, buttons):
        self.report[0] &= ~buttons & 0xFF
        self._device.send_report(self.report)

    def release_all(self):
        self.report[0] = 0
        self._device.send_report(self.report)

    def click(self, buttons):
        self.press(buttons)
        self.release(buttons)


def _default_hid():
    import usb_hid
    from adafruit_hid.keyboard import Keyboard

    devices = usb_hid.devices
    keyboard = Keyboard(devices)
    try:
        return AbsoluteMouse(devices), keyboard
    except ValueError:
        from picoflow.digitizer import Digitizer

        return Digitizer(devices), keyboard


class Player:
    def __init__(self, seq, mouse=None, keyboard=None, sleep=time.sleep, monotonic=time.monotonic):
        self.seq = seq
        self._sleep = sleep
        self._monotonic = monotonic
        if mouse is None or keyboard is None:
            default_mouse, default_keyboard = _default_hid()
            if mouse is None:
                mouse = default_mouse
            if keyboard is None:
                keyboard = default_keyboard
        self.mouse = mouse
        self.keyboard = keyboard
        self.last_x = HID_CENTER
        self.last_y = HID_CENTER

    def run(self):
        events = self.seq.events
        t0 = self._monotonic()
        for index, event in enumerate(events):
            at_ms = int(event.get("at_ms", 0))
            delay = (t0 + at_ms / 1000.0) - self._monotonic()
            if delay > 0:
                self._sleep(delay)
            kind = event.get("type", "?")
            print(index, kind, at_ms)
            self._execute(event)

    def _execute(self, event):
        kind = event.get("type")
        if kind == "tap":
            self._tap(event)
        elif kind == "swipe":
            self._swipe(event)
        elif kind == "key":
            self._key(event)
        elif kind == "mouse_move":
            self._mouse_move(event)
        elif kind == "mouse_button":
            self._mouse_button(event)
        elif kind == "wait":
            return
        else:
            print("skip unknown event")

    def _move_abs(self, x, y):
        self.mouse.move(x, y)
        self.last_x = x
        self.last_y = y

    def _tap(self, event):
        x = to_hid(event.get("x", 0))
        y = to_hid(event.get("y", 0))
        hold_ms = int(event.get("hold_ms", DEFAULT_TAP_HOLD_MS))
        self._move_abs(x, y)
        self.mouse.press(LEFT_BUTTON)
        if hold_ms > 0:
            self._sleep(hold_ms / 1000.0)
        self.mouse.release(LEFT_BUTTON)

    def _swipe(self, event):
        x0 = to_hid(event.get("x0", 0))
        y0 = to_hid(event.get("y0", 0))
        x1 = to_hid(event.get("x1", 0))
        y1 = to_hid(event.get("y1", 0))
        duration_ms = int(event.get("duration_ms", SWIPE_STEP_MS))
        steps = duration_ms // SWIPE_STEP_MS
        if steps < 2:
            steps = 2
        self._move_abs(x0, y0)
        self.mouse.press(LEFT_BUTTON)
        dt = SWIPE_STEP_MS / 1000.0
        last = steps - 1
        for i in range(1, steps):
            self._sleep(dt)
            t = i / last
            x = int(round(x0 + (x1 - x0) * t))
            y = int(round(y0 + (y1 - y0) * t))
            self._move_abs(x, y)
        self.mouse.release(LEFT_BUTTON)

    def _key(self, event):
        hold_ms = int(event.get("hold_ms", DEFAULT_KEY_HOLD_MS))
        modifiers = hidmap.modifier_codes(event.get("modifiers") or ())
        chars = event.get("chars")
        keycode = event.get("keycode")
        if chars:
            last = len(chars) - 1
            for i, char in enumerate(chars):
                keys = list(modifiers) + hidmap.char_keycodes(char)
                self._press_keys(keys, hold_ms)
                if i < last:
                    self._sleep(CHAR_GAP_MS / 1000.0)
            return
        if keycode:
            keys = list(modifiers) + [hidmap.named_keycode(keycode)]
            self._press_keys(keys, hold_ms)

    def _press_keys(self, keys, hold_ms):
        if keys:
            self.keyboard.press(*keys)
        if hold_ms > 0:
            self._sleep(hold_ms / 1000.0)
        self.keyboard.release_all()

    def _mouse_move(self, event):
        if "x" in event and event.get("x") is not None and "y" in event and event.get("y") is not None:
            self._move_abs(to_hid(event["x"]), to_hid(event["y"]))
            return
        dx = int(event.get("dx") or 0)
        dy = int(event.get("dy") or 0)
        self._move_abs(int(clamp(self.last_x + dx, 0, HID_MAX)), int(clamp(self.last_y + dy, 0, HID_MAX)))

    def _mouse_button(self, event):
        bit = _BUTTON_BITS.get(event.get("button"), LEFT_BUTTON)
        op = event.get("op")
        if op == "down":
            self.mouse.press(bit)
        elif op == "up":
            self.mouse.release(bit)
        else:
            self.mouse.click(bit)
