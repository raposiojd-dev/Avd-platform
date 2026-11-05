import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// First-run protection. While the site is unconfigured, the Setup page is reachable by anyone who can reach the
// URL, so saving settings needs a one-time code that is printed ONLY to the server log (App Service "Log stream").
// A guess budget stops brute force: 5 wrong codes locks setup for 15 minutes.

interface State { code: string | null; failures: number; lockedUntil: number }
const g = globalThis as unknown as { __setup?: State };
const st = (): State => (g.__setup ??= { code: null, failures: 0, lockedUntil: 0 });

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export function ensureSetupCode(): void {
  const s = st();
  if (s.code) return;
  s.code = randomBytes(18).toString("base64url");
  // This line is the whole delivery mechanism. It is not an audit event and must not be sent anywhere else.
  console.log(`TIDEWATCH SETUP CODE (valid until setup completes or the app restarts): ${s.code}`);
}

const digest = (v: string) => createHash("sha256").update(v).digest();

export function verifySetupCode(input: string, now = Date.now()): { ok: true } | { ok: false; reason: "locked" | "wrong"; retryAfterSeconds?: number } {
  const s = st();
  if (now < s.lockedUntil) return { ok: false, reason: "locked", retryAfterSeconds: Math.ceil((s.lockedUntil - now) / 1000) };
  ensureSetupCode();
  const ok = timingSafeEqual(digest(input.trim()), digest(s.code!));
  if (ok) {
    s.failures = 0;
    return { ok: true };
  }
  s.failures += 1;
  if (s.failures >= MAX_FAILURES) {
    s.failures = 0;
    s.lockedUntil = now + LOCK_MS;
    return { ok: false, reason: "locked", retryAfterSeconds: LOCK_MS / 1000 };
  }
  return { ok: false, reason: "wrong" };
}

export function retireSetupCode(): void {
  const s = st();
  s.code = null;
  s.failures = 0;
}

export function resetSetupCodeForTests(): void {
  g.__setup = undefined;
}
