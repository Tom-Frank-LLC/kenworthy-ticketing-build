import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Ticket, LogOut, Shield, User, CreditCard, Home, MapPin, Mail, Phone, Heart, Building2, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KenworthyLogo } from '@/components/brand/KenworthyLogo';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, isHost, signOut } = useAuth();
  const navigate = useNavigate();

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
      <header className="sticky top-0 z-50 glass border-b border-accent/20">
        <div className="container flex h-[68px] items-center justify-between gap-4">
          <div className="flex items-center gap-8 md:gap-12 min-w-0">
            <Link to="/" className="flex items-center group" aria-label="The Kenworthy — home">
              <KenworthyLogo
                size="header"
                className="transition-opacity group-hover:opacity-80"
                loading="eager"
              />
            </Link>
            <Link
              to="/sponsors"
              className="hidden sm:inline font-display uppercase text-sm tracking-[0.25em] text-accent hover:text-primary transition-colors"
            >
              Our Sponsors
            </Link>
            <Link
              to="/history"
              className="hidden sm:inline font-display uppercase text-sm tracking-[0.25em] text-accent hover:text-primary transition-colors"
            >
              History
            </Link>
            <Link
              to="/rentals"
              className="hidden md:inline font-display uppercase text-sm tracking-[0.25em] text-accent hover:text-primary transition-colors"
            >
              Rentals
            </Link>
          </div>

          <nav className="flex items-center gap-1.5" aria-label="Primary">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="hidden sm:inline-flex h-10 border-primary/60 text-primary hover:bg-primary hover:text-primary-foreground"
            >
              <Link to="/donate">
                <Heart className="h-4 w-4 mr-1" /> Donate
              </Link>
            </Button>
            {user ? (
              <>
                {isAdmin && (
                  <Button variant="ghost" size="sm" asChild className="h-10">
                    <Link to="/admin">
                      <Shield className="h-4 w-4 mr-1" /> Admin
                    </Link>
                  </Button>
                )}
                {isHost && !isAdmin && (
                  <Button variant="ghost" size="sm" asChild className="h-10">
                    <Link to="/host">
                      <Home className="h-4 w-4 mr-1" /> Host
                    </Link>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-10">
                      <User className="h-4 w-4 mr-1" /> Me <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-background">
                    <DropdownMenuItem asChild>
                      <Link to="/my-tickets"><Ticket className="h-4 w-4 mr-2" /> My Tickets</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/my-passes"><CreditCard className="h-4 w-4 mr-2" /> Film Passes</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/profile"><User className="h-4 w-4 mr-2" /> Profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" /> Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild className="h-10">
                  <Link to="/auth">Sign In</Link>
                </Button>
                <Button size="sm" asChild className="h-10 px-5">
                  <Link to="/#calendar">Get Tickets</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t border-accent/20 bg-card/40">
        <div className="container py-10 grid gap-8 md:grid-cols-3 text-sm">
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
          <div className="md:text-right text-muted-foreground">
            <p className="font-serif">Performing Arts Centre</p>
            <p className="font-serif">Celebrating 100 Years · Est. 1926</p>
            <p className="mt-3 text-xs">© {new Date().getFullYear()} The Kenworthy</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
