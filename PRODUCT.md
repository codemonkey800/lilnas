# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Jeremy, who builds and runs the server and is the main admin, plus a small set of invited people (friends, family, Discord members) who sign in through one shared login. They use the media and bot apps (download, tdr-bot, portal); Jeremy also uses the admin tools (dev, tdr-code, auth).

## Product Purpose

lilnas is a self-hosted NAS at `*.lilnas.io` that runs a set of unrelated apps: download, dev, tdr-bot, tdr-code, auth, portal and dashcam. Success is that moving between them feels like walking between rooms of one house, not launching a different product, and that every app works well on a phone and in a long desktop session.

## Positioning

One home server, many rooms. The apps share nothing functionally, so the shared system (`@lilnas/ui`) exists to make them feel like one place. No commercial product offers this particular set of apps behind one login.

## Operating Context

- Two usage modes, both confirmed: phone, often on the couch (requesting titles, checking activity and progress), and long desktop admin sessions (logs, tables, env files, stack control).
- Media apps are comfortable-density; admin apps are compact-density.
- Production deploys by pushing to `main`; dev stacks are listed and controlled from dev.lilnas.io.

## Capabilities and Constraints

- Apps in scope for the shared library: download, dev, auth, tdr-code, tdr-bot, portal, dashcam. `theater` is out of scope.
- One shared package, `@lilnas/ui`, with one look across all apps; per-app exceptions are allowed later.
- Primitives are built on Base UI (decided); `tdr-bot`'s MUI is removed as a late migration step.
- Stack: Next.js and Vite front ends, Tailwind v4, `cns()` for class names, pnpm and Turbo monorepo.
- Decided: the visual direction is Category Standard, dark by default (2026-10-23; see `DESIGN.md`). Undecided: which apps migrate first beyond `download` and `dev`, which already ship the previous system.

## Brand Commitments

- Keep the pepe badge and subdomain "doorplate" as the signature in every app's shell.
- Purple is the main colour and dark is the default. The previous Ultraviolet system is retired; `DESIGN.md` now describes Category Standard.

## Evidence on Hand

- Real running apps with real data: `apps/download`, `apps/dev`, and others under `apps/`.
- The pepe sprite (`apps/download/src/components/ui/sprite.tsx`) is the only brand asset.
- No real poster or key art is committed; any mockup art is synthetic and must be labelled.
- No user research, analytics or testimonials exist; do not invent them.

## Product Principles

- One place, many rooms: continuity between apps beats per-app personality.
- Phone and desktop are equals; neither is an afterthought.
- Density follows the job: comfortable for media, compact for admin tools.
- The system earns its place by being extracted from real screens, not designed in the abstract.
