# Beacon Room nRF52840 dongle firmware

This project turns a nice!nano-compatible Pro Micro nRF52840 board into a dedicated USB controller for SteamVR Base Station 2.0 power management.

The firmware is a BLE central itself: it scans for `LHB-` stations, resolves a station by its advertised name on every operation, connects to the Lighthouse power service, writes the desired state, reads it back, then disconnects. Beacon Room talks to the board over USB CDC serial instead of using the operating system's Bluetooth stack.

## Board and bootloader

The default target is Zephyr's official `promicro_nrf52840/nrf52840/uf2` board, which covers nice!nano, Pro Micro nRF52840, and SuperMini-compatible boards. It preserves the board's Adafruit UF2 bootloader; it does not replace it.

## Build

Install the Zephyr SDK and `west`, then create a Zephyr workspace from this manifest once:

```powershell
python -m pip install west
west init -l firmware
west update
west zephyr-export
```

Build the UF2 image from the repository root:

```powershell
west build -s firmware -b promicro_nrf52840/nrf52840/uf2 --pristine
```

The resulting firmware is `build/zephyr/zephyr.uf2`.

## Ready-to-flash test image

This repository also includes a firmware image built for the default board target:
[`dist/beacon-room-dongle-promicro_nrf52840.uf2`](dist/beacon-room-dongle-promicro_nrf52840.uf2).
Use it directly for testing, or build your own image using the command above.

## Flash

1. Briefly bridge **GND** and **RST** twice to enter the UF2 bootloader. The board's LED should start fading and a USB drive should appear.
2. Copy the ready-to-flash image above (or your own `build/zephyr/zephyr.uf2`) to that drive, or run `west flash` after the build.
3. Reconnect the board normally. Windows should expose **Beacon Room Dongle** as a serial `COM` port.
4. In Beacon Room, open **Settings → Station controller**, choose **USB dongle**, enter that port (for example, `COM5`), and save.

The official Zephyr board documentation uses the same UF2 target and describes the double-reset bootloader entry procedure.

## USB identity

The checked-in defaults use Zephyr's development USB VID for a personal, local build. Do not redistribute firmware with that VID. Set an assigned VID/PID through a local configuration fragment before distributing a dongle.

## USB protocol

The protocol is line-based and intentionally small. Every response ends in `DONE`.

```text
SCAN
STATION AA:BB:CC:DD:EE:FF unknown LHB-12345678
DONE

STATUS LHB-12345678
STATE AA:BB:CC:DD:EE:FF on LHB-12345678
DONE

POWER LHB-12345678 OFF
STATE AA:BB:CC:DD:EE:FF off LHB-12345678
DONE
```

Errors use `ERROR <reason>` followed by `DONE`. The desktop application serializes all requests, so the firmware deliberately handles one scan or GATT connection at a time.
