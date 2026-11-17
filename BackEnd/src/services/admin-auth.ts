import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { randomToken, sha256 } from "../lib/security";
import type { AdminRef, Repo } from "../repo";

// Verified against when the username doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = await Bun.password.hash("y-space-dummy-password");

export class AdminAuth {
  constructor(
    private readonly repo: Repo,
    private readonly config: Config,
  ) {}

  async login(username: string, password: string) {
    const admin = await this.repo.findAdminByUsername(username);
    const ok = await Bun.password.verify(password, admin?.passwordHash ?? DUMMY_HASH).catch(() => false);
    if (!admin || !ok) throw new AppError("invalid_credentials", 401, "invalid username or password");

    await this.repo.pruneAdminSessions();
    const token = randomToken();
    const expiresAt = Date.now() + this.config.adminSessionTtlMs;
    await this.repo.createAdminSession(sha256(token), admin.id, expiresAt);
    return { token, expiresAt, admin: { id: admin.id, username: admin.username } };
  }

  logout(token: string): Promise<void> {
    return this.repo.deleteAdminSession(sha256(token));
  }

  /** `token` is the raw bearer token. */
  async authenticate(token: string | null | undefined): Promise<AdminRef | null> {
    if (!token) return null;
    return this.repo.findAdminBySession(sha256(token));
  }
}

export function bearerToken(header: string | null | undefined): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1]! : null;
}
