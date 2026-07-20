# Kenworthy Ticketing Platform — Operations & Handoff Guide

> **Purpose:** This document is the single source of truth for everything needed to operate, maintain, and eventually hand off the Kenworthy ticketing platform. It should be updated every time a new credential, service, or configuration is added. A future owner should be able to reconstruct the full picture from this document alone.

---

## 1. Platform Overview

| Item | Detail |
|---|---|
| **Platform name** | Kenworthy Ticketing |
| **Client** | Kenworthy Performing Arts Centre |
| **Primary contact** | [Client name, email, phone] |
| **Built by** | Tom Frank |
| **Tech stack** | React + Vite, Tailwind CSS, Supabase, Cloudflare Pages |
| **Repository** | https://github.com/mrtomfrank/kenworthy-ticketing-build |
| **Production URL** | https://kenworthy-ticketing-build.mrtomfrank.workers.dev |
| **Staging URL** | [To be added after Cloudflare deploy] |

---

## 2. Services & Accounts

### 2.1 GitHub
- **Account:** mrtomfrank (Tom Frank)
- **Repo:** `kenworthy-ticketing-build` (public)
- **Purpose:** Version control and source of truth for all code
- **Access:** Tom Frank owns the repo. To hand off: transfer repo to client org or add collaborators under Settings → Collaborators.

### 2.2 Supabase
- **Account:** [Email used to create account — to be filled in]
- **Organization:** Kenworthy Performing Arts Centre *(to be created)*
- **Project name:** [To be filled in]
- **Project ID:** `lbgkfdqjcvjkteecatas`
- **Dashboard:** https://supabase.com/dashboard
- **Purpose:** Database, authentication, and backend logic (Edge Functions)
- **To hand off:** Invite client's email as Organization Owner via Settings → Members, then remove Tom Frank.
- **⚠️ Never commit:** The service role key (distinct from the anon/publishable key). The anon key is safe for client-side use but the service role key has full database access.

### 2.3 Cloudflare Pages
- **Account:** [Email used — to be filled in]
- **Project name:** [To be filled in after setup]
- **Dashboard:** https://dash.cloudflare.com
- **Purpose:** Hosts and deploys the frontend application
- **To hand off:** Add client's email as Account Member with Admin role via Manage Account → Members, then remove Tom Frank. Or transfer to a new account they own.

### 2.4 Square (Payments)
- **Account:** [Theater's existing Square account]
- **Developer console:** https://developer.squareup.com
- **Application name:** [To be created — e.g. "Kenworthy Ticketing"]
- **Environment:** Sandbox during development; Production for go-live
- **Purpose:** Payment processing for ticket purchases
- **To hand off:** The Square developer application should live in the theater's own Square account from the start. Tom Frank works with their credentials.

---

## 3. Environment Variables

These variables must be set in **Cloudflare Pages → Settings → Environment Variables**. They are never committed to the repository.

| Variable | Where to find it | Environment |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API | Both |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Project Settings → API (anon key) | Both |
| `VITE_SQUARE_APP_ID` | Square Developer Console → Credentials | Both |
| `VITE_SQUARE_ENV` | Set to `sandbox` for staging, `production` for prod | Per environment |
| `VITE_SQUARE_LOCATION_ID` | Square Developer Console → Locations | Both |

> **Note:** Cloudflare Pages supports per-environment variables. Staging and Production can have different values for the same key — use this to keep Square sandbox credentials on staging and live credentials on production.

---

## 4. Deployment

### Branch strategy
| Branch | Deploys to | Purpose |
|---|---|---|
| `main` | Production URL | What the public sees. Only merge here when tested. |
| `staging` | Preview URL | Testing ground. All development work goes here first. |

### Deploy process
1. Make changes locally on a feature branch
2. Test locally with `npm run dev`
3. Run `npm run build` — must pass clean before pushing
4. Merge to `staging` → Cloudflare auto-deploys to preview URL
5. Test on the preview URL
6. Merge `staging` → `main` → Cloudflare auto-deploys to production

### Build settings (Cloudflare Pages)
| Setting | Value |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 (set via environment variable `NODE_VERSION=20`) |

---

## 5. Database

- **Platform:** Supabase (Postgres)
- **Schema migrations:** Located in `/supabase/migrations/` in the repo
- **To apply migrations:** `npx supabase db push` (requires Supabase CLI and project linked)
- **Backups:** Supabase Pro plan includes daily backups. Confirm plan level before go-live.

### Key tables
| Table | Purpose |
|---|---|
| `profiles` | Extended user data (name, role) linked to Supabase auth |
| `user_roles` | Assigns `admin` or `regular_user` role to each user |
| `movies` | Film and event listings |
| `showings` | Scheduled screenings tied to a movie |
| `seats` | Seat map for assigned-seating showings |
| `bookings` | Ticket purchase records |
| `tickets` | Individual tickets with QR code UUIDs |

### Granting admin access to a new staff member
1. Have them sign up via the app at `/auth`
2. Go to Supabase dashboard → Table Editor → `user_roles`
3. Insert a row: `user_id` = their UUID (found in Authentication → Users), `role` = `admin`
4. Have them sign out and back in

---

## 6. Known Issues & Technical Debt

These are issues identified during the build audit. They should be resolved before go-live.

| Priority | Issue | Status |
|---|---|---|
| 🔴 High | Payment processing is simulated — no real Square integration | Not started |
| 🔴 High | No email confirmation sent after ticket purchase | Not started |
| 🟡 Medium | No race condition protection on seat booking (two users could book the same seat simultaneously) | Not started |
| 🟡 Medium | Tax rate hardcoded as Idaho 6% — confirm correct jurisdiction | Needs client confirmation |
| 🟡 Medium | Seat map not tied to specific venue/room — single global pool | Not started |
| 🟢 Low | `lovable-tagger` dev dependency is a Lovable-specific residual | Low risk; harmless in production |
| 🟢 Low | Only two roles (`admin`, `regular_user`) — no `staff` role for box office without full admin | Not started |

---

## 7. Go-Live Checklist

- [ ] Square sandbox testing complete — all purchase flows verified
- [ ] Square production credentials added to Cloudflare (production environment only)
- [ ] Email confirmation system live and tested
- [ ] Custom domain configured in Cloudflare
- [ ] Supabase project confirmed on paid plan (for backups and scale)
- [ ] Tax rate confirmed with client
- [ ] Admin accounts created for all staff who need them
- [ ] Client trained on admin panel
- [ ] Handoff doc reviewed with client's designated owner
- [ ] Tom Frank removed from Supabase org (or role reduced to Member)

---

## 8. Support & Contacts

| Role | Name | Contact |
|---|---|---|
| Platform builder | Tom Frank | mrtomfrank@gmail.com *(dev phase)* → support@kenworthy.org *(post-handoff)* |
| Client primary contact | Colin Mannex (Executive Director) | See `CONTACTS.md` (private, not in repo) |
| Client technical owner | Colin Mannex *(to be trained on platform ownership)* | See `CONTACTS.md` (private, not in repo) |

---

*Last updated: July 2026*
*Maintained by: Tom Frank*
