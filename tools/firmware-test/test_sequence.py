import importlib.util
import json

from picoflow.sequence import load

from conftest import DEFAULT_SEQUENCE, GOLDEN_SEQUENCE, RUNTIME


def _load_code_module():
    spec = importlib.util.spec_from_file_location("picoflow_code", RUNTIME / "code.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_sequence_is_golden_copy():
    default = json.loads(DEFAULT_SEQUENCE.read_text())
    golden = json.loads(GOLDEN_SEQUENCE.read_text())
    assert default == golden


def test_load_default_sequence():
    seq = load(str(DEFAULT_SEQUENCE))
    assert seq.version == 1
    assert seq.run_mode == "auto"
    assert seq.settle_ms == 1200
    assert seq.hid_profile == "absolute_mouse_keyboard"
    assert seq.button_pin == "GP15"
    types = [event["type"] for event in seq.events]
    assert types == [
        "tap",
        "swipe",
        "key",
        "mouse_move",
        "mouse_move",
        "mouse_button",
        "wait",
    ]
    at = [event["at_ms"] for event in seq.events]
    assert at == sorted(at)


def test_load_sorts_by_at_ms(tmp_path):
    path = tmp_path / "sequence.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "events": [
                    {"at_ms": 50, "type": "wait", "duration_ms": 1},
                    {"at_ms": 10, "type": "tap", "x": 0.1, "y": 0.1, "hold_ms": 60},
                ],
            }
        )
    )
    seq = load(str(path))
    assert [e["at_ms"] for e in seq.events] == [10, 50]


def test_invalid_json_does_not_raise(tmp_path, capsys):
    bad = tmp_path / "sequence.json"
    bad.write_text("{")
    code = _load_code_module()
    result = code.main(path=str(bad), idle=False)
    captured = capsys.readouterr()
    assert result is None
    assert "sequence load failed" in captured.out


def test_code_py_catches_missing_file(tmp_path, capsys):
    code = _load_code_module()
    missing = tmp_path / "nope.json"
    result = code.main(path=str(missing), idle=False)
    captured = capsys.readouterr()
    assert result is None
    assert "sequence load failed" in captured.out


def test_code_settle_then_play(tmp_path, monkeypatch):
    path = tmp_path / "sequence.json"
    path.write_text('{"version":1,"settle_ms":1200,"run_mode":"auto","events":[]}')
    code = _load_code_module()
    sleeps = []
    monkeypatch.setattr(code.time, "sleep", lambda s: sleeps.append(s))

    class FakePlayer:
        ran = False

        def __init__(self, seq):
            self.seq = seq

        def run(self):
            FakePlayer.ran = True

    result = code.main(path=str(path), idle=False, player_cls=FakePlayer)
    assert result is not None
    assert sleeps == [1.2]
    assert FakePlayer.ran
