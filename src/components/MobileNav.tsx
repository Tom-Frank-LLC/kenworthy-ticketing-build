import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  CreditCard,
  Disc3,
  Heart,
  Home,
  LogOut,
  Menu,
  Shield,
  ShieldCheck,
  Store,
  Ticket,
  User,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { KenworthyLogo } from '@/components/brand/KenworthyLogo';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useHiringEnabled } from '@/hooks/useHiringEnabled';
import { MEMBER_ACCOUNTS_ENABLED } from '@/lib/flags';

/**
 * The primary navigation on phones and small tablets.
 *
 * Every header link is gated behind a `sm`/`md`/`lg` breakpoint, so below
 * `lg` the desktop nav is progressively empty — at 375px a visitor could
 * previously reach nothing but Sign In. This drawer carries the full menu
 * at those widths and hides itself once the desktop bar is complete (`lg`).
 */

type NavItem = {
  label: string;
  to: string;
  icon?: typeof Ticket;
  /** Hidden from patrons. See the note at the top of pages/Dvds.tsx. */
  staffOnly?: boolean;
};

const primaryLinks: NavItem[] = [
  { label: "What's On", to: '/calendar', icon: CalendarDays },
  { label: 'Theatre Rentals', to: '/rentals', icon: Building2 },
  { label: 'DVD Rentals', to: '/dvds', icon: Disc3, staffOnly: true },
  { label: 'Donate', to: '/donate', icon: Heart },
];

const infoLinks: NavItem[] = [
  { label: 'History', to: '/history' },
  { label: 'About Us', to: '/about' },
  { label: 'Silent Film Festival', to: '/silent-film-festival' },
  { label: 'Concessions', to: '/concessions' },
  { label: 'Press', to: '/press' },
  { label: 'Hiring', to: '/hiring' },
  { label: 'Accessibility', to: '/accessibility' },
];

const supportLinks: NavItem[] = [
  { label: 'Sponsors', to: '/sponsors' },
  { label: 'Volunteer', to: '/volunteer' },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 pb-2 pt-6 font-display text-xs uppercase tracking-[0.25em] text-accent/80">
      {children}
    </h3>
  );
}

/** 48px minimum row height keeps every target above the ~44px touch floor. */
function NavRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className="flex min-h-[48px] items-center gap-3 rounded-md px-3 text-base text-foreground transition-colors hover:bg-secondary active:bg-secondary"
    >
      {Icon && <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden />}
      <span>{item.label}</span>
    </Link>
  );
}

export function MobileNav() {
  const { user, isAdmin, isStaff, isHost, isSuperadmin, signOut } = useAuth();
  // See the matching note in Layout.tsx — the toggle hides the entry, it does
  // not just make the destination unhelpful.
  const { enabled: hiringEnabled } = useHiringEnabled();
  const visibleInfoLinks = infoLinks.filter(
    item => item.to !== '/hiring' || hiringEnabled,
  );
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Links navigate without unmounting the drawer, so close it on route change.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  const authHref = (() => {
    const path = location.pathname + location.search;
    if (path === '/' || path.startsWith('/auth')) return '/auth';
    return `/auth?redirect=${encodeURIComponent(path)}`;
  })();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
    // Matches Layout: direct location change for cross-browser reliability.
    window.location.href = '/auth';
  };

  const close = () => setOpen(false);

  // A flag on the item rather than a second list: DVD Rentals is still a
  // primary destination sitting among the others, it is just not one a patron
  // may reach. Filtering keeps it in place for the people who can.
  const visiblePrimaryLinks = primaryLinks.filter(item => !item.staffOnly || isStaff || isAdmin);

  // One row per section, matching the header: Staff is the counter (POS,
  // scanner, Print QRs) and Admin is management. The separate Point of Sale and
  // Ticket Scanner rows are gone — they were the whole of the Staff section
  // before it had a home of its own.
  const staffLinks: NavItem[] = [];
  if (isStaff) staffLinks.push({ label: 'Staff', to: '/staff', icon: Store });
  if (isAdmin) staffLinks.push({ label: 'Admin', to: '/admin', icon: Shield });
  if (isSuperadmin) staffLinks.push({ label: 'Superadmin', to: '/superadmin', icon: ShieldCheck });
  if (isHost && !isAdmin) staffLinks.push({ label: 'Host Dashboard', to: '/host', icon: Home });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 text-accent lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        className="flex w-[88vw] max-w-sm flex-col gap-0 p-0 sm:max-w-sm"
      >
        <div className="border-b border-accent/20 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <SheetTitle asChild>
            <Link to="/" onClick={close} aria-label="Kenworthy — home">
              <KenworthyLogo size="header" />
            </Link>
          </SheetTitle>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Mobile">
          <div className="pt-2">
            {visiblePrimaryLinks.map(item => (
              <NavRow key={item.to} item={item} onNavigate={close} />
            ))}
          </div>

          {/* No patron accounts, so no account section — signing in means staff,
              and the Staff block below already carries everywhere they go. */}
          {MEMBER_ACCOUNTS_ENABLED && user && (
            <>
              <SectionHeading>My Account</SectionHeading>
              <NavRow item={{ label: 'My Tickets', to: '/my-tickets', icon: Ticket }} onNavigate={close} />
              <NavRow item={{ label: 'Film Passes', to: '/my-passes', icon: CreditCard }} onNavigate={close} />
              <NavRow item={{ label: 'Profile', to: '/profile', icon: User }} onNavigate={close} />
            </>
          )}

          {staffLinks.length > 0 && (
            <>
              <SectionHeading>Staff</SectionHeading>
              {staffLinks.map(item => (
                <NavRow key={item.to} item={item} onNavigate={close} />
              ))}
            </>
          )}

          <SectionHeading>Info</SectionHeading>
          {visibleInfoLinks.map(item => (
            <NavRow key={item.to} item={item} onNavigate={close} />
          ))}

          <SectionHeading>Support Us</SectionHeading>
          {supportLinks.map(item => (
            <NavRow key={item.to} item={item} onNavigate={close} />
          ))}
        </nav>

        <div className="space-y-2 border-t border-accent/20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {user ? (
            <Button variant="outline" className="h-12 w-full justify-center" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </Button>
          ) : (
            <>
              <Button asChild className="h-12 w-full justify-center text-base">
                <Link to="/calendar" onClick={close}>
                  <Ticket className="mr-2 h-4 w-4" /> Tickets
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-12 w-full justify-center text-base">
                <Link to="/film-passes" onClick={close}>
                  <CreditCard className="mr-2 h-4 w-4" /> Film Pass
                </Link>
              </Button>
              {/* Matches the header: the sign-in CTA is staff-only now, and
                  lives as a quiet link in the site footer instead. */}
              {MEMBER_ACCOUNTS_ENABLED && (
                <Button asChild variant="outline" className="h-12 w-full justify-center">
                  <Link to={authHref} onClick={close}>
                    Sign In
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
