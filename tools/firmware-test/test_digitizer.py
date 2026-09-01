import importlib.util
import json

from picoflow.descriptors import ABS_MOUSE_REPORT_DESCRIPTOR, ABSOLUTE_MOUSE
from picoflow.digitizer import (
    CONTACT,
    DIGITIZER,
    DIGITIZER_REPORT_DESCRIPTOR,
    IN_RANGE,
    IN_REPORT_LENGTH,
    REPORT_ID,
    TIP_SWITCH,
    USAGE,
    USAGE_PAGE,
    Digitizer,
    make_digitizer_device,
)
from picoflow.playback import LEFT_BUTTON, to_hid
from picoflow.sequence import load

from conftest import DEFAULT_SEQUENCE, ROOT, RUNTIME
from test_playback import _player


def _load_boot(name):
    path = RUNTIME / name
    spec = importlib.util.spec_from_file_location(name.replace(".", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _observe():
    path = ROOT / "tools" / "hid-observe" / "observe.py"
    spec = importlib.util.spec_from_file_location("hid_observe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeHid:
    def __init__(self, usage_page=USAGE_PAGE, usage=USAGE):
        self.usage_page = usage_page
        self.usage = usage
        self.reports = []

    def send_report(self, report):
        self.reports.append(bytes(report))


def _pack(report_id, payload):
    return bytes((report_id,)) + bytes(payload)


def test_digitizer_descriptor_tip_switch_and_in_range():
    desc = DIGITIZER_REPORT_DESCRIPTOR
    assert desc[0:4] == bytes((0x05, 0x0D, 0x09, 0x04))
    assert bytes((0x85, 0x03)) in desc
    assert bytes((0x09, 0x42)) in desc  # Tip Switch
    assert bytes((0x09, 0x32)) in desc  # In Range
    assert bytes((0x26, 0xFF, 0x7F)) in desc
    tip_at = desc.index(bytes((0x09, 0x42)))
    range_at = desc.index(bytes((0x09, 0x32)))
    input_at = desc.index(bytes((0x81, 0x02)))
    assert tip_at < input_at
    assert range_at < input_at
    assert REPORT_ID == 3
    assert USAGE_PAGE == 0x0D
    assert USAGE == 0x04


def test_digitizer_device_constructor_matches_in_report_lengths():
    captured = {}

    class Dev:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    device = make_digitizer_device(Dev)
    assert device is not None
    assert captured["usage_page"] == 0x0D
    assert captured["usage"] == 0x04
    assert captured["report_ids"] == (3,)
    assert captured["in_report_lengths"] == (5,)
    assert captured["out_report_lengths"] == (0,)
    assert captured["report_descriptor"] == DIGITIZER_REPORT_DESCRIPTOR
    assert DIGITIZER is not None
    assert DIGITIZER.report_ids == (3,)
    assert DIGITIZER.in_report_lengths == (IN_REPORT_LENGTH,)
    assert DIGITIZER.in_report_lengths == (5,)
    assert DIGITIZER.usage_page == 0x0D
    assert DIGITIZER.usage == 0x04


def test_digitizer_report_length_matches_constructor():
    hid = FakeHid()
    pointer = Digitizer([hid])
    pointer.move(1, 2)
    assert hid.reports
    assert len(hid.reports[0]) == DIGITIZER.in_report_lengths[0]
    assert len(hid.reports[0]) == IN_REPORT_LENGTH


def test_digitizer_press_sets_tip_and_in_range():
    hid = FakeHid()
    pointer = Digitizer([hid])
    pointer.move(100, 200)
    pointer.press(LEFT_BUTTON)
    pointer.release(LEFT_BUTTON)
    assert hid.reports[0][0] == 0
    assert hid.reports[1][0] == CONTACT
    assert hid.reports[1][0] & TIP_SWITCH
    assert hid.reports[1][0] & IN_RANGE
    assert hid.reports[2][0] == 0
    x = hid.reports[1][1] | (hid.reports[1][2] << 8)
    y = hid.reports[1][3] | (hid.reports[1][4] << 8)
    assert x == 100
    assert y == 200


def test_digitizer_player_tap_and_relative_move(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "events": [
                    {"at_ms": 0, "type": "tap", "x": 0.5, "y": 0.25, "hold_ms": 16},
                    {"at_ms": 50, "type": "mouse_move", "dx": 10, "dy": -4},
                ],
            }
        )
    )
    seq = load(str(path))
    hid = FakeHid()
    pointer = Digitizer([hid])
    player, clock, _mouse, keyboard = _player(seq, mouse=pointer)
    player.run()
    assert all(s >= 0 for s in clock.sleeps)
    assert keyboard.calls == []
    assert hid.reports[0][0] == 0  # move
    assert hid.reports[1][0] == CONTACT  # press tip+range
    assert hid.reports[2][0] == 0  # release
    x = hid.reports[0][1] | (hid.reports[0][2] << 8)
    y = hid.reports[0][3] | (hid.reports[0][4] << 8)
    assert x == to_hid(0.5)
    assert y == to_hid(0.25)
    last = hid.reports[-1]
    lx = last[1] | (last[2] << 8)
    ly = last[3] | (last[4] << 8)
    assert lx == to_hid(0.5) + 10
    assert ly == to_hid(0.25) - 4


def test_digitizer_swipe_holds_contact(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        '{"version":1,"events":[{"at_ms":0,"type":"swipe","x0":0,"y0":0,"x1":1,"y1":1,"duration_ms":32}]}'
    )
    seq = load(str(path))
    hid = FakeHid()
    pointer = Digitizer([hid])
    player, _clock, _mouse, _keyboard = _player(seq, mouse=pointer)
    player.run()
    # move, press, interpolated moves, release
    assert hid.reports[0][0] == 0
    assert hid.reports[1][0] == CONTACT
    assert hid.reports[-1][0] == 0
    held = hid.reports[1:-1]
    assert held
    assert all(report[0] == CONTACT for report in held)


def test_default_hid_falls_back_to_digitizer(monkeypatch):
    from picoflow import playback

    hid = FakeHid()

    class FakeKeyboard:
        def __init__(self, devices):
            self.devices = devices

    import usb_hid

    monkeypatch.setattr(usb_hid, "devices", [hid])
    monkeypatch.setattr("adafruit_hid.keyboard.Keyboard", FakeKeyboard)
    mouse, keyboard = playback._default_hid()
    assert isinstance(mouse, Digitizer)
    assert isinstance(keyboard, FakeKeyboard)
    mouse.move(3, 4)
    assert hid.reports
    assert len(hid.reports[0]) == IN_REPORT_LENGTH


def test_boot_digitizer_enables_keyboard_not_mouse(monkeypatch):
    enabled = []
    apply_calls = []
    import usb_hid
    from picoflow import storage_lock

    monkeypatch.setattr(usb_hid, "enable", lambda devices: enabled.append(devices))
    monkeypatch.setattr(storage_lock, "apply", lambda: apply_calls.append(True))
    _load_boot("boot_digitizer.py")
    assert apply_calls == [True]
    assert len(enabled) == 1
    devices = enabled[0]
    assert len(devices) == 2
    assert devices[0] is usb_hid.Device.KEYBOARD
    assert devices[1] is DIGITIZER
    assert devices[1].usage_page == 0x0D
    assert ABSOLUTE_MOUSE not in devices


def test_boot_digitizer_source_imports_storage_lock():
    text = (RUNTIME / "boot_digitizer.py").read_text()
    assert "from picoflow import storage_lock" in text
    assert "storage_lock.apply()" in text
    assert "DIGITIZER" in text
    assert "Device.KEYBOARD" in text
    assert "ABSOLUTE_MOUSE" not in text
    assert "Device.MOUSE" not in text


def test_manifest_digitizer_profile_is_fallback_not_default():
    manifest = json.loads((ROOT / "assets" / "firmware" / "manifest.json").read_text())
    profiles = manifest["hidProfiles"]
    assert profiles["absolute_mouse_keyboard"]["boot"] == "runtime/boot_abs_mouse.py"
    assert profiles["digitizer_keyboard"]["boot"] == "runtime/boot_digitizer.py"
    assert list(profiles)[0] == "absolute_mouse_keyboard"
    identity = json.loads((RUNTIME / "picoflow.json").read_text())
    assert identity["hid_profile"] == "absolute_mouse_keyboard"
    seq = load(str(DEFAULT_SEQUENCE))
    assert seq.hid_profile == "absolute_mouse_keyboard"


def test_hid_observe_splits_reports_by_shipped_descriptor_ids():
    observe = _observe()
    assert observe.ABS_MOUSE_REPORT_ID == 2
    assert observe.DIGITIZER_REPORT_ID == 3
    assert observe.KEYBOARD_REPORT_ID == 1
    assert observe.report_id_from_descriptor(ABS_MOUSE_REPORT_DESCRIPTOR) == 2
    assert observe.report_id_from_descriptor(DIGITIZER_REPORT_DESCRIPTOR) == 3

    key = observe.decode_report(_pack(1, [0x02, 0x00, 0x12, 0x0E, 0, 0, 0, 0]))
    assert key == "id=1 key modifiers=0x02 keys=O,K"

    mouse = observe.decode_report(_pack(2, [0x01, 0xFF, 0x3F, 0x00, 0x40]))
    assert mouse == "id=2 move(16383,16384) btn=0x01"

    contact = TIP_SWITCH | IN_RANGE
    digitizer = observe.decode_report(_pack(3, [contact, 0x00, 0x00, 0xFF, 0x7F]))
    assert digitizer == "id=3 move(0,32767) tip=1 in_range=1"

    unknown = observe.decode_report(_pack(9, [0xAA]))
    assert unknown.startswith("id=9 unknown")
    assert "aa" in unknown


def test_hid_observe_matches_pico_vid_pid():
    observe = _observe()
    infos = [
        {"vendor_id": 0x239A, "product_id": 0x80F4, "usage_page": 0x0D, "usage": 0x04},
        {"vendor_id": 0x239A, "product_id": 0x0001, "usage_page": 0x01, "usage": 0x06},
        {"vendor_id": 0x1234, "product_id": 0x80F4, "usage_page": 0x01, "usage": 0x02},
    ]
    matched = observe.matching_devices(infos)
    assert len(matched) == 1
    assert matched[0]["usage_page"] == 0x0D
    assert observe.ADAFRUIT_VID == 0x239A
    assert observe.PICO_PID == 0x80F4
