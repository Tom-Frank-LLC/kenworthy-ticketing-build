import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { QrCode, ScanLine, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * The Staff section — one home for the three things done at the counter.
 *
 * These tools all lived under /admin, which put day-to-day counter work behind
 * a door labelled "management": someone selling a ticket had to walk through
 * the dashboard that edits the schedule to get to the till. The split is by
 * what the work *is*, not by who may do it — an admin runs the counter too, and
 * gets this section as well as the other one.
 *
 * Each tool is its own screen rather than a section on this page, because each
 * one wants the whole screen: the scanner needs the camera edge to edge, the
 * till is a long form, and the sticker sheet prints. This page is the index.
 */

const tools: Array<{
  to: string;
  label: string;
  blurb: string;
  icon: typeof ShoppingCart;
}> = [
  {
    to: '/staff/pos',
    label: 'Point of Sale',
    blurb: 'Tickets, concessions, film passes and donations at the counter.',
    icon: ShoppingCart,
  },
  {
    to: '/staff/scanner',
    label: 'Door Scanner',
    blurb: 'Admit tickets and spend film passes at the door.',
    icon: ScanLine,
  },
  {
    to: '/staff/print-qr',
    label: 'Print QRs',
    blurb: 'Generate a run of blank pass stickers and print the sheet.',
    icon: QrCode,
  },
];

export default function StaffDashboard() {
  // The route is already wrapped in StaffOnly, so anyone rendering this has a
  // role. Read only for the greeting.
  const { user } = useAuth();

  return (
    <div className="container py-8 px-4">
      <h1 className="font-display text-3xl font-bold mb-2">Staff</h1>
      <p className="text-muted-foreground mb-8">
        {user?.email ? `Signed in as ${user.email}. ` : ''}
        Everything the counter needs, in one place.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map(({ to, label, blurb, icon: Icon }) => (
          <Link key={to} to={to} className="group focus-visible:outline-none">
            <Card className="glass h-full transition-colors group-hover:border-primary/60 group-focus-visible:border-primary">
              <CardContent className="p-5 space-y-2">
                <Icon className="h-7 w-7 text-primary" aria-hidden />
                <h2 className="font-display text-xl font-bold group-hover:text-primary transition-colors">
                  {label}
                </h2>
                <p className="text-sm text-muted-foreground">{blurb}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
