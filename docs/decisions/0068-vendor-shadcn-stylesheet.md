# 0068 Vendor the shadcn stylesheet and drop the package

Date: 7 November 2026. Status: implemented.

## Problem

CI's `pnpm audit` in `frontend/` failed on two advisories, both reached only through the `shadcn` package:
`minimatch` (moderate, via `shadcn > ts-morph > @ts-morph/common`) and `deepmerge` (low, via `shadcn` and
`shadcn > @shadcn/registry`). The app imports one file from that package, `shadcn/tailwind.css`, in
`src/styles/globals.css`. The rest of the package is a command-line scaffolding tool that the dashboard never
runs or bundles.

## Options

- Override `minimatch` to 11.x. Works for the first advisory only; `deepmerge` has no patched release, so the
  audit would still fail.
- Move the package to a dev dependency and run `pnpm audit --prod`. Passes, but weakens the gate that §0.7 sets
  for every package and hides advisories in the build tooling.
- Allow-list the advisories. The dashboard is read-only and the code is not reachable, but an allow-list needs
  review on every audit and leaves the packages installed.
- Vendor the one stylesheet and remove the package. Chosen.

## Decision

`frontend/src/styles/shadcn.css` is the unmodified `dist/tailwind.css` of shadcn 4.23.0, preceded by a comment
carrying its origin and the MIT licence text. `globals.css` imports it by relative path and `shadcn` is removed from
`package.json` and the lockfile. The components in `src/components/ui/` were already copied into the repository
and do not import the package.

## Result

`pnpm audit` reports no known vulnerabilities in `frontend/` and `backend/` (*measured*, 7 November 2026). The
dashboard builds, its 65 tests pass, and the built CSS still contains the accordion keyframes and custom variants.

## Trade-off

The stylesheet no longer updates with the package. It changes rarely and holds Tailwind variants and two
keyframes; refresh it by hand from a tagged shadcn release if a future component needs a new variant.
