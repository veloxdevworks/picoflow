import { useId } from "react";

/** `adafruit_hid.keycode.Keycode` names. Aliases included; firmware uses getattr. */
export const KEYCODES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "ZERO",
  "ENTER",
  "RETURN",
  "ESCAPE",
  "BACKSPACE",
  "TAB",
  "SPACEBAR",
  "SPACE",
  "MINUS",
  "EQUALS",
  "LEFT_BRACKET",
  "RIGHT_BRACKET",
  "BACKSLASH",
  "POUND",
  "SEMICOLON",
  "QUOTE",
  "GRAVE_ACCENT",
  "COMMA",
  "PERIOD",
  "FORWARD_SLASH",
  "CAPS_LOCK",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "F21",
  "F22",
  "F23",
  "F24",
  "PRINT_SCREEN",
  "SCROLL_LOCK",
  "PAUSE",
  "INSERT",
  "HOME",
  "PAGE_UP",
  "DELETE",
  "END",
  "PAGE_DOWN",
  "RIGHT_ARROW",
  "LEFT_ARROW",
  "DOWN_ARROW",
  "UP_ARROW",
  "KEYPAD_NUMLOCK",
  "KEYPAD_FORWARD_SLASH",
  "KEYPAD_ASTERISK",
  "KEYPAD_MINUS",
  "KEYPAD_PLUS",
  "KEYPAD_ENTER",
  "KEYPAD_ONE",
  "KEYPAD_TWO",
  "KEYPAD_THREE",
  "KEYPAD_FOUR",
  "KEYPAD_FIVE",
  "KEYPAD_SIX",
  "KEYPAD_SEVEN",
  "KEYPAD_EIGHT",
  "KEYPAD_NINE",
  "KEYPAD_ZERO",
  "KEYPAD_PERIOD",
  "KEYPAD_BACKSLASH",
  "KEYPAD_EQUALS",
  "APPLICATION",
  "POWER",
  "LEFT_CONTROL",
  "CONTROL",
  "LEFT_SHIFT",
  "SHIFT",
  "LEFT_ALT",
  "ALT",
  "OPTION",
  "LEFT_GUI",
  "GUI",
  "WINDOWS",
  "COMMAND",
  "RIGHT_CONTROL",
  "RIGHT_SHIFT",
  "RIGHT_ALT",
  "RIGHT_GUI",
] as const;

const INPUT_CLASS =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500 disabled:opacity-50";

export function KeyPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (keycode: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  return (
    <>
      <input
        list={listId}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-label="Keycode"
        placeholder="ENTER"
        className={INPUT_CLASS}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {KEYCODES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
