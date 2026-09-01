from picoflow.playback import (
    CHAR_GAP_MS,
    HID_CENTER,
    LEFT_BUTTON,
    SWIPE_STEP_MS,
    Player,
    to_hid,
)
from picoflow.sequence import load
from picoflow.trigger import wait_serial

from conftest import DEFAULT_SEQUENCE


class FakeClock:
    def __init__(self, t=0.0):
        self.t = t
        self.sleeps = []

    def monotonic(self):
        return self.t

    def sleep(self, seconds):
        if seconds < 0:
            raise AssertionError("negative sleep")
        self.sleeps.append(seconds)
        self.t += seconds


class FakeMouse:
    def __init__(self):
        self.calls = []

    def move(self, x, y):
        self.calls.append(("move", int(x), int(y)))

    def press(self, buttons):
        self.calls.append(("press", buttons))

    def release(self, buttons):
        self.calls.append(("release", buttons))

    def click(self, buttons):
        self.press(buttons)
        self.release(buttons)

    def release_all(self):
        self.calls.append(("release_all",))


class FakeKeyboard:
    def __init__(self):
        self.calls = []

    def press(self, *keycodes):
        self.calls.append(("press", tuple(keycodes)))

    def release_all(self):
        self.calls.append(("release_all",))


def _player(seq, clock=None, mouse=None, keyboard=None):
    clock = clock or FakeClock()
    mouse = mouse or FakeMouse()
    keyboard = keyboard or FakeKeyboard()
    player = Player(
        seq,
        mouse=mouse,
        keyboard=keyboard,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )
    return player, clock, mouse, keyboard


def test_to_hid_scale():
    assert to_hid(0) == 0
    assert to_hid(1) == 32767
    assert to_hid(0.5) == int(round(0.5 * 32767))
    assert to_hid(-1) == 0
    assert to_hid(2) == 32767


def test_play_order_golden_sequence():
    seq = load(str(DEFAULT_SEQUENCE))
    player, clock, mouse, keyboard = _player(seq)
    player.run()

    assert clock.sleeps
    assert all(s >= 0 for s in clock.sleeps)

    kinds = [event["type"] for event in seq.events]
    assert kinds[-1] == "wait"

    tap_x, tap_y = to_hid(0.52), to_hid(0.81)
    swipe_x0, swipe_y0 = to_hid(0.8), to_hid(0.5)
    swipe_x1, swipe_y1 = to_hid(0.2), to_hid(0.5)
    center = to_hid(0.5)

    # Tap: move → press → release.
    assert mouse.calls[0] == ("move", tap_x, tap_y)
    assert mouse.calls[1] == ("press", LEFT_BUTTON)
    assert mouse.calls[2] == ("release", LEFT_BUTTON)

    # Swipe: contact held through interpolated moves (until the next release).
    assert mouse.calls[3] == ("move", swipe_x0, swipe_y0)
    assert mouse.calls[4] == ("press", LEFT_BUTTON)
    swipe_up = next(
        i for i, call in enumerate(mouse.calls[5:], start=5) if call == ("release", LEFT_BUTTON)
    )
    assert mouse.calls[swipe_up - 1] == ("move", swipe_x1, swipe_y1)
    held_moves = mouse.calls[5:swipe_up]
    steps = max(2, 400 // SWIPE_STEP_MS)
    assert len(held_moves) == steps - 1
    assert all(call[0] == "move" for call in held_moves)

    # Relative mouse_move tracks last absolute position.
    abs_move = ("move", center, center)
    rel_move = ("move", center + 12, center - 4)
    assert abs_move in mouse.calls
    assert rel_move in mouse.calls
    abs_i = mouse.calls.index(abs_move)
    rel_i = mouse.calls.index(rel_move)
    assert abs_i < rel_i

    click_at = [i for i, c in enumerate(mouse.calls) if c == ("press", LEFT_BUTTON)][-1]
    assert mouse.calls[click_at + 1] == ("release", LEFT_BUTTON)

    # Keyboard: "ok" as two sequential keypresses, no chars dumped.
    assert len(keyboard.calls) == 4
    assert keyboard.calls[0][0] == "press"
    assert keyboard.calls[1] == ("release_all",)
    assert keyboard.calls[2][0] == "press"
    assert keyboard.calls[3] == ("release_all",)

    # Wait is a no-op: no extra HID after the click pair, and no extra duration sleep
    # beyond reaching at_ms (last HID is the click; wait adds nothing).
    assert mouse.calls[-2:] == [("press", LEFT_BUTTON), ("release", LEFT_BUTTON)]


def test_wait_does_not_sleep_duration(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        '{"version":1,"events":[{"at_ms":100,"type":"wait","duration_ms":500}]}'
    )
    seq = load(str(path))
    player, clock, mouse, keyboard = _player(seq)
    player.run()
    assert clock.sleeps == [0.1]
    assert mouse.calls == []
    assert keyboard.calls == []


def test_swipe_interpolates_while_held(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        '{"version":1,"events":[{"at_ms":0,"type":"swipe","x0":0,"y0":0,"x1":1,"y1":1,"duration_ms":32}]}'
    )
    seq = load(str(path))
    player, clock, mouse, _keyboard = _player(seq)
    player.run()
    assert mouse.calls[0] == ("move", 0, 0)
    assert mouse.calls[1] == ("press", LEFT_BUTTON)
    assert mouse.calls[-1] == ("release", LEFT_BUTTON)
    mid = [c for c in mouse.calls if c[0] == "move"]
    assert mid[0] == ("move", 0, 0)
    assert mid[-1] == ("move", 32767, 32767)
    press_i = mouse.calls.index(("press", LEFT_BUTTON))
    release_i = mouse.calls.index(("release", LEFT_BUTTON))
    between = mouse.calls[press_i + 1 : release_i]
    assert between
    assert all(c[0] == "move" for c in between)


def test_relative_mouse_clamps(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        '{"version":1,"events":[{"at_ms":0,"type":"mouse_move","dx":99999,"dy":-99999}]}'
    )
    seq = load(str(path))
    player, _clock, mouse, _keyboard = _player(seq)
    player.run()
    assert mouse.calls == [("move", 32767, 0)]


def test_key_chars_gap(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        '{"version":1,"events":[{"at_ms":0,"type":"key","chars":"ab","hold_ms":50}]}'
    )
    seq = load(str(path))
    player, clock, _mouse, keyboard = _player(seq)
    player.run()
    assert CHAR_GAP_MS / 1000.0 in clock.sleeps
    assert keyboard.calls[0][0] == "press"
    assert keyboard.calls[1] == ("release_all",)
    assert keyboard.calls[2][0] == "press"
    assert keyboard.calls[3] == ("release_all",)


def test_player_returns_after_last_event():
    seq = load(str(DEFAULT_SEQUENCE))
    player, _clock, _mouse, _keyboard = _player(seq)
    player.run()  # must return; v1 does not loop


def test_wait_serial_fires_on_go_substring():
    class Lines:
        def __init__(self, lines):
            self.lines = list(lines)

        def readline(self):
            return self.lines.pop(0) if self.lines else ""

    wait_serial(stdin=Lines(["hello\n", "please GO now\n"]))
