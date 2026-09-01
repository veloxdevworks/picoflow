# US QWERTY chars / Keycode names / modifiers → adafruit_hid.keycode.Keycode.
from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS
from adafruit_hid.keycode import Keycode

SHIFT_FLAG = 0x80

MODIFIER_NAMES = {
    "ctrl": Keycode.LEFT_CONTROL,
    "shift": Keycode.LEFT_SHIFT,
    "alt": Keycode.LEFT_ALT,
    "gui": Keycode.LEFT_GUI,
}


def modifier_codes(names):
    codes = []
    for name in names or ():
        key = name.lower() if isinstance(name, str) else name
        if key not in MODIFIER_NAMES:
            raise ValueError("unknown modifier")
        codes.append(MODIFIER_NAMES[key])
    return codes


def named_keycode(name):
    if not isinstance(name, str) or not hasattr(Keycode, name):
        raise ValueError("unknown keycode")
    return getattr(Keycode, name)


def char_keycodes(char):
    """Return (optional SHIFT, keycode) for a single US QWERTY character."""
    if not isinstance(char, str) or len(char) != 1:
        raise ValueError("expected single character")
    value = ord(char)
    table = KeyboardLayoutUS.ASCII_TO_KEYCODE
    code = table[value] if value < len(table) else 0
    if not code:
        raise ValueError("no keycode for character")
    keys = []
    if code & SHIFT_FLAG:
        keys.append(Keycode.SHIFT)
        code &= ~SHIFT_FLAG
    keys.append(code)
    return keys
