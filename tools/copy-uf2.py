#!/usr/bin/env python3
"""POSIX byte-copy for Pico UF2 and CIRCUITPY. Never Finder, never copyfile."""

from __future__ import annotations

import argparse
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_RUNTIME = os.path.normpath(os.path.join(_HERE, "..", "assets", "firmware", "runtime"))


def _path_gone(path):
    """True if dest or its parent volume is gone (RPI-RP2 unmount)."""
    try:
        if not os.path.exists(path):
            return True
        parent = os.path.dirname(path)
        if parent and not os.path.exists(parent):
            return True
        return False
    except OSError:
        return True


def write_file_bytes(dest, data):
    """Create/truncate dest, write all bytes, fsync. Dest vanished after a full write is success."""
    dest = os.fspath(dest)
    parent, name = os.path.split(dest)
    if name:
        appledouble = os.path.join(parent, "._" + name)
        if os.path.lexists(appledouble):
            try:
                os.unlink(appledouble)
            except OSError:
                pass

    written = 0
    fd = None
    error = None
    try:
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        view = memoryview(data)
        while written < len(data):
            n = os.write(fd, view[written:])
            if n <= 0:
                raise OSError("short write")
            written += n
        os.fsync(fd)
    except OSError as exc:
        error = exc
    finally:
        # Never let close() override a pending result (unmount often raises ENXIO/EBADF).
        if fd is not None:
            try:
                os.close(fd)
            except OSError as close_exc:
                if error is None:
                    error = close_exc

    if written == len(data) and (error is None or _path_gone(dest)):
        return True
    if error is not None:
        raise error
    return True


def copy_file(src, dest):
    with open(src, "rb") as handle:
        data = handle.read()
    write_file_bytes(dest, data)


def _iter_files(src_dir):
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__")]
        files.sort()
        dirs.sort()
        for name in files:
            if name.startswith("._") or name in (".DS_Store",):
                continue
            yield os.path.join(root, name)


def copy_tree_files(src_dir, dest_dir):
    for src in _iter_files(src_dir):
        rel = os.path.relpath(src, src_dir)
        dest = os.path.join(dest_dir, rel)
        parent = os.path.dirname(dest)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
        copy_file(src, dest)


def install_runtime(circuitpy, runtime_dir=_RUNTIME):
    """Write runtime onto CIRCUITPY: lib/ → identity → sequence → boot.py → markers → code.py last."""
    lib_src = os.path.join(runtime_dir, "lib")
    if os.path.isdir(lib_src):
        copy_tree_files(lib_src, os.path.join(circuitpy, "lib"))
    copy_file(os.path.join(runtime_dir, "picoflow.json"), os.path.join(circuitpy, "picoflow.json"))
    copy_file(
        os.path.join(runtime_dir, "sequence.default.json"),
        os.path.join(circuitpy, "sequence.json"),
    )
    copy_file(os.path.join(runtime_dir, "boot_abs_mouse.py"), os.path.join(circuitpy, "boot.py"))
    write_file_bytes(os.path.join(circuitpy, ".metadata_never_index"), b"")
    fse = os.path.join(circuitpy, ".fseventsd")
    if not os.path.isdir(fse):
        os.makedirs(fse, exist_ok=True)
    write_file_bytes(os.path.join(fse, "no_log"), b"")
    copy_file(os.path.join(runtime_dir, "code.py"), os.path.join(circuitpy, "code.py"))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="POSIX byte copy for Pico UF2 / CIRCUITPY (never Finder)."
    )
    parser.add_argument("src", nargs="?", help="source file (UF2 or any file)")
    parser.add_argument("dest", nargs="?", help="destination path")
    parser.add_argument(
        "--install-runtime",
        metavar="CIRCUITPY",
        help="copy bundled runtime onto a CIRCUITPY volume",
    )
    args = parser.parse_args(argv)
    if args.install_runtime:
        install_runtime(args.install_runtime)
        return 0
    if not args.src or not args.dest:
        parser.error("src and dest required (or pass --install-runtime)")
    copy_file(args.src, args.dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
