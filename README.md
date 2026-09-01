# PicoFlow

Desktop app that turns a photographed walkthrough of a device UI into a timed HID sequence, then flashes that sequence onto a Raspberry Pi Pico.

Working title: **PicoFlow**. Repo: `hid-automator`. macOS is the v1 platform.

## Clone and run

```sh
git clone <repo-url> hid-automator
cd hid-automator
pnpm install
pnpm tauri dev
```

Requires a recent stable Rust toolchain and Node.js with [pnpm](https://pnpm.io). No Homebrew or vcpkg packages are needed for the app or the image pipeline.

```sh
pnpm typecheck
cargo test --workspace
```

## Flashing a Pico (BOOTSEL)

1. Hold the **BOOTSEL** button on the Pico.
2. Plug in USB. The board mounts as `RPI-RP2`.
3. Copy the CircuitPython UF2 onto that volume as **raw bytes**.

Do **not** drag the UF2 in Finder on macOS Ventura+. Finder writes extended attributes that the RP2040 bootloader cannot store, and the copy can fail or brick the flash step. Use a POSIX byte copy (`open` / `write` / `fsync`) via `tools/copy-uf2.py` (dest vanished after a full write is success). HID spike procedure: `docs/hid-spike.md`.

After the UF2, the board remounts as `CIRCUITPY`. Sequence files are written the same way (byte copy, no Finder, no `._*` AppleDouble files). Then unplug and plug the Pico into the target tablet.

## Linux (P1)

Volume detection and flash on Linux are P1. When they land, udev rules may be needed if the MSC device node is root-only. Do not `chmod 777` the device.
