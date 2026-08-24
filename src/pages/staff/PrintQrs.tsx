import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { PrintQrPanel } from '@/components/admin/PrintQrPanel';

/**
 * Print QRs, as a staff screen.
 *
 * The same panel the Film Passes admin tab mounts — see PrintQrPanel. This is
 * the mount for the person who just needs a sheet of stickers and has no reason
 * to open the pass-type editor to get one.
 */
export default function PrintQrs() {
  return (
    <div className="container py-8 px-4 max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link to="/staff">
          <ChevronLeft className="h-4 w-4 mr-1" /> Staff
        </Link>
      </Button>
      <h1 className="font-display text-3xl font-bold mb-6">Print QRs</h1>
      <PrintQrPanel />
    </div>
  );
}
