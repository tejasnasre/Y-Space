/** Mirrors the server's rules, so what you see as a pill is exactly what is saved. */
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 24;

/** Popular topics to start from. Tapping one adds it as a pill. */
export const TAG_SUGGESTIONS = ["tech", "design", "startups", "ai", "product", "career"];

/** "#Tech " -> "tech", "Machine Learning" -> "machine-learning". Returns "" when nothing usable is left. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // drop anything a tag cannot contain
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_TAG_LENGTH);
}
