import errno
import importlib.util
import os
from pathlib import Path

_COPY = Path(__file__).resolve().parents[1] / "copy-uf2.py"


def _copy_mod():
    spec = importlib.util.spec_from_file_location("copy_uf2", _COPY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_write_file_bytes_roundtrip(tmp_path):
    mod = _copy_mod()
    dest = tmp_path / "out.bin"
    assert mod.write_file_bytes(str(dest), b"abc") is True
    assert dest.read_bytes() == b"abc"
    assert not (tmp_path / "._out.bin").exists()


def test_dest_vanished_after_full_write_is_success(tmp_path, monkeypatch):
    mod = _copy_mod()
    dest = tmp_path / "circuitpython.uf2"
    data = b"hello-uf2"

    def vanish(_fd):
        dest.unlink()
        raise OSError(errno.ENOENT, "RPI-RP2 unmounted")

    monkeypatch.setattr(os, "fsync", vanish)
    assert mod.write_file_bytes(str(dest), data) is True
    assert not dest.exists()


def test_unlinks_appledouble_sidecar(tmp_path):
    mod = _copy_mod()
    dest = tmp_path / "code.py"
    sidecar = tmp_path / "._code.py"
    sidecar.write_bytes(b"junk")
    mod.write_file_bytes(str(dest), b"print(1)\n")
    assert dest.read_bytes() == b"print(1)\n"
    assert not sidecar.exists()
