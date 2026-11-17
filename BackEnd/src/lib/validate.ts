import { AppError } from "./errors";

export function cleanName(input: unknown): string {
  if (typeof input !== "string") throw new AppError("invalid_name", 400, "name is required");
  // strip control chars, collapse whitespace
  const name = input.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 60) {
    throw new AppError("invalid_name", 400, "name must be 1-60 characters");
  }
  return name;
}

/**
 * Accepts `linkedin.com/in/foo`, `https://www.linkedin.com/in/foo/?x=1`, `in.linkedin.com/in/foo`...
 * Returns a canonical https URL (no query/hash) plus a lowercase `key` used to recognise the same
 * person (e.g. to keep a kicked person out).
 */
export function parseLinkedin(input: unknown): { url: string; key: string } {
  const bad = () => new AppError("invalid_linkedin_url", 400, "provide a valid LinkedIn profile URL");
  if (typeof input !== "string") throw bad();
  let raw = input.trim();
  if (!raw || raw.length > 300) throw bad();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad();
  }
  const host = u.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) throw bad();

  const m = u.pathname.match(/^\/(in|pub|company)\/([^/]+)/i);
  if (!m) throw bad();
  const kind = m[1]!.toLowerCase();
  const slug = decodeURIComponent(m[2]!);
  if (!slug) throw bad();

  return {
    url: `https://www.linkedin.com/${kind}/${encodeURIComponent(slug)}`,
    key: `${kind}/${slug.toLowerCase()}`,
  };
}

export function cleanSecret(input: unknown, label = "secret"): string {
  if (typeof input !== "string") throw new AppError("invalid_secret", 400, `${label} is required`);
  const s = input.trim();
  if (s.length < 6 || s.length > 64) {
    throw new AppError("invalid_secret", 400, `${label} must be 6-64 characters`);
  }
  return s;
}

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

/**
 * Topic tags: up to 5, each a short word. "#Tech", " tech " and "Tech" are the same tag, "machine learning" becomes
 * "machine-learning", repeats are dropped. Stored lowercase without the "#". Anything else is refused with a reason
 * (never silently cut), so what the host sees is what is saved.
 */
export function cleanTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new AppError("invalid_tags", 400, "tags must be a list of words");
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") throw new AppError("invalid_tags", 400, "tags must be words");
    const tag = raw
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .replace(/^#+/, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!tag) continue; // an empty box is not an error
    if (tag.length > MAX_TAG_LENGTH) throw new AppError("invalid_tags", 400, `a tag can be at most ${MAX_TAG_LENGTH} characters`);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(tag)) throw new AppError("invalid_tags", 400, "tags can use letters, numbers and dashes");
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > MAX_TAGS) throw new AppError("invalid_tags", 400, `add at most ${MAX_TAGS} tags`);
  return out;
}
