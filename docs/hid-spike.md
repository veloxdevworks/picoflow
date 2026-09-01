# HID spike — absolute mouse on Android

Manual procedure for PR 3. **Never Finder-drag** a UF2 onto `RPI-RP2` (macOS Ventura+ writes xattrs the RP2040 bootloader cannot store). Digitizer fallback and `tools/hid-observe` are the **next PR**; this spike ships keyboard + absolute mouse only.

Pinned artifacts (recorded in `assets/firmware/manifest.json`):

- CircuitPython **10.3.0** `raspberry_pi_pico` `en_US` (current stable at vendor time; design pin was ~10.2.1)
- Adafruit HID **6.1.10** (`693baa60eb684bb53379d98c6a036f56b8010666`)
- Runtime **0.1.0**, HID profile `absolute_mouse_keyboard` (report ID 2, 16-bit, logical 0–32767)

## Hardware

- Raspberry Pi Pico / generic RP2040 (not Pico 2 / RP2350)
- USB data cable
- Authoring Mac (POSIX byte copy)
- Target Android tablet (record SKU + OS in the results table)

## Phase A — UF2 onto `RPI-RP2`

1. Hold **BOOTSEL**, plug USB. Volume `RPI-RP2` appears.
2. Leave the Finder window closed.
3. From the repo root:

```sh
python3 tools/copy-uf2.py \
  assets/firmware/circuitpython/adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.0.uf2 \
  /Volumes/RPI-RP2/circuitpython.uf2
```

4. **Dest vanished = success.** `RPI-RP2` unmounts as soon as the bootloader accepts the UF2. `ENOENT` / `EIO` after a full-byte write is OK. Do not retry a Finder copy.
5. Wait for `CIRCUITPY` (typically a few seconds). If it does not appear, press RESET or re-enter BOOTSEL and repeat.

`copy-uf2.py` is a POSIX `open` / `write` / `fsync` / `close`. It never uses Finder, `cp`, or `copyfile(3)`.

## Phase B — runtime onto `CIRCUITPY`

Do **not** open the CIRCUITPY window in Finder while copying (AppleDouble `._*` files fill the ~1 MB volume and break `import`).

```sh
python3 tools/copy-uf2.py --install-runtime /Volumes/CIRCUITPY
```

That byte-copies, in order:

1. `lib/adafruit_hid/**` and `lib/picoflow/**`
2. `picoflow.json`
3. `sequence.default.json` → `sequence.json`
4. `boot_abs_mouse.py` → `boot.py`
5. `code.py` last

It also writes empty `.metadata_never_index` and `.fseventsd/no_log`. It unlinks any `._*` sidecar next to a dest file before write.

Equivalent one-file copies (same tool):

```sh
python3 tools/copy-uf2.py assets/firmware/runtime/boot_abs_mouse.py /Volumes/CIRCUITPY/boot.py
python3 tools/copy-uf2.py assets/firmware/runtime/code.py /Volumes/CIRCUITPY/code.py
```

## Power cycle

Unplug the Pico, then plug it into the **tablet** (or back into the Mac to watch HID). `boot.py` HID enablement applies only on power cycle / USB reset, not `supervisor.reload()`.

Default sequence (`sequence.default.json`, the PR 2 golden `sequence_v1.json`) is `run_mode: auto`: settle 1200 ms, then walk `at_ms` events once and idle forever (no loop).

## Gestures to observe

On the tablet, after settle:

| Event | What to look for |
|-------|------------------|
| tap `(0.52, 0.81)` hold 60 ms | Absolute pointer + left click |
| swipe `(0.80, 0.50) → (0.20, 0.50)` 400 ms | Contact held while interpolating (~16 ms steps) |
| key `chars: "ok"` | US QWERTY `o` then `k` |
| mouse_move absolute then relative | Last-position tracking |
| mouse_button left click | Down/up |
| wait | No extra HID |

A first-pass sanity check on a Mac: the pointer should jump (not crawl relatively) and a text field should receive `ok`.

Optional triggers (same firmware; wizard UI is later):

- `run_mode: "button"` — GP15 pull-up, press to GND
- `run_mode: "serial"` — USB CDC line **containing** `GO` (not any newline)

```sh
# example serial trigger after switching run_mode in sequence.json
# screen /dev/tty.usbmodem* 115200
# then type a line with GO
```

## MSC vs HID

Default keeps CIRCUITPY visible (`picoflow.storage_lock.ENABLE_STORAGE_LOCK = False`). If the tablet rejects the MSC+HID composite, set that flag `True` in `lib/picoflow/storage_lock.py`, recopy, and power-cycle. Held GP15 at plug-in stays in author mode (drive visible).

## Digitizer (not this PR)

`boot_digitizer.py` / `lib/picoflow/digitizer.py` / `hid-observe` land in the next PR. If abs-mouse is ignored, retest with the digitizer boot template after that PR. Manifest key `hidProfiles.digitizer_keyboard` is documented as existing later; do not add `boot_digitizer.py` here.

## Results template

Fill **before** treating the default `hidProfile` as locked. One row per tablet SKU.

| Date | Tablet SKU | Android | Operator | abs-mouse | MSC+HID | digitizer (PR 4) | Notes |
|------|------------|---------|----------|-----------|---------|------------------|-------|
| YYYY-MM-DD | e.g. Lenovo TB-X | x.y | name | yes / no | yes / no | — | settle, jitter, ignored clicks, … |

Copy extra rows as needed.

### How to score

- **abs-mouse yes** — tap lands near the intended normalized point; swipe tracks a line; pointer is absolute (not a relative crawl from the last host cursor).
- **abs-mouse no** — host enumerates a mouse but ignores absolute axes, or gestures never appear. Next PR: digitizer (usage page 0x0D, Tip Switch + In Range, report ID 3).
- **MSC+HID yes** — tablet talks HID while CIRCUITPY is still mounted on a Mac (or the tablet does not care). Operator units can keep storage on.
- **MSC+HID no** — HID fails until the drive is hidden. Flip `ENABLE_STORAGE_LOCK`.

CDC serial prints `run_mode`, then `index type at_ms` per event (never full `chars` payloads).

## CPython checks (no hardware)

```sh
python3 -m pytest tools/firmware-test
```
