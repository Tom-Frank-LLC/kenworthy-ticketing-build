import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { Layout } from "@/components/Layout";

// The home page is the overwhelming majority of first loads, so it ships in
// the entry chunk. Everything else is split per route: this is what keeps
// the admin tree — POS, scanner, recharts, xlsx, jspdf, html2pdf,
// html5-qrcode — out of a ticket buyer's download.
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const Auth = lazy(() => import("./pages/Auth"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const Showing = lazy(() => import("./pages/Showing"));
const MyTickets = lazy(() => import("./pages/MyTickets"));
const PublicTicket = lazy(() => import("./pages/PublicTicket"));
const MyPasses = lazy(() => import("./pages/MyPasses"));
const FilmPassesPage = lazy(() => import("./pages/FilmPasses"));
const Profile = lazy(() => import("./pages/Profile"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Sponsors = lazy(() => import("./pages/Sponsors"));
const HistoryPage = lazy(() => import("./pages/History"));
const RentalRequest = lazy(() => import("./pages/RentalRequest"));
const Rentals = lazy(() => import("./pages/Rentals"));
const RentalContract = lazy(() => import("./pages/RentalContract"));
const VerifyContract = lazy(() => import("./pages/VerifyContract"));
const Donate = lazy(() => import("./pages/Donate"));
const Dvds = lazy(() => import("./pages/Dvds"));
const AboutPage = lazy(() => import("./pages/About"));
const HiringPage = lazy(() => import("./pages/Hiring"));
const VolunteerPage = lazy(() => import("./pages/Volunteer"));

const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const MovieForm = lazy(() => import("./pages/admin/MovieForm"));
const EventForm = lazy(() => import("./pages/admin/EventForm"));
const ConcertForm = lazy(() => import("./pages/admin/ConcertForm"));
const VenueForm = lazy(() => import("./pages/admin/VenueForm"));
const ShowingForm = lazy(() => import("./pages/admin/ShowingForm"));
const StaffPOS = lazy(() => import("./pages/admin/StaffPOS"));
const TicketScanner = lazy(() => import("./pages/admin/TicketScanner"));
const HostDashboard = lazy(() => import("./pages/admin/HostDashboard"));
const SponsorshipForm = lazy(() => import("./pages/admin/SponsorshipForm"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const Superadmin = lazy(() => import("./pages/admin/Superadmin"));

// The ComingSoon pages are named exports sharing one module, so they also
// share one chunk.
const comingSoon = () => import("./pages/ComingSoon");
const SilentFilmFestivalPage = lazy(() => comingSoon().then(m => ({ default: m.SilentFilmFestivalPage })));
const PressPage = lazy(() => comingSoon().then(m => ({ default: m.PressPage })));
const AccessibilityPage = lazy(() => comingSoon().then(m => ({ default: m.AccessibilityPage })));

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
                <Route path="/dvds" element={<Dvds />} />
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
