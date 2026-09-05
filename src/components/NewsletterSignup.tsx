import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { subscribeToMailchimp } from '@/lib/mailchimp';

export function NewsletterSignup({ className = '' }: { className?: string }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    const ok = await subscribeToMailchimp({
      email: trimmed,
      tags: ['newsletter'],
      source: 'footer-form',
    });
    setLoading(false);
    if (ok) {
      toast.success("You're on the list. Welcome to Kenworthy.");
      setEmail('');
    } else {
      toast.error("We couldn't add you just now. Please try again in a moment.");
    }
  };

  return (
    <form onSubmit={onSubmit} className={`space-y-2 ${className}`}>
      <p className="font-display uppercase tracking-wide text-foreground">Join our Newsletter</p>
      <p className="text-sm text-muted-foreground">
        Upcoming Films, Performances, and KPAC News
      </p>
      <div className="flex gap-2">
        {/* A visible label would repeat "Join our Newsletter" above it, so the
            name is sr-only — but it has to exist. A placeholder is not a
            label: it is announced inconsistently and it vanishes the moment
            anyone types. This field is in the footer of every page. */}
        <Label htmlFor="newsletter-email" className="sr-only">
          Email address for the Kenworthy newsletter
        </Label>
        <Input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10"
        />
        <Button type="submit" size="sm" className="h-10" disabled={loading}>
          {loading ? '…' : 'Subscribe'}
        </Button>
      </div>
    </form>
  );
}