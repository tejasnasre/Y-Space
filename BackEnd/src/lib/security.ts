import { timingSafeEqual } from "node:crypto";

// 32 symbols => `byte % 32` is unbiased. No look-alikes (i/l/o/0/1).
const LOWER = "abcdefghijkmnpqrstuvwxyz23456789";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomString(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** 32 random bytes, base64url. Used for admin sessions and participant sessions. */
export const randomToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const sha256 = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

/** Short id used in the shareable space link. */
export const newSpaceId = (): string => randomString(LOWER, 10);

/** Human friendly secret, e.g. `K7M2QX9A`. */
export const generateSecret = (): string => randomString(UPPER, 8);

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = new Bun.CryptoHasher("sha256").update(a).digest();
  const hb = new Bun.CryptoHasher("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
