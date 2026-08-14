import { Suspense } from "react";
import { lazyWithRecovery } from "@/lib/lazyWithRecovery";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { RequireAuth } from "@/components/RequireAuth";

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

const AdminDashboard = lazyWithRecovery(() => import("./pages/admin/AdminDashboard"));
const MovieForm = lazyWithRecovery(() => import("./pages/admin/MovieForm"));
const EventForm = lazyWithRecovery(() => import("./pages/admin/EventForm"));
const ConcertForm = lazyWithRecovery(() => import("./pages/admin/ConcertForm"));
const VenueForm = lazyWithRecovery(() => import("./pages/admin/VenueForm"));
const ShowingForm = lazyWithRecovery(() => import("./pages/admin/ShowingForm"));
const StaffPOS = lazyWithRecovery(() => import("./pages/admin/StaffPOS"));
const TicketScanner = lazyWithRecovery(() => import("./pages/admin/TicketScanner"));
const HostDashboard = lazyWithRecovery(() => import("./pages/admin/HostDashboard"));
const SponsorshipForm = lazyWithRecovery(() => import("./pages/admin/SponsorshipForm"));
const AuditLog = lazyWithRecovery(() => import("./pages/admin/AuditLog"));
const Superadmin = lazyWithRecovery(() => import("./pages/admin/Superadmin"));

// The ComingSoon pages are named exports sharing one module, so they also
// share one chunk.
const comingSoon = () => import("./pages/ComingSoon");
const SilentFilmFestivalPage = lazyWithRecovery(() => comingSoon().then(m => ({ default: m.SilentFilmFestivalPage })));
const AccessibilityPage = lazyWithRecovery(() => comingSoon().then(m => ({ default: m.AccessibilityPage })));

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
                    already hold. */}
                <Route path="/film-passes" element={<FilmPassesPage />} />
                <Route path="/my-passes" element={<MyPasses />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/movies/:id" element={<MovieForm />} />
                <Route path="/admin/movies/new" element={<MovieForm />} />
                <Route path="/admin/events/:id" element={<EventForm />} />
                <Route path="/admin/events/new" element={<EventForm />} />
                <Route path="/admin/concerts/:id" element={<ConcertForm />} />
                <Route path="/admin/concerts/new" element={<ConcertForm />} />
                <Route path="/admin/venues/:id" element={<VenueForm />} />
                <Route path="/admin/venues/new" element={<VenueForm />} />
                <Route path="/admin/showings/new" element={<ShowingForm />} />
                <Route path="/admin/showings/:id" element={<ShowingForm />} />
                <Route path="/admin/sponsorships/new" element={<SponsorshipForm />} />
                <Route path="/admin/sponsorships/:id" element={<SponsorshipForm />} />
                <Route path="/admin/audit-log" element={<AuditLog />} />
                <Route path="/admin/pos" element={<StaffPOS />} />
                <Route path="/admin/scanner" element={<TicketScanner />} />
                <Route path="/host" element={<HostDashboard />} />
                <Route path="/sponsors" element={<Sponsors />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/rental-request" element={<RentalRequest />} />
                <Route path="/rentals" element={<Rentals />} />
                <Route path="/donate" element={<Donate />} />
                {/* The lending library is not public. Signing in means staff
                    while member accounts are off, so this is the box-office
                    catalogue — a logged-out visitor is sent to /auth rather
                    than shown a shelf they cannot borrow from. */}
                <Route path="/dvds" element={<RequireAuth><Dvds /></RequireAuth>} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/silent-film-festival" element={<SilentFilmFestivalPage />} />
                <Route path="/press" element={<PressPage />} />
                <Route path="/hiring" element={<HiringPage />} />
                <Route path="/accessibility" element={<AccessibilityPage />} />
                <Route path="/volunteer" element={<VolunteerPage />} />
                <Route path="/superadmin" element={<Superadmin />} />
                <Route path="/contract/:token" element={<RentalContract />} />
                <Route path="/verify/:id" element={<VerifyContract />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Layout>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
