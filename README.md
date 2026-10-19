# Team Operations v4.3.0

## Current Baseline

This repository is a browser-only single-page application built with HTML, CSS, and vanilla JavaScript.

- UI entry point: `index.html`
- Application logic and rendering: `script.js` (approximately 109 KB)
- Global styles and responsive rules: `style.css`
- Bundled branding asset: `zygal.jpeg`
- Persistence: browser `localStorage` under `teamOps_v3_db`
- Session state: browser `localStorage` or `sessionStorage` under `teamOps_v3_session`

The existing app currently provides login/demo roles, dashboard, daily work, attendance, projects, SIM cards, hardware faults, team management, reports, CSV export, project import, logo/profile settings, search, modals, and activity/defect history.

## Audit Findings

### Architecture

- The application is implemented as one global script rather than isolated modules.
- Rendering, state mutation, authorization checks, import/export, and DOM event wiring are mixed together.
- `script.js` contains duplicate function definitions. Later declarations override earlier ones, including dashboard, daily-work, and event-handling paths.
- Multiple document-level click listeners are registered, which makes action ordering difficult to reason about and increases regression risk.
- The existing data shape is a useful migration source, but it is not a relational model.

### Security and reliability

- Authentication is frontend-only and compares plaintext passwords stored in browser storage.
- Role checks are client-side UI checks and are not enforceable security boundaries.
- The former demo reset-password flow exposed a fake OTP; it has been removed from the active authentication path.
- `localStorage` is not shared between employees and can be modified by the user.
- Uploaded images and backup data are stored in browser storage, which can hit quota limits.
- External reverse geocoding and SheetJS loading depend on third-party network availability.
- User content is generally escaped before HTML rendering, but the large number of template renderers makes this hard to audit consistently.

### Data gaps

The current model has collections for users, projects, work, attendance, materials, SIM/hardware, activities, defects, form folders, and settings. It does not yet provide normalized relationships, immutable audit records, server-side validation, notifications, or database-enforced ownership and role policies.

## Upgrade Plan

### Phase 1: Baseline and stabilization

- Preserve the current local data format and user-visible features.
- Remove duplicate definitions and consolidate event delegation without changing rendered workflows.
- Add regression checks for login, navigation, search, CRUD forms, export, import, and role restrictions.
- Keep the browser demo explicitly labeled as non-production.

### Phase 2: Frontend boundaries

- Split stable responsibilities into small ES modules: configuration, state/storage adapter, auth adapter, permissions, navigation, search, notifications, exports, and feature renderers.
- Keep the current HTML/CSS visual language while extracting reusable form, table, modal, loading, and empty-state helpers.
- Preserve a local adapter so existing browser data remains available during migration.

### Phase 3: Supabase/PostgreSQL foundation

- Add schema, indexes, constraints, timestamps, foreign keys, and seed/migration scripts.
- Map the current local collections to profiles, employees, roles, departments, branches, projects, project members, attendance, daily work, hardware, SIM cards, notifications, and audit logs.
- Add a controlled migration utility with validation and duplicate reporting.

### Phase 4: Authentication and authorization

- Replace demo password verification with Supabase Auth.
- Use database policies and server-side checks for role and record ownership.
- Keep client-side permissions for UX only, never as the security boundary.

### Phase 5: Operational workflows

- Complete attendance ownership, daily-work review, asset assignment, notifications, and immutable audit logging.
- Add backend validation for unique employee IDs, serial numbers, SIM numbers, and valid status transitions.

### Phase 6: Reports, exports, and production readiness

- Add filtered employee, project, attendance, and daily-work reports.
- Keep CSV export lightweight and add XLSX generation where justified.
- Add loading/error states, accessibility checks, responsive verification, deployment configuration, and production documentation.

## Local Development

Run a static server from the repository folder, for example:

```powershell
python -m http.server 5500
```

Then open `http://localhost:5500`. The browser UI requires Supabase configuration for authentication; it does not contain a fallback password or fake OTP.

## Production Prerequisites

A production deployment requires a Supabase project, environment-specific public configuration, database migrations, Supabase Auth configuration, Row Level Security policies, and removal of plaintext demo credentials. Service-role keys, database credentials, and private tokens must never be placed in frontend files.

## Email OTP Authentication Setup

The browser integration is loaded from `js/config.js`, `js/supabase-client.js`, `js/auth.js`, and `js/database.js`. Supply the safe project URL and publishable/anon key before loading `index.html`:

```html
<script>
	window.TEAM_OPS_SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
	window.TEAM_OPS_SUPABASE_ANON_KEY = 'YOUR_PUBLISHABLE_OR_ANON_KEY';
</script>
```

Place that configuration before `js/config.js`, or inject the two values through the deployment template. Only the project URL and publishable/anon key may be browser-visible. Never use a service-role key in this file.

Apply `supabase/schema.sql` and then `supabase/policies.sql` in the Supabase SQL editor or through Supabase migrations. To remove the unused Tickets feature from an existing project, run `supabase/remove-tickets.sql`; this permanently deletes ticket and ticket-comment records. Seed the four rows in `roles` (`Admin`, `Assistant Manager`, `Team Lead`, and `Employee`) before provisioning the first employee. Employee Auth identities and matching `profiles` rows are created together by the secure Edge Function; authenticated sessions are restored with `getSession` and ended through Supabase Auth.

For SIM Details cloud persistence, apply `supabase/sim-card-storage.sql` after the schema and policies. It adds SIM image references, creates the private `sim-card-photos` Storage bucket, and adds role-based Storage policies. SIM card photos are uploaded as existing image files, stored in Supabase Storage, and can be opened in the app's fullscreen image viewer.

For the initial administrator, create `surendra.kamble@zygal.io` once under Supabase Authentication users, then run `supabase/bootstrap-admin.sql`. This links the Auth UUID to the `Admin` profile without exposing a privileged key to the browser.

The current login path is authorized Email OTP:

1. An Admin saves an employee through the existing Team/Users screen.
2. The browser invokes `supabase/functions/provision-employee`, which runs server-side with `SUPABASE_SERVICE_ROLE_KEY`. The function verifies the caller's Admin or Assistant Manager role, creates or updates the Auth identity, and upserts `public.profiles` using the same UUID as `auth.users.id`.
3. The employee enters the authorized email. `request_email_otp()` checks that the profile exists and is `Active`; unknown, inactive, and suspended employees are rejected before OTP delivery.
4. Supabase Auth sends and verifies the OTP. The application loads the matching profile by `auth.uid()`, checks status again, updates verification and last-login metadata, loads the stored role, and opens the existing dashboard.

Deploy the Edge Function with the Supabase CLI from the repository root:

```powershell
supabase functions deploy provision-employee
```

The Edge Function receives its `SUPABASE_SERVICE_ROLE_KEY` from the Supabase server environment. Do not add that secret to this repository, frontend configuration, HTML, browser storage, or deployment-exposed environment variables. The browser only calls the function with the current user's Supabase session.

Employee email changes update the existing Auth identity and its matching profile UUID; the old email is no longer an Auth email, and `email_verified` is reset until the new email completes OTP verification. Duplicate normalized emails and employee IDs are rejected by both the function and database indexes.

When the project configuration is absent, authentication is intentionally unavailable. At this phase, the new database adapter exposes real Supabase queries, but the legacy feature renderers still read and write the existing local `db` object. Employee provisioning and authentication require the Supabase project and deployed Edge Function; other operational modules retain their existing local development behavior until their incremental adapter migration.

## Verification Baseline

The current `script.js` passes Node's syntax check. Functional browser regression testing and backend integration are still outstanding and are part of the upgrade phases above.
