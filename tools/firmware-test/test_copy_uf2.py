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


def test_close_enxio_after_full_write_is_success(tmp_path, monkeypatch):
    mod = _copy_mod()
    dest = tmp_path / "circuitpython.uf2"
    data = b"hello-uf2"
    real_close = os.close

    def close_unmount(fd):
        dest.unlink(missing_ok=True)
        try:
            real_close(fd)
        except OSError:
            pass
        raise OSError(errno.ENXIO, "Device not configured")

    monkeypatch.setattr(os, "close", close_unmount)
    assert mod.write_file_bytes(str(dest), data) is True
    assert not dest.exists()


def test_close_ebadf_after_full_write_is_success(tmp_path, monkeypatch):
    mod = _copy_mod()
    dest = tmp_path / "circuitpython.uf2"
    data = b"hello-uf2"
    real_close = os.close

    def close_unmount(fd):
        dest.unlink(missing_ok=True)
        try:
            real_close(fd)
        except OSError:
            pass
        raise OSError(errno.EBADF, "Bad file descriptor")

    monkeypatch.setattr(os, "close", close_unmount)
    assert mod.write_file_bytes(str(dest), data) is True
    assert not dest.exists()


def test_fsync_enxio_then_close_ebadf_is_success(tmp_path, monkeypatch):
    """Unmount under an open fd: fsync ENXIO, close EBADF must not clobber success."""
    mod = _copy_mod()
    dest = tmp_path / "circuitpython.uf2"
    data = b"hello-uf2"
    real_close = os.close

    def vanish_fsync(_fd):
        dest.unlink()
        raise OSError(errno.ENXIO, "Device not configured")

    def vanish_close(fd):
        try:
            real_close(fd)
        except OSError:
            pass
        raise OSError(errno.EBADF, "Bad file descriptor")

    monkeypatch.setattr(os, "fsync", vanish_fsync)
    monkeypatch.setattr(os, "close", vanish_close)
    assert mod.write_file_bytes(str(dest), data) is True
    assert not dest.exists()


def test_incomplete_write_still_fails(tmp_path, monkeypatch):
    mod = _copy_mod()
    dest = tmp_path / "circuitpython.uf2"
    data = b"hello-uf2"

    def short(_fd, _buf):
        raise OSError(errno.EIO, "mid-write")

    monkeypatch.setattr(os, "write", short)
    try:
        mod.write_file_bytes(str(dest), data)
        raise AssertionError("expected OSError")
    except OSError as exc:
        assert exc.errno == errno.EIO


def test_unlinks_appledouble_sidecar(tmp_path):
    mod = _copy_mod()
    dest = tmp_path / "code.py"
    sidecar = tmp_path / "._code.py"
    sidecar.write_bytes(b"junk")
    mod.write_file_bytes(str(dest), b"print(1)\n")
    assert dest.read_bytes() == b"print(1)\n"
    assert not sidecar.exists()


def test_install_runtime_writes_code_py_last(tmp_path, monkeypatch):
    mod = _copy_mod()
    circuitpy = tmp_path / "CIRCUITPY"
    circuitpy.mkdir()
    order = []
    real_copy = mod.copy_file
    real_write = mod.write_file_bytes

    def record_copy(src, dest):
        order.append(os.path.basename(dest))
        return real_copy(src, dest)

    def record_write(dest, data):
        order.append(os.path.basename(dest))
        return real_write(dest, data)

    monkeypatch.setattr(mod, "copy_file", record_copy)
    monkeypatch.setattr(mod, "write_file_bytes", record_write)
    mod.install_runtime(str(circuitpy))
    assert order[-1] == "code.py"
    assert order.index("no_log") < order.index("code.py")
    assert order.index(".metadata_never_index") < order.index("code.py")
    assert (circuitpy / "code.py").is_file()
    assert (circuitpy / "boot.py").is_file()
