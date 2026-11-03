import { describe, expect, it } from "vitest";
import { hasRole, parseClientPrincipal } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/guard";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("parseClientPrincipal", () => {
  it("reads the object id, name and app roles", () => {
    const p = parseClientPrincipal(enc({ claims: [
      { typ: "http://schemas.microsoft.com/identity/claims/objectidentifier", val: "oid-1" },
      { typ: "name", val: "Alex Example" },
      { typ: "roles", val: "Operator" },
    ] }));
    expect(p).toEqual({ id: "oid-1", name: "Alex Example", roles: ["Operator"] });
  });

  it("ignores unknown roles and returns no role rather than guessing", () => {
    const p = parseClientPrincipal(enc({ claims: [{ typ: "oid", val: "x" }, { typ: "roles", val: "SuperUser" }] }));
    expect(p?.roles).toEqual([]);
  });

  it("rejects garbage and missing headers", () => {
    expect(parseClientPrincipal(null)).toBeNull();
    expect(parseClientPrincipal("not base64 json")).toBeNull();
    expect(parseClientPrincipal(enc({ claims: [] }))).toBeNull();
  });
});

describe("hasRole", () => {
  it("orders Reader < Operator < Admin", () => {
    expect(hasRole({ id: "1", name: "a", roles: ["Operator"] }, "Reader")).toBe(true);
    expect(hasRole({ id: "1", name: "a", roles: ["Operator"] }, "Admin")).toBe(false);
    expect(hasRole({ id: "1", name: "a", roles: [] }, "Reader")).toBe(false);
  });
});

describe("assertSameOriginMutation", () => {
  const mk = (h: Record<string, string>) => new Request("https://app.example/api/hosts/action", { method: "POST", headers: h });
  it("allows same-origin requests that carry the custom header", () => {
    expect(assertSameOriginMutation(mk({ origin: "https://app.example", host: "app.example", "x-requested-with": "avd-platform" }))).toBeNull();
  });
  it("blocks cross-site requests", () => {
    expect(assertSameOriginMutation(mk({ origin: "https://evil.example", host: "app.example", "x-requested-with": "avd-platform" }))?.status).toBe(403);
  });
  it("blocks a missing custom header and a missing Origin", () => {
    expect(assertSameOriginMutation(mk({ origin: "https://app.example", host: "app.example" }))?.status).toBe(403);
    expect(assertSameOriginMutation(mk({ host: "app.example", "x-requested-with": "avd-platform" }))?.status).toBe(403);
  });
});
