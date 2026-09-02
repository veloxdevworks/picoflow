# v1 acceptance

Maps spec §12 to the commands, UI, and HID spike that close each item. v1 acceptance is **macOS**; Windows/Linux volume detection is P1 (see [windows-linux.md](windows-linux.md)).

On-device sequences are **JSON** (`sequence.json`), not YAML.

## Checklist (spec §12)

| # | Criterion | How |
|---|---------|-----|
| 1 | Import three photos of an Android OOBE, auto- or manually-normalize each, and place them as clips on a timeline. | `pick_import_photos` → `import_photos` (EXIF-oriented JPEG/PNG; HEIC via `sips` on macOS). `detect_screen_quad`; confidence `< 0.55` or reject opens four handles. Confirm calls `warp_photo` and appends a 4000 ms clip. |
| 2 | Add at least one tap, one swipe, and one key event as keyframes; drag them; clip durations change delays as expected. | Warped viewer tap/swipe; inspector for key/`wait`/`mouse_*`. Clip right-edge rubber-band then `ripple_clip` (keep-attached clamp). Reorder via `reorder_clips`. Timeline zoom/scroll and snap (clip edges + keyframes) are UI-only. |
| 3 | Export a sequence file the runtime can parse. | File → Export sequence → `export_sequence` / `write_sequence_file`. Flattened `sequence.json`: `run_mode`, `settle_ms`, `hid_profile`, `events[]` sorted by `at_ms`. Golden: `crates/picoflow-core/tests/fixtures/sequence_v1.json`. |
| 4 | From a machine with no prior CircuitPython install, flash a stock Pico using only this app. | Install wizard: poll `list_pico_volumes` for `RPI-RP2`, `flash_uf2` (bundled UF2, `write_file_bytes`), wait for `CIRCUITPY`, `write_circuitpy` (runtime + `sequence.json`; empty events are legal), `eject_volume`. Run mode (auto / button / serial) is `target.runMode` and ships in `sequence.json`. |
| 5 | Plug that Pico into the development host and observe composite HID keyboard + mouse reports corresponding to the sequence (even before tablet validation). | Manual. Power-cycle the Pico onto the Mac, then `python3 tools/hid-observe/observe.py`. Framed report IDs (not a hex dump): `id=1` key, `id=2` abs-mouse, `id=3` digitizer. Procedure: [hid-spike.md](hid-spike.md). Not CI. |
| 6 | Plug into the target Android tablet and complete at least one real OOBE tap that the tablet registers. | Manual. Same HID spike procedure; fill the results table in [hid-spike.md](hid-spike.md) (SKU, abs-mouse, MSC+HID, digitizer). Outcome may change the **default** `hidProfile` in `assets/firmware/manifest.json`. Schema stays additive until that table is filled. |
| 7 | Update only the sequence file on CIRCUITPY and see the new timing/actions on next plug-in, without re-copying the UF2. | Wizard offers sequence-only when `picoflow.json` matches bundled `runtime.version` **and** `hid_profile`. `write_sequence_only` writes `sequence.json` only. HID/runtime mismatch → full install. |
| 8 | macOS UF2 copy succeeds on a current macOS (Ventura or later class), where Finder drag-and-drop of UF2 is known to fail. | `write_file_bytes` / `tools/copy-uf2.py`: POSIX `open`/`write`/`fsync`. Dest vanished after a full write is **success**. Do not Finder-drag. Leave the Pico window closed until Done (AppleDouble `._*` fills CIRCUITPY). |

## HID spike outcome

Fill [hid-spike.md](hid-spike.md) **Results template** before treating the default `hidProfile` as locked. One row per tablet SKU.

| Signal | Pass |
|--------|------|
| abs-mouse | Tap lands near the intended normalized point; swipe tracks a line; pointer is absolute. |
| digitizer (fallback) | `boot_digitizer.py` replacement; `hid-observe` shows `id=3` with `tip=1 in_range=1` on contact; **no** `id=2`. |
| MSC+HID | Tablet talks HID while CIRCUITPY is still mounted (or does not care). If not, `ENABLE_STORAGE_LOCK`. |

Default remains `absolute_mouse_keyboard` until the table says otherwise.

## Out of v1 (do not accept)

- **OCR** / on-screen text as a control signal (IMG-6).
- **RP2350** / Pico 2 first-class UF2 (P2).
- **Looping** or branching sequences (idle after the last event).
- **Mouse wheel** HID events (`mouse_move` / `mouse_button` only).
