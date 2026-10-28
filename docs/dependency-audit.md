# Dependency audit gate

CI's **Dependency audit** job runs:

```sh
pnpm audit --prod --audit-level=high
```

It fails the build on any **high** or **critical** advisory in a production
dependency (dev-only tooling is not gated; run `pnpm audit` without `--prod`
to see it). Run the same command locally before opening a PR that touches
`package.json` or `pnpm-lock.yaml`.

## When the gate fails

Fix it in this order:

1. **Bump the direct dependency** to a patched version in the same major
   (`pnpm add <pkg>@<version>`), then read its changelog for the bumped range.
2. **Transitive dependency, parent's range already allows the fix:** add a
   scoped override under `pnpm.overrides` in `package.json` that only matches
   the vulnerable range, e.g. `"axios@<1.20.0": "^1.20.0"`. Never override
   across a major the parent does not declare support for.
3. **No non-breaking fix exists** (the fix is only in a new major): allowlist
   it, below, and track the real upgrade as follow-up work.

## Allowlisting an advisory

1. Add the GHSA id to `pnpm.auditConfig.ignoreGhsas` in `package.json`.
2. Add a row to the table below: the id, package, what it is, why it is not
   fixed or not reachable here, and what removes it.

Both lists must match - `tests/security/audit-allowlist.test.ts` fails if an
id is ignored without a justification row (or a row is left behind after the
id is removed). Remove the entry as soon as the upgrade that fixes it lands.

<!-- audit-allowlist:start -->
| Advisory | Package | Issue | Why allowlisted | Removed by |
| --- | --- | --- | --- | --- |
| GHSA-m99w-x7hq-7vfj | next | Server Actions CPU DoS | Fixed only in 15.5.x. Reachable (App Router + Server Actions); impact is per-process availability, not data. | Next 15.5 upgrade (review S13) |
| GHSA-p3m5-59mp-jv5r | next | Server Actions CPU DoS | Fixed only in 15.5.x. Same exposure as GHSA-m99w-x7hq-7vfj. | Next 15.5 upgrade (review S13) |
| GHSA-h25m-26qc-wcjf | next | RSC request deserialization DoS | Fixed only in 15.0.8+. Availability only. | Next 15.5 upgrade (review S13) |
| GHSA-q4gf-8mx6-v5v3 | next | Server Components DoS | Fixed only in 15.5.x. Availability only. | Next 15.5 upgrade (review S13) |
| GHSA-8h8q-6873-q5fj | next | Server Components DoS | Fixed only in 15.5.x. Availability only. | Next 15.5 upgrade (review S13) |
| GHSA-2xp9-vwfh-vxw4 | next | Image Optimization RCE (AVIF) | Fixed only in 15.5.x. Not reachable: nothing uses `next/image` and `images.unoptimized` makes `/_next/image` a 404. | Next 15.5 upgrade (review S13) |
| GHSA-2464-fhr4-w9xw | next | Image Optimization RCE (SVG, via `sharp`) | Fixed only in 15.5.x. Not reachable: optimizer disabled as above, and `sharp` is not installed. | Next 15.5 upgrade (review S13) |
| GHSA-p293-qw3h-jr36 | next | RCE when hosted on Windows | Fixed only in 15.5.x. Not reachable: deployed on Linux (Vercel). | Next 15.5 upgrade (review S13) |
| GHSA-c4j6-fc7j-m34r | next | SSRF via WebSocket upgrades | Fixed only in 15.5.x. Not reachable: the app has no WebSocket upgrade handling. | Next 15.5 upgrade (review S13) |
| GHSA-36qx-fr4f-26g5 | next | Middleware bypass, Pages Router + i18n | Fixed only in 15.5.x. Not reachable: App Router only, no `i18n` config. | Next 15.5 upgrade (review S13) |
| GHSA-89xv-2m56-2m9x | next | SSRF in Server Actions on custom servers | Fixed only in 15.5.x. Not reachable: no custom server (`next start` / Vercel). | Next 15.5 upgrade (review S13) |
| GHSA-p9j2-gv94-2wf4 | next | SSRF in rewrites with attacker-controlled host | Fixed only in 15.5.x. Not reachable: `next.config.mjs` defines no rewrites. | Next 15.5 upgrade (review S13) |
| GHSA-mrhx-c7xc-m3w5 | zod | Memory exhaustion on huge arrays | Fixed only in zod 4 (breaking API; `inngest` also depends on zod 3). Every `z.array` input is `.max()`-bounded and Server Action bodies are capped at Next's 1 MB default. | zod 4 migration |
<!-- audit-allowlist:end -->

## Known dev-only advisories (not gated)

- `tinypool` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr, critical) via
  `vitest@3`: fixed only in tinypool 2, which vitest 3 does not support. It
  only runs the local/CI test workers on our own code. Removed by a vitest 4
  upgrade.
