import sys

from picoflow import storage_lock


class _Pin:
    def __init__(self):
        self.value = True
        self.deinited = False

    def switch_to_input(self, pull=None):
        self.pull = pull

    def deinit(self):
        self.deinited = True


def test_apply_deinits_pin(monkeypatch):
    pin = _Pin()
    disabled = []

    class FakeDigitalio:
        class DigitalInOut:
            def __init__(self, _raw):
                self.value = pin.value
                self.switch_to_input = pin.switch_to_input
                self.deinit = pin.deinit

        class Pull:
            UP = "up"

    class FakeBoard:
        GP15 = object()

    class FakeStorage:
        @staticmethod
        def disable_usb_drive():
            disabled.append(True)

    monkeypatch.setattr(storage_lock, "ENABLE_STORAGE_LOCK", True)
    monkeypatch.setitem(sys.modules, "board", FakeBoard)
    monkeypatch.setitem(sys.modules, "digitalio", FakeDigitalio)
    monkeypatch.setitem(sys.modules, "storage", FakeStorage)

    storage_lock.apply()
    assert pin.deinited
    assert disabled == [True]
