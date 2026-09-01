# HID spike — absolute mouse on Android

Manual procedure for PR 3/4. **Never Finder-drag** a UF2 onto `RPI-RP2` (macOS Ventura+ writes xattrs the RP2040 bootloader cannot store). Default profile is still keyboard + absolute mouse. Digitizer is a **replacement** boot template (not a third device) plus `tools/hid-observe` for report-ID framed host observation.

Pinned artifacts (recorded in `assets/firmware/manifest.json`):

- CircuitPython **10.3.0** `raspberry_pi_pico` `en_US` (current stable at vendor time; design pin was ~10.2.1)
- Adafruit HID **6.1.10** (`693baa60eb684bb53379d98c6a036f56b8010666`)
- Runtime **0.1.0**, default HID profile `absolute_mouse_keyboard` (report ID 2, 16-bit, logical 0–32767)
- Fallback profile `digitizer_keyboard` (`boot_digitizer.py`, usage page 0x0D, Tip Switch + In Range, report ID 3) — does **not** change the default

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

A first-pass sanity check on a Mac: the pointer should jump (not crawl relatively) and a text field should receive `ok`. Confirm with `tools/hid-observe/observe.py` (framed `id=2 move(x,y) btn=…` / `id=1 key …`, not a hex dump).

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

## Host HID observe

Preview does not emit HID on the authoring machine. Plug the Pico back into the Mac after a power cycle and run:

```sh
pip install hidapi   # once; provides `import hid`
python3 tools/hid-observe/observe.py
```

`hid-observe` lists HID interfaces matching CircuitPython Pico **VID `0x239A` / PID `0x80F4`** (confirmed in the pinned 10.3.0 UF2) and prints **report-ID framed** lines using the shipped descriptors:

| Report ID | Profile | Example |
|-----------|---------|---------|
| 1 | keyboard (both) | `id=1 key modifiers=0x00 keys=O,K` |
| 2 | abs-mouse (default) | `id=2 move(17039,26541) btn=0x01` |
| 3 | digitizer (fallback) | `id=3 move(17039,26541) tip=1 in_range=1` |

Do not treat an unframed hex dump as the observer output. `--list` prints matching interfaces only. `--vid` / `--pid` override if a board enumerates differently.

## Digitizer retest (replacement pointing device)

If abs-mouse is ignored, **replace** `boot.py` with the digitizer template. Digitizer is not additive: keyboard + digitizer (report ID 3), no absolute mouse, no CircuitPython relative mouse.

`--install-runtime` still copies `boot_abs_mouse.py` (default unchanged). One-file swap:

```sh
python3 tools/copy-uf2.py \
  assets/firmware/runtime/boot_digitizer.py \
  /Volumes/CIRCUITPY/boot.py
```

If this volume was flashed before digitizer landed, recopy `lib/picoflow/` (or re-run `--install-runtime` then the boot swap above) so `digitizer.py` is on CIRCUITPY. Unplug/replug — `boot.py` HID enablement applies only on power cycle.

Then the same gestures as the abs-mouse pass (tap, swipe, key). On contact the digitizer sets **Tip Switch and In Range** (v1: both bits follow contact; no hover-only In Range). Logical/physical max is 32767; if the tablet needs a dummy Physical Maximum, record it in the results table — do not change the default profile yet.

On the Mac, `hid-observe` should show `id=3 move(x,y) tip=1 in_range=1` during contact and `id=1 key …` for `ok`. There must be **no** `id=2` mouse reports on this profile.

Manifest: `hidProfiles.digitizer_keyboard.boot` = `runtime/boot_digitizer.py`. Leave `absolute_mouse_keyboard` as the default until this table is filled.

## Results template

Fill **before** treating the default `hidProfile` as locked. One row per tablet SKU.

| Date | Tablet SKU | Android | Operator | abs-mouse | MSC+HID | digitizer (PR 4) | Notes |
|------|------------|---------|----------|-----------|---------|------------------|-------|
| YYYY-MM-DD | e.g. Lenovo TB-X | x.y | name | yes / no | yes / no | — | settle, jitter, ignored clicks, … |

Copy extra rows as needed.

### How to score

- **abs-mouse yes** — tap lands near the intended normalized point; swipe tracks a line; pointer is absolute (not a relative crawl from the last host cursor).
- **abs-mouse no** — host enumerates a mouse but ignores absolute axes, or gestures never appear. Retest with `boot_digitizer.py` (usage page 0x0D, Tip Switch + In Range, report ID 3).
- **digitizer yes** — tap/swipe register as touch at the intended normalized point; `hid-observe` shows `id=3` with `tip=1 in_range=1` on contact. No `id=2` reports.
- **digitizer no** — tablet enumerates the digitizer but ignores it, or only hover (In Range without Tip Switch) appears. Record whether a dummy Physical Maximum was required.
- **MSC+HID yes** — tablet talks HID while CIRCUITPY is still mounted on a Mac (or the tablet does not care). Operator units can keep storage on.
- **MSC+HID no** — HID fails until the drive is hidden. Flip `ENABLE_STORAGE_LOCK`.

CDC serial prints `run_mode`, then `index type at_ms` per event (never full `chars` payloads).

## CPython checks (no hardware)

```sh
python3 -m pytest tools/firmware-test
```
