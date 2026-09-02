const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Crockford-base32 ULID (26 chars). Clip/photo/action ids must parse in Rust. */
export function newId(): string {
  let time = Date.now();
  const chars = new Array<string>(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ENCODING[time % 32]!;
    time = Math.floor(time / 32);
  }
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let acc = 0n;
  for (const byte of rand) {
    acc = (acc << 8n) | BigInt(byte);
  }
  for (let i = 25; i >= 10; i--) {
    chars[i] = ENCODING[Number(acc & 31n)]!;
    acc >>= 5n;
  }
  return chars.join("");
}
