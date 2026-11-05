import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralises formula injection", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell("normal")).toBe("normal");
  });
  it("renders null as empty and builds rows", () => {
    expect(toCsv(["a", "b"], [[1, null], ["x", "y"]])).toBe("a,b\r\n1,\r\nx,y");
  });
});
