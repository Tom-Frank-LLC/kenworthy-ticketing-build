import { Suspense } from "react";
import { lazyWithRecovery } from "@/lib/lazyWithRecovery";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { AdminOnly, StaffOnly } from "@/components/RoleGate";
import { ColorLabProvider } from "@/components/colorlab/ColorLabProvider";

// The home page is the overwhelming majority of first loads, so it ships in
// the entry chunk. Everything else is split per route: this is what keeps
// the admin tree — POS, scanner, recharts, xlsx, jspdf, html2pdf,
// html5-qrcode — out of a ticket buyer's download.
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// A deploy deletes the previous build's content-hashed chunks, and an
// already-open tab is still running the old shell, so it asks for filenames
// the server no longer has. lazyWithRecovery reloads once instead of letting
// React unmount to a blank page. See src/lib/lazyWithRecovery.ts.
const Auth = lazyWithRecovery(() => import("./pages/Auth"));
const CalendarPage = lazyWithRecovery(() => import("./pages/Calendar"));
const Showing = lazyWithRecovery(() => import("./pages/Showing"));
const MyTickets = lazyWithRecovery(() => import("./pages/MyTickets"));
const PublicTicket = lazyWithRecovery(() => import("./pages/PublicTicket"));
const MyPasses = lazyWithRecovery(() => import("./pages/MyPasses"));
const FilmPassesPage = lazyWithRecovery(() => import("./pages/FilmPasses"));
const FilmPassDetail = lazyWithRecovery(() => import("./pages/FilmPassDetail"));
const Profile = lazyWithRecovery(() => import("./pages/Profile"));
const ResetPassword = lazyWithRecovery(() => import("./pages/ResetPassword"));
const Sponsors = lazyWithRecovery(() => import("./pages/Sponsors"));
const HistoryPage = lazyWithRecovery(() => import("./pages/History"));
const RentalRequest = lazyWithRecovery(() => import("./pages/RentalRequest"));
const Rentals = lazyWithRecovery(() => import("./pages/Rentals"));
const RentalContract = lazyWithRecovery(() => import("./pages/RentalContract"));
const VerifyContract = lazyWithRecovery(() => import("./pages/VerifyContract"));
const Donate = lazyWithRecovery(() => import("./pages/Donate"));
const Dvds = lazyWithRecovery(() => import("./pages/Dvds"));
const AboutPage = lazyWithRecovery(() => import("./pages/About"));
const HiringPage = lazyWithRecovery(() => import("./pages/Hiring"));
const VolunteerPage = lazyWithRecovery(() => import("./pages/Volunteer"));
const PressPage = lazyWithRecovery(() => import("./pages/Press"));
const ConcessionsPage = lazyWithRecovery(() => import("./pages/Concessions"));
const SilentFilmFestivalPage = lazyWithRecovery(() => import("./pages/SilentFilmFestival"));
// Unlisted: linked only from the neon sign at the bottom of the home page, and
// noindex'd so being linked does not make it a search result.
const Backstage = lazyWithRecovery(() => import("./pages/Backstage"));
const Privacy = lazyWithRecovery(() => import("./pages/Privacy"));
const Terms = lazyWithRecovery(() => import("./pages/Terms"));

// The counter tools. Their own section rather than a corner of /admin: selling
// a ticket and editing the schedule are different jobs, and the people doing the
// first one should not have to walk through the second.
const StaffDashboard = lazyWithRecovery(() => import("./pages/staff/StaffDashboard"));
const StaffPOS = lazyWithRecovery(() => import("./pages/staff/StaffPOS"));
const TicketScanner = lazyWithRecovery(() => import("./pages/staff/TicketScanner"));
const PrintQrs = lazyWithRecovery(() => import("./pages/staff/PrintQrs"));

const AdminDashboard = lazyWithRecovery(() => import("./pages/admin/AdminDashboard"));
const MovieForm = lazyWithRecovery(() => import("./pages/admin/MovieForm"));
const EventForm = lazyWithRecovery(() => import("./pages/admin/EventForm"));
const ConcertForm = lazyWithRecovery(() => import("./pages/admin/ConcertForm"));
const VenueForm = lazyWithRecovery(() => import("./pages/admin/VenueForm"));
const ShowingForm = lazyWithRecovery(() => import("./pages/admin/ShowingForm"));
const HostDashboard = lazyWithRecovery(() => import("./pages/admin/HostDashboard"));
const SponsorshipForm = lazyWithRecovery(() => import("./pages/admin/SponsorshipForm"));
const AuditLog = lazyWithRecovery(() => import("./pages/admin/AuditLog"));
const Superadmin = lazyWithRecovery(() => import("./pages/admin/Superadmin"));

// ComingSoon is a named export rather than a default, so the import has to be
// unwrapped by hand.
const AccessibilityPage = lazyWithRecovery(() =>
  import("./pages/ComingSoon").then(m => ({ default: m.AccessibilityPage })));

const queryClient = new QueryClient();

/** Matches the in-page loading state the routes themselves render. */
const RouteFallback = () => (
  <div className="container py-16 text-center text-muted-foreground">Loading...</div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          {/* Above Layout so the footer link and the sign-in card can both
              reach it, and so its overrides land on <html> before first paint.
              Inside AuthProvider because the footer entry point depends on
              whether anyone is signed in. */}
          <ColorLabProvider>
            <Layout>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/showing/:id" element={<Showing />} />
                  <Route path="/my-tickets" element={<MyTickets />} />
                  {/* Public ticket link from confirmation email/SMS — no auth. */}
                  <Route path="/t/:token" element={<PublicTicket />} />
                  {/* Buying a film pass — public, no sign-in. Distinct from
                      /my-passes, which only shows a signed-in patron what they
                      already hold. /film-passes browses; /film-pass/:id is the
                      one place a pass is actually bought, and is where an old
                      /film-passes?pass=<id> link redirects to. Singular and
                      :id-keyed to match /showing/:id. */}
                  <Route path="/film-passes" element={<FilmPassesPage />} />
                  <Route path="/film-pass/:id" element={<FilmPassDetail />} />
                  <Route path="/my-passes" element={<MyPasses />} />
                  <Route path="/profile" element={<Profile />} />
                  {/* Management, and only management. Every form here already
                      refused a non-admin from inside its own effect; the gate
                      makes /admin itself say the same thing, and says it before
                      the page mounts and starts querying. Staff no longer reach
                      any of it — the counter is /staff. */}
                  <Route path="/admin" element={<AdminOnly><AdminDashboard /></AdminOnly>} />
                  <Route path="/admin/movies/:id" element={<AdminOnly><MovieForm /></AdminOnly>} />
                  <Route path="/admin/movies/new" element={<AdminOnly><MovieForm /></AdminOnly>} />
                  <Route path="/admin/events/:id" element={<AdminOnly><EventForm /></AdminOnly>} />
                  <Route path="/admin/events/new" element={<AdminOnly><EventForm /></AdminOnly>} />
                  <Route path="/admin/concerts/:id" element={<AdminOnly><ConcertForm /></AdminOnly>} />
                  <Route path="/admin/concerts/new" element={<AdminOnly><ConcertForm /></AdminOnly>} />
                  <Route path="/admin/venues/:id" element={<AdminOnly><VenueForm /></AdminOnly>} />
                  <Route path="/admin/venues/new" element={<AdminOnly><VenueForm /></AdminOnly>} />
                  <Route path="/admin/showings/new" element={<AdminOnly><ShowingForm /></AdminOnly>} />
                  <Route path="/admin/showings/:id" element={<AdminOnly><ShowingForm /></AdminOnly>} />
                  <Route path="/admin/sponsorships/new" element={<AdminOnly><SponsorshipForm /></AdminOnly>} />
                  <Route path="/admin/sponsorships/:id" element={<AdminOnly><SponsorshipForm /></AdminOnly>} />
                  <Route path="/admin/audit-log" element={<AdminOnly><AuditLog /></AdminOnly>} />
                  {/* Where the counter tools used to live. Kept as redirects
                      because these two are bookmarked on the box-office iPad
                      and written down in half a dozen briefs — a hard move
                      would turn all of that into a 404 on a shift. */}
                  <Route path="/admin/pos" element={<Navigate to="/staff/pos" replace />} />
                  <Route path="/admin/scanner" element={<Navigate to="/staff/scanner" replace />} />

                  {/* The Staff section. StaffOnly refuses before the child
                      mounts, so a pasted URL never reaches a till that would
                      then fail on every button; the pages keep their own
                      guards, and RLS and the edge functions are the real
                      boundary. */}
                  <Route path="/staff" element={<StaffOnly><StaffDashboard /></StaffOnly>} />
                  <Route path="/staff/pos" element={<StaffOnly><StaffPOS /></StaffOnly>} />
                  {/* The one staff tool a host runs: their own event's door. */}
                  <Route
                    path="/staff/scanner"
                    element={<StaffOnly allowHost><TicketScanner /></StaffOnly>}
                  />
                  <Route path="/staff/print-qr" element={<StaffOnly><PrintQrs /></StaffOnly>} />
                  <Route path="/host" element={<HostDashboard />} />
                  <Route path="/sponsors" element={<Sponsors />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/rental-request" element={<RentalRequest />} />
                  <Route path="/rentals" element={<Rentals />} />
                  <Route path="/donate" element={<Donate />} />
                  <Route path="/dvds" element={<Dvds />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="/silent-film-festival" element={<SilentFilmFestivalPage />} />
                  <Route path="/backstage" element={<Backstage />} />
                  <Route path="/press" element={<PressPage />} />
                  <Route path="/concessions" element={<ConcessionsPage />} />
                  <Route path="/hiring" element={<HiringPage />} />
                  <Route path="/accessibility" element={<AccessibilityPage />} />
                  <Route path="/volunteer" element={<VolunteerPage />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/superadmin" element={<Superadmin />} />
                  <Route path="/contract/:token" element={<RentalContract />} />
                  <Route path="/verify/:id" element={<VerifyContract />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Layout>
          </ColorLabProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
