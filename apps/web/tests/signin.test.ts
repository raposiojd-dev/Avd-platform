import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBootstrapAdmin } from "@/lib/entra";
import { resetSetupCodeForTests, retireSetupCode, verifySetupCode } from "@/lib/setup-code";
import { safeReturnTo, signLoginState, signSession, verifyLoginState, verifySession } from "@/lib/session";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("setup code", () => {
  beforeEach(() => { resetSetupCodeForTests(); vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  const printed = () => {
    const line = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]).find((l) => l?.startsWith("TIDEWATCH SETUP CODE"));
    return line!.split(": ").pop()!;
  };

  it("accepts the printed code and rejects others", () => {
    expect(verifySetupCode("nope").ok).toBe(false);
    expect(verifySetupCode(printed()).ok).toBe(true);
  });

  it("locks after 5 wrong guesses, even for the right code, then unlocks", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) verifySetupCode("wrong", t0);
    const locked = verifySetupCode(printed(), t0 + 1000);
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    expect(verifySetupCode(printed(), t0 + 16 * 60_000).ok).toBe(true);
  });

  it("a retired code no longer works (a new one is generated)", () => {
    verifySetupCode("x");
    const first = printed();
    retireSetupCode();
    expect(verifySetupCode(first).ok).toBe(false);
  });
});

describe("session cookie", () => {
  it("round-trips the principal", async () => {
    const t = await signSession({ id: "oid-1", name: "Alex", roles: ["Operator"] }, KEY);
    expect(await verifySession(t, KEY)).toEqual({ id: "oid-1", name: "Alex", roles: ["Operator"] });
  });
  it("rejects a token signed with another key, and a tampered one", async () => {
    const t = await signSession({ id: "oid-1", name: "Alex", roles: ["Reader"] }, KEY);
    expect(await verifySession(t, OTHER_KEY)).toBeNull();
    const [h, , s] = t.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "oid-1", name: "Alex", roles: ["Admin"], exp: 9999999999 })).toString("base64url")}.${s}`;
    expect(await verifySession(forged, KEY)).toBeNull();
  });
  it("drops unknown roles", async () => {
    const t = await signSession({ id: "1", name: "a", roles: ["Root" as never, "Reader"] }, KEY);
    expect((await verifySession(t, KEY))?.roles).toEqual(["Reader"]);
  });
  it("login state round-trips and refuses another key", async () => {
    const s = { state: "s", nonce: "n", verifier: "v", returnTo: "/hosts" };
    const t = await signLoginState(s, KEY);
    expect(await verifyLoginState(t, KEY)).toEqual(s);
    expect(await verifyLoginState(t, OTHER_KEY)).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("keeps local paths and blocks open redirects", () => {
    expect(safeReturnTo("/hosts?filter=attention")).toBe("/hosts?filter=attention");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "", null, undefined, "/a://b"]) expect(safeReturnTo(bad as string)).toBe("/");
  });
});

describe("bootstrap admin", () => {
  const p = { id: "1", name: "A", roles: ["Reader" as const] };
  it("adds Admin only for the setup email, case-insensitively", () => {
    expect(withBootstrapAdmin(p, "me@example.com", "Me@Example.com").roles).toContain("Admin");
    expect(withBootstrapAdmin(p, "other@example.com", "me@example.com").roles).toEqual(["Reader"]);
    expect(withBootstrapAdmin(p, "", "me@example.com").roles).toEqual(["Reader"]);
  });
});

describe("settings store (local file mode)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tw-"));
    process.env.SETTINGS_FILE = path.join(dir, "s.json");
    (globalThis as { __settings?: unknown }).__settings = undefined;
    vi.resetModules();
  });
  afterEach(async () => { delete process.env.SETTINGS_FILE; await rm(dir, { recursive: true, force: true }); });

  const input = { tenantId: "11111111-1111-1111-1111-111111111111", clientId: "22222222-2222-2222-2222-222222222222", clientSecret: "super-secret-value", bootstrapAdminUpn: "me@example.com" };

  it("is empty at first, saves, and never exposes the secret in the public view", async () => {
    const m = await import("@/lib/settings");
    expect(await m.getSettings(true)).toBeNull();
    const saved = await m.saveSettings(input);
    expect(saved.sessionKey.length).toBeGreaterThan(20);
    expect(JSON.stringify(m.publicView(saved))).not.toContain("super-secret-value");
    expect((await stat(process.env.SETTINGS_FILE!)).mode & 0o077).toBe(0); // owner-only file
    expect(JSON.parse(await readFile(process.env.SETTINGS_FILE!, "utf8")).tenantId).toBe(input.tenantId);
  });

  it("keeps the session key on update and rotates it on request", async () => {
    const m = await import("@/lib/settings");
    const a = await m.saveSettings(input);
    const b = await m.saveSettings({ ...input, bootstrapAdminUpn: "x@example.com" });
    expect(b.sessionKey).toBe(a.sessionKey);
    const c = await m.saveSettings(input, { rotateSessionKey: true });
    expect(c.sessionKey).not.toBe(a.sessionKey);
  });

  it("rejects malformed ids and a short secret", async () => {
    const m = await import("@/lib/settings");
    expect(m.settingsInput.safeParse({ ...input, tenantId: "not-a-guid" }).success).toBe(false);
    expect(m.settingsInput.safeParse({ ...input, clientSecret: "short" }).success).toBe(false);
    expect(m.settingsInput.safeParse({ ...input, bootstrapAdminUpn: "nope" }).success).toBe(false);
  });
});
