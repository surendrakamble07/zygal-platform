# ZYGAL Platform: Project Context for Contributors and AI Assistants

This document is a map of the repository as it exists today, not a product specification. Read the source files and migrations before changing behavior; update this document when the architecture or important workflows change. Do not treat this as a substitute for the database schema or live Supabase configuration.

## Project at a glance

ZYGAL is an internal team-operations application. The repository is mid-transition and currently contains **two separate frontends and two incompatible Supabase data models**:

1. `legacy-app/` is the feature-rich, browser-based operations application. Its UI and feature data are still primarily backed by browser storage.
2. `web/` is the newer React/TypeScript application. It currently implements email-code login and a small session-history home page; it is not yet the replacement for the legacy feature set.

The root `supabase/migrations/` directory defines the schema used by the newer React app. `legacy-app/supabase/` contains an older, different schema and associated scripts. They both use names such as `public.profiles` and `public.projects`, but their columns, roles, and workflows differ. **Do not apply both schema generations to one database or assume one frontend can use the other generation's schema.** Confirm the intended target environment before changing or deploying either.

There is no root package manifest. The Node project is under `web/`.

## Repository map

### New React app: `web/`

- `src/main.tsx`: React entry point; imports global CSS and renders `App` in `StrictMode`.
- `src/App.tsx`: `HashRouter` routes. `/login` is the login flow; `/` is protected; unknown paths redirect to `/`.
- `src/auth/AuthProvider.tsx`: Supabase auth state, profile validation, email OTP actions, remembered-login expiry, and activity/session tracking.
- `src/auth/auth-context.ts`: shared role, profile, status, and auth action types plus `useAuth`.
- `src/lib/supabase.ts`: Supabase client initialization from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; throws if either is missing.
- `src/pages/LoginPage.tsx`: official-email OTP form, code verification, resend cooldown, and user-facing errors.
- `src/pages/HomePage.tsx`: signed-in user greeting and latest five tracked sessions; refreshes every 30 seconds.
- `src/index.css`: shared responsive styles and light/dark color variables.
- `package.json`: Vite, React 19, React Router, Supabase JS, TypeScript, and ESLint scripts.
- `README.md`: uncustomized Vite template documentation; it is not the authoritative ZYGAL setup guide.

The React app currently has only login and session-history UX. It does **not** yet implement the legacy projects, sites, jobs, attendance, assets, or reporting screens. Authentication and session storage use the root Supabase schema.

#### React auth and session behavior

- Auth uses Supabase email OTP with `shouldCreateUser: false`; this app does not create accounts from the login page.
- After a session is available, the app reads `profiles` by auth user ID and requires an active profile. Missing, inactive, or unverifiable profiles are signed out locally.
- Supported frontend roles are `support`, `team_lead`, and `admin`.
- A browser-local activity timestamp enforces a seven-day remembered-login limit. This is separate from tracked work sessions.
- A tracked session starts through `start_session`; activity may cause `session_heartbeat` calls (heartbeat interval is two minutes). Explicit logout calls `end_session`.
- The database closes idle tracked sessions after 15 minutes. The UI polls the session list every 30 seconds.
- Current limitations visible in the code: the session-list query does not surface query errors, and asynchronous auth/profile setup has no user-facing error boundary. Preserve or improve error handling intentionally when modifying these flows.

### Legacy app: `legacy-app/`

- `index.html` provides the login screen, sidebar, header/search, content area, modal, and toast containers; it loads the browser Supabase SDK and JS adapters before `script.js`.
- `script.js` is a large, global vanilla-JavaScript SPA containing data migration/storage, authentication flow, navigation, feature rendering, forms, CSV import/export, and event wiring.
- `style.css` contains the visual system; some additional feature styling is inline in `index.html`.
- `js/config.js`, `js/supabase-client.js`, `js/auth.js`, and `js/database.js` are browser configuration, Supabase client, auth, and generic data adapters.
- `zygal.jpeg` is the legacy brand image.
- `README.md` documents the legacy app's baseline, known technical debt, intended phased upgrade, and legacy Supabase/OTP setup. It is helpful historical context but describes the legacy schema, not the root migrations.

The legacy navigation/feature inventory includes Dashboard, Daily Work, Attendance, Projects & Sites, Hardware Faults, SIM Details, Team, Reports, Users, Settings, and Defect & Correction History (some entries are role-gated). Its documented feature set also includes employee/team management, search, attendance/work forms, SIM/hardware records, CSV export and project import, profile/logo settings, modals, and activity/defect history.

Important legacy constraints:

- Core operations still read/write the browser-local `teamOps_v3_db`; local data is not shared across users and is not a production database.
- `script.js` has duplicate function definitions and multiple document-level click handlers, as noted in `legacy-app/README.md`. Later definitions can override earlier ones; trace the active definition before editing.
- The legacy adapters expose Supabase operations, but the README explicitly says the feature renderers have not all migrated from the local `db` object.
- Legacy roles are `Admin`, `Assistant Manager`, `Team Lead`, and `Employee`. Legacy UI role checks are not a security boundary; rely on server-side authorization for real protection.
- `legacy-app/supabase/schema.sql`, `policies.sql`, `bootstrap-admin.sql`, and `sim-card-storage.sql` belong to this older schema. `remove-tickets.sql` permanently drops the old ticket tables and data; do not run it casually.
- `legacy-app/supabase/functions/provision-employee/index.ts` provisions legacy employee profiles with Supabase Auth. Its role names and profile columns are from the old schema.

### New Supabase schema: `supabase/`

- `config.toml`: local Supabase project configuration; PostgreSQL major version 17, local API/database/Studio ports, Auth-related local services, and a configured seed path.
- `migrations/` are ordered by timestamp. Apply the root migrations as a unit to the database intended for the React app:
  1. `20261021100100_reference_tables.sql`: lookup lists, states, projects/types, `profiles`, role enum and role helper functions.
  2. `20261021100200_core_tables.sql`: engineers, sites, devices, jobs, checklists, material issues, status history, audit log, indexes and constraints.
  3. `20261021100300_session_tracking.sql`: `user_sessions`, `login_events`, session RPCs, and `v_online_now`.
  4. `20261021100400_triggers_and_rules.sql`: timestamps, auditing, soft-delete authorization, job/material validation, and status-history triggers.
  5. `20261021100500_security_rls.sql`: grants, RLS, and role policies.
  6. `20261021100600_reference_data.sql`: starter dropdown/state/project/project-type data.

The new schema's main entities are:

- Reference data: `call_types`, `handover_statuses`, `final_statuses`, `material_items`, `material_problems`, `checklist_items`, `checklist_results`, `states`, `projects`, and `project_types`.
- People and sites: `profiles`, `engineers`, `sites`, and `devices`.
- Operations: `jobs`, `job_checklist`, and `material_issues`.
- Oversight: `job_status_history`, `audit_log`, `user_sessions`, and `login_events`.

New-schema rules worth preserving:

- `profiles.id` matches `auth.users.id`; roles are the enum values `support`, `team_lead`, and `admin`. Active profiles determine staff/lead/admin authorization.
- A site's project type must belong to that project; branch codes are unique within a project; latitude/longitude must both be present or both absent.
- An active, non-deleted SIM number or MAC address cannot be assigned to multiple active devices.
- Completed/Live jobs require handover not Pending and no Pending material issues. Job status changes are timestamped and retained in history.
- Material issues on closed jobs must be resolved; resolving an issue stamps its resolution time.
- Sites, devices, and jobs use soft deletion. Hard deletes are broadly revoked; a few detail-line deletes are permitted by RLS and audited.
- RLS is the authorization boundary. Support can see its own tracked sessions; leads/admins can see more. Keep frontend role checks as UX only.
- Session timeout after 15 minutes is separate from the browser's seven-day remembered-login limit. `close_stale_sessions()` is intended for a trusted scheduled call, but the migration comments say scheduling remains to be configured.

### Project data and other references

- `docs/data/master sheet.xlsx` is a tracked workbook and is referenced by the migration seed comments as the cleaned source for lookup values. Inspect it directly before changing seeded lists; do not copy bulk workbook contents into this context note.
- `docs/data/questions.md` is currently empty.
- Root `.gitignore` excludes `docs/data/` for new untracked data, but the workbook and questions file are already tracked.
- Supabase CLI `.temp` state files exist in the repository tree. Treat them as local/project linkage metadata; do not copy their contents into docs or expose credentials. `web/.env.local` is ignored and must remain untracked.

## Local development and verification

From the repository root, run the web app commands in `web/`:

```powershell
cd web
npm install
npm run dev
npm run build
npm run lint
```

`npm run build` runs TypeScript project builds and Vite production build. `npm run lint` runs ESLint. There is currently no test script or committed automated test suite in `web/package.json`.

For the React app, create `web/.env.local` with:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Use only the Supabase publishable/anon key in browser configuration. Never put a service-role key or other secret in the frontend, repository, or documentation.

The legacy README describes static-server development and legacy Supabase setup. Read it before working on the legacy app, but do not use its schema/bootstrap SQL as a setup recipe for the root React migrations.

## Contributor guidance

1. First determine whether a change targets `legacy-app/` or `web/` and which Supabase schema generation it depends on.
2. Keep changes narrow and follow the existing style of the relevant frontend. Preserve user-visible workflows and role behavior.
3. Treat database constraints, triggers, RLS, and server-side checks as authoritative; never rely on client-only validation for security or data integrity.
4. Never include local environment values, auth tokens, service-role keys, or Supabase CLI temporary metadata in code, examples, logs, or this document.
5. After implementation, run the smallest relevant check; for React changes use `npm run build` and/or `npm run lint` from `web/`.
6. Update this file when routes, schemas, migration order, setup, or significant operational behavior changes. Re-check source and migrations rather than relying on remembered notes.

## Known setup check

`supabase/config.toml` currently configures `./seed.sql`, while the tracked root Supabase files shown in this repository are migrations and no root `supabase/seed.sql` is present. The reference data is inserted by migration 6. Confirm whether the local seed path should be changed or a seed file added before relying on `supabase db reset`.
