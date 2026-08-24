import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Ticket, LogOut, Shield, ShieldCheck, User, CreditCard, Home, MapPin, Mail, Phone, Heart, Building2, ChevronDown, Store } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KenworthyLogo } from '@/components/brand/KenworthyLogo';
import { MobileNav } from '@/components/MobileNav';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { useHiringEnabled } from '@/hooks/useHiringEnabled';
import { isCentenary } from '@/lib/centenary';
import { cn } from '@/lib/utils';
import { COLOR_LAB_ENABLED, MEMBER_ACCOUNTS_ENABLED } from '@/lib/flags';
import { GREEN_CTA } from '@/lib/greenCta';
import { useColorLab } from '@/components/colorlab/ColorLabProvider';

const navLinkClass =
  'font-display uppercase text-sm tracking-[0.25em] text-accent hover:text-primary transition-colors';

const infoLinks: Array<[string, string]> = [
  ['History', '/history'],
  ['About Us', '/about'],
  ['Silent Film Festival', '/silent-film-festival'],
  ['Press', '/press'],
  ['Hiring', '/hiring'],
  ['Accessibility', '/accessibility'],
];

const supportLinks: Array<[string, string]> = [
  ['Sponsors', '/sponsors'],
  ['Donate', '/donate'],
  ['Volunteer', '/volunteer'],
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, isStaff, isHost, isSuperadmin, signOut } = useAuth();
  const colorLab = useColorLab();
  const navigate = useNavigate();
  const location = useLocation();
  // Hiring is admin-toggled; when it is off the page redirects away, so the
  // menu entry has to go with it rather than advertise a bounce.
  const { enabled: hiringEnabled } = useHiringEnabled();
  const visibleInfoLinks = infoLinks.filter(
    ([, to]) => to !== '/hiring' || hiringEnabled,
  );
  const authHref = (() => {
    const path = location.pathname + location.search;
    if (path === '/' || path.startsWith('/auth')) return '/auth';
    return `/auth?redirect=${encodeURIComponent(path)}`;
  })();

  // What the "Me" menu holds. With member accounts off, a logged-in user is
  // staff by definition — My Tickets and Profile are pages nobody with a role
  // has a reason to open, and the tickets they might want belong to a patron
  // who reaches them by emailed link instead. So the menu carries the signed-in
  // person's own destinations. Flip the flag and the patron entries return.
  const accountLinks: Array<[string, string, typeof Ticket]> = [];
  if (MEMBER_ACCOUNTS_ENABLED) {
    accountLinks.push(['My Tickets', '/my-tickets', Ticket]);
    accountLinks.push(['Film Passes', '/my-passes', CreditCard]);
    accountLinks.push(['DVD Rentals', '/dvds', Ticket]);
    accountLinks.push(['Profile', '/profile', User]);
  } else {
    // Staff first: for most of the people with a role it is the only one of
    // these they open on a shift. Both entries matter between `sm` and `lg`,
    // where this menu is showing and the header buttons below are not.
    //
    // Dashboard is admin-only, matching the route. It read `isAdmin || isStaff`
    // while /admin admitted anyone with a role — offering it to staff now would
    // be a link that bounces them home.
    if (isStaff) accountLinks.push(['Staff', '/staff', Store]);
    if (isAdmin) accountLinks.push(['Dashboard', '/admin', Shield]);
    if (isSuperadmin) accountLinks.push(['Superadmin', '/superadmin', ShieldCheck]);
    if (isHost && !isAdmin) accountLinks.push(['Host Dashboard', '/host', Home]);
  }

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
    // Use direct location change for cross-browser reliability (Firefox races navigate + reload)
    window.location.href = '/auth';
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 glass border-b border-accent/20 pt-[env(safe-area-inset-top)]">
        {/* The bar grows for the centenary lockup, which is a taller piece of
            artwork — see KenworthyLogo. Written as two whole class strings
            because Tailwind cannot see a class name that is built at runtime. */}
        <div
          className={cn(
            'container flex items-center justify-between gap-2 sm:gap-4',
            isCentenary() ? 'h-[84px]' : 'h-[68px]',
          )}
        >
          <div className="flex items-center gap-3 sm:gap-6 md:gap-8 min-w-0">
            {/* Full menu below `lg`, where the desktop links below are still hidden. */}
            <MobileNav />
            <Link to="/" className="flex items-center group" aria-label="Kenworthy — home">
              <KenworthyLogo
                size="header"
                className="transition-opacity group-hover:opacity-80"
                loading="eager"
              />
            </Link>
            <Link to="/calendar" className={`hidden sm:inline ${navLinkClass}`}>
              Calendar
            </Link>
            <Link to="/rentals" className={`hidden md:inline ${navLinkClass}`}>
              Theatre Rentals
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className={`hidden md:inline-flex items-center gap-1 ${navLinkClass}`}>
                Info <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-background">
                {visibleInfoLinks.map(([label, to]) => (
                  <DropdownMenuItem key={to} asChild>
                    <Link to={to}>{label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger className={`hidden md:inline-flex items-center gap-1 ${navLinkClass}`}>
                Support <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 bg-background">
                {supportLinks.map(([label, to]) => (
                  <DropdownMenuItem key={to} asChild>
                    <Link to={to}>{label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Staff only — the catalogue is behind an isStaff gate, so showing
                the link to a patron would advertise a page that redirects them
                straight home. See the note at the top of pages/Dvds.tsx. */}
            {(isStaff || isAdmin) && (
              <Link to="/dvds" className={`hidden lg:inline ${navLinkClass}`}>
                DVDs
              </Link>
            )}
          </div>

          <nav className="flex items-center gap-1.5" aria-label="Primary">
            {/* Signed out only. Nobody with a role is going to donate from
                behind the counter, and the header runs out of room at `lg`
                exactly where the Staff and Admin buttons need to sit — so the
                ask that is aimed at patrons yields to the tools that are not.
                Donate is still in the Support menu and the mobile drawer. */}
            {!user && (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="hidden lg:inline-flex h-10 border-primary/60 text-primary hover:bg-primary hover:text-primary-foreground"
              >
                <Link to="/donate">
                  <Heart className="h-4 w-4 mr-1" /> Donate
                </Link>
              </Button>
            )}
            {user ? (
              <>
                {/* Role shortcuts live in the mobile drawer below `lg`.

                    Two links where there were four. Staff is the counter —
                    POS, scanner, Print QRs — and it shows for admins too,
                    because an admin runs the counter as often as anyone.
                    Admin is management, and admin-only in the nav and on
                    the route alike — a staff-only account has no way into
                    /admin at all now, by design. */}
                {isStaff && (
                  <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex h-10">
                    <Link to="/staff">
                      <Store className="h-4 w-4 mr-1" /> Staff
                    </Link>
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex h-10">
                    <Link to="/admin">
                      <Shield className="h-4 w-4 mr-1" /> Admin
                    </Link>
                  </Button>
                )}
                {isSuperadmin && (
                  <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex h-10 text-primary">
                    <Link to="/superadmin">
                      <ShieldCheck className="h-4 w-4 mr-1" /> Superadmin
                    </Link>
                  </Button>
                )}
                {isHost && !isAdmin && (
                  <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex h-10">
                    <Link to="/host">
                      <Home className="h-4 w-4 mr-1" /> Host
                    </Link>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="hidden sm:inline-flex h-10">
                      <User className="h-4 w-4 mr-1" /> Me <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-background">
                    {accountLinks.map(([label, to, Icon]) => (
                      <DropdownMenuItem key={to} asChild>
                        <Link to={to}><Icon className="h-4 w-4 mr-2" /> {label}</Link>
                      </DropdownMenuItem>
                    ))}
                    {accountLinks.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" /> Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {/* Signing in is a staff act now, not a step in buying a
                    ticket. The prominent header CTA would only send patrons to
                    a door that never opens for them, so it moves to a quiet
                    footer link — see below. */}
                {MEMBER_ACCOUNTS_ENABLED && (
                  <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex h-10">
                    <Link to={authHref}>Sign In</Link>
                  </Button>
                )}
                {/* The one green thing in the header. Donate sits beside it as
                    a purple outline; green is what separates "buy a ticket"
                    from every other call on the page. See lib/greenCta.ts. */}
                <Button size="sm" asChild className={cn('h-10 px-4 sm:px-5', GREEN_CTA)}>
                  <Link to="/calendar">Tickets</Link>
                </Button>
                <Button size="sm" variant="outline" asChild className="h-10 px-4 sm:px-5">
                  <Link to="/film-passes">Film Pass</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t border-accent/20 bg-card/40">
        <div className="container py-10 grid gap-8 md:grid-cols-4 text-sm">
          <div>
            <KenworthyLogo size="footer" className="mb-3" />
            <p className="font-serif italic text-muted-foreground">
              A century of stories, told one screening at a time.
            </p>
          </div>
          <div className="space-y-2 text-muted-foreground">
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-accent" /> 508 S Main St, Moscow, ID 83843</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-accent" /> 208-882-4127</p>
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-accent" /> events@kenworthy.org</p>
          </div>
          <NewsletterSignup />
          <div className="md:text-right text-muted-foreground">
            <p className="font-serif">Performing Arts Centre</p>
            <p className="font-serif">Celebrating 100 Years · Est. 1926</p>
            <p className="mt-3 text-sm">© {new Date().getFullYear()} Kenworthy</p>
            <p className="mt-2 text-sm">
              <Link to="/privacy" className="hover:text-primary transition-colors">
                Privacy Policy
              </Link>
              <span aria-hidden className="mx-1.5 text-muted-foreground/50">·</span>
              <Link to="/terms" className="hover:text-primary transition-colors">
                Terms of Use
              </Link>
              <span aria-hidden className="mx-1.5 text-muted-foreground/50">·</span>
              {/* A plain <a>, not a <Link> — /sms is a static file in public/,
                  not a route in this app, and the router would swallow it into
                  the SPA shell. That page exists precisely because the shell is
                  invisible to anything that does not run JavaScript, so sending
                  it through the router would defeat it. */}
              <a href="/sms" className="hover:text-primary transition-colors">
                Text Message Terms
              </a>
            </p>
            {/* Reachable, unadvertised. Staff know it is here; a patron who
                finds it has nothing to gain by it. Dropped from sitemap.xml
                for the same reason. */}
            {!MEMBER_ACCOUNTS_ENABLED && !user && (
              <p className="mt-2 text-sm">
                <Link to={authHref} className="text-muted-foreground/70 hover:text-primary transition-colors">
                  Staff login
                </Link>
              </p>
            )}
            {/* The Color Lab's entry point for someone already signed in.
                "Staff login" is the only route to the Lab for a logged-out
                viewer — they reach it by clicking the logo on the sign-in card —
                and that link is hidden from anyone with a session, which would
                otherwise leave staff with no way in at all. Same footer slot,
                same quietness; temporary, and gated on VITE_COLOR_LAB. */}
            {COLOR_LAB_ENABLED && user && !colorLab.enabled && (
              <p className="mt-2 text-sm">
                <button
                  type="button"
                  onClick={colorLab.open}
                  className="text-muted-foreground/70 hover:text-primary transition-colors"
                >
                  Color Lab
                </button>
              </p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
