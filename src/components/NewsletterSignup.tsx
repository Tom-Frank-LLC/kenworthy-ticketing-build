import { useState } from 'react';
import { Input } from '@/components/ui/input';
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
      toast.success("You're on the list. Welcome to the Kenworthy.");
      setEmail('');
    } else {
      toast.error("We couldn't add you just now. Please try again in a moment.");
    }
  };

  return (
    <form onSubmit={onSubmit} className={`space-y-2 ${className}`}>
      <p className="font-display uppercase tracking-wide text-foreground">Stay in the loop</p>
      <p className="text-xs text-muted-foreground">
        Upcoming films, performances, and Kenworthy news. No spam, unsubscribe anytime.
      </p>
      <div className="flex gap-2">
        <Input
          type="email"
          required
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