# CIRCUITPY/code.py — load sequence, settle, optional trigger, play once, idle.
import time

from picoflow.playback import Player
from picoflow.sequence import load
from picoflow.trigger import wait_button, wait_serial

SEQUENCE_PATH = "/sequence.json"


def main(path=SEQUENCE_PATH, idle=True, player_cls=Player):
    try:
        seq = load(path)
    except Exception as exc:
        print("sequence load failed")
        print(exc)
        if idle:
            while True:
                time.sleep(1)
        return None
    print("run_mode", seq.run_mode)
    time.sleep(seq.settle_ms / 1000.0)
    if seq.run_mode == "button":
        wait_button(seq.button_pin)
    elif seq.run_mode == "serial":
        wait_serial()
    player_cls(seq).run()
    if idle:
        while True:
            time.sleep(1)
    return seq


if __name__ == "__main__":
    main()
