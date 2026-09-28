import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(input: { secret: string; account: string; issuer: string }): string {
  return `otpauth://totp/${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}?secret=${input.secret}&issuer=${encodeURIComponent(input.issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  const counter = Math.floor(now / 1000 / 30);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = generateTotp(secret, counter + offset);
    const actual = Buffer.from(code);
    const expectedBuffer = Buffer.from(expected);
    if (actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)) {
      return true;
    }
  }
  return false;
}

function generateTotp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
