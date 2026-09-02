# Windows and Linux volumes (P1)

`list_pico_volumes()` is the only detection API. The UI does not branch on OS. Match is **label equality**, case-sensitive as the OS presents it (`RPI-RP2`, `CIRCUITPY`). Do not match by filesystem type.

HEIC import on Windows/Linux returns `unsupported_image` (macOS converts via `/usr/bin/sips`).

## Windows 10/11

Drive-letter roots plus Win32 volume labels. No extra crates: `GetLogicalDrives`, `GetDriveTypeW` (removable + fixed), `GetVolumeInformationW`.

A Pico in BOOTSEL is typically `E:\` (or another letter) with label `RPI-RP2`. After the UF2 it remounts as `CIRCUITPY` on the same or a new letter. Paths passed to `write_file_bytes` are those roots (`E:\circuitpython.uf2`).

WebView2 is required for the Tauri shell.

Eject: `eject_volume` is a warning no-op off macOS. Unplug after Done (same as a power cycle onto the tablet).

## Linux (Ubuntu-class)

Scan, in order:

1. `/media/$USER/<label>`
2. `/run/media/$USER/<label>` (udisks2)
3. `/proc/mounts` — any mount whose last path component is `RPI-RP2` or `CIRCUITPY` (octal escapes unescaped)

`$USER` / `$LOGNAME` / `$USERNAME`; if unset, `user`. `/proc/mounts` still finds mounts that are not under those roots (for example `/media/CIRCUITPY`).

Copy is the same POSIX byte write as macOS. Do not use a file manager that writes `._*` or xattrs onto the UF2.

### udev

udisks2 usually mounts the MSC volume for the seated user. If the **device node** is root-only, the volume never appears and the wizard times out.

Add a rule so the logged-in session can access the block device. Prefer `uaccess` (logind) over a world-writable node.

```udev
# /etc/udev/rules.d/99-picoflow.rules
# RP2040 BOOTSEL (Raspberry Pi, 2e8a) and CircuitPython (Adafruit, 239a)
SUBSYSTEM=="block", ATTRS{idVendor}=="2e8a", TAG+="uaccess"
SUBSYSTEM=="block", ATTRS{idVendor}=="239a", TAG+="uaccess"
```

Reload:

```sh
sudo install -m 644 99-picoflow.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
```

**Do not `chmod 777` the device.** If your distro still uses `plugdev` instead of `uaccess`, add the user to that group and use `MODE="0660", GROUP="plugdev"` — never `0777`.

Eject: same as Windows; unplug after Done. `diskutil` is macOS-only.

## Labels

| Volume   | When                         | Write |
|----------|------------------------------|-------|
| `RPI-RP2`  | BOOTSEL UF2 bootloader     | UF2 bytes; dest vanished = success |
| `CIRCUITPY` | CircuitPython MSC          | per-file bytes; no `settings.toml` |
