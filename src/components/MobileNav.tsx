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
  ScanLine,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  User,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { KenworthyLogo } from '@/components/brand/KenworthyLogo';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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
};

const primaryLinks: NavItem[] = [
  { label: "What's On", to: '/calendar', icon: CalendarDays },
  { label: 'Theatre Rentals', to: '/rentals', icon: Building2 },
  { label: 'DVD Rentals', to: '/dvds', icon: Disc3 },
  { label: 'Donate', to: '/donate', icon: Heart },
];

const infoLinks: NavItem[] = [
  { label: 'History', to: '/history' },
  { label: 'About Us', to: '/about' },
  { label: 'Silent Film Festival', to: '/silent-film-festival' },
  { label: 'Press', to: '/press' },
  { label: 'Hiring', to: '/hiring' },
  { label: 'Accessibility', to: '/accessibility' },
  { label: 'Plan a Visit', to: '/plan-a-visit' },
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

  const staffLinks: NavItem[] = [];
  if (isAdmin || isStaff) staffLinks.push({ label: 'Admin', to: '/admin', icon: Shield });
  if (isStaff && !isAdmin) {
    staffLinks.push({ label: 'Point of Sale', to: '/admin/pos', icon: ShoppingCart });
    staffLinks.push({ label: 'Ticket Scanner', to: '/admin/scanner', icon: ScanLine });
  }
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
            <Link to="/" onClick={close} aria-label="The Kenworthy — home">
              <KenworthyLogo size="header" />
            </Link>
          </SheetTitle>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Mobile">
          <div className="pt-2">
            {primaryLinks.map(item => (
              <NavRow key={item.to} item={item} onNavigate={close} />
            ))}
          </div>

          {user && (
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
          {infoLinks.map(item => (
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
                  <Ticket className="mr-2 h-4 w-4" /> Get Tickets
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-12 w-full justify-center">
                <Link to={authHref} onClick={close}>
                  Sign In
                </Link>
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
