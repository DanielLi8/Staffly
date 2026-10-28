import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every advisory the CI audit gate ignores must carry a written justification
 * in docs/dependency-audit.md, and the doc must not list ids that are no
 * longer ignored.
 */
const root = resolve(__dirname, "../..");

function ignoredGhsas(): string[] {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return pkg.pnpm?.auditConfig?.ignoreGhsas ?? [];
}

function justifiedGhsas(): Map<string, string> {
  const doc = readFileSync(resolve(root, "docs/dependency-audit.md"), "utf8");
  const table = doc.split("<!-- audit-allowlist:start -->")[1]?.split("<!-- audit-allowlist:end -->")[0];
  if (!table) throw new Error("allowlist table markers not found in docs/dependency-audit.md");
  const rows = new Map<string, string>();
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (/^GHSA-/.test(cells[1] ?? "")) rows.set(cells[1], cells[4] ?? "");
  }
  return rows;
}

describe("audit allowlist", () => {
  it("justifies every ignored advisory", () => {
    const rows = justifiedGhsas();
    for (const id of ignoredGhsas()) {
      expect(rows.get(id), `${id} has no justification row`).toBeTruthy();
    }
  });

  it("documents only advisories that are actually ignored", () => {
    expect(Array.from(justifiedGhsas().keys()).sort()).toEqual([...ignoredGhsas()].sort());
  });
});
