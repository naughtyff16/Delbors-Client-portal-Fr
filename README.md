# Delbros Leasing — Client & Vendor Portal

External client and vendor self-service portal.

Standalone project (split from the former `frontend` monorepo on 25-Oct-2026). It has its own copy of the shared code, so it builds, runs and deploys on its own:

| Folder | What it is |
|---|---|
| `src/` (except `src/lib`) | The portal screens, routing and app shell |
| `src/lib/ui` | Shared screen components (forms, tables, calendar, print preview…) and the theme |
| `src/lib/shared` | Types, formats, settings, business calculations, change log |
| `src/lib/api-client` | In-browser mock API and sample data (stored in the browser's local storage) |
| `public/app-config.json` | Runtime settings (portal / staff links, `showDemoLogins`, `showChangeLog`) — editable after deploy |

The `src/lib` folders are also present in the staff app project. A fix to shared code must be made in both projects.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install libraries (first time) |
| `npm run dev` | Start on http://localhost:5174 |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (business calculations) |
| `npm run build` | Production build to `dist/` + no-CDN check |
| `npm run package:aws` | Checks, build and `../deploy/delbros-portal-web-<version>.zip` |
| `npm run changelog:md` | Regenerate `CHANGELOG.md` from `src/lib/shared/changelog.ts` |
