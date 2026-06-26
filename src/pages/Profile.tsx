import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { User } from 'lucide-react';
import { subscribeToMailchimp } from '@/lib/mailchimp';

export default function Profile() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [initialOptIn, setInitialOptIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/auth'); return; }

    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) {
        setDisplayName(data.display_name || '');
        setPhone(data.phone || '');
        setMarketingOptIn(Boolean(data.marketing_opt_in));
        setInitialOptIn(Boolean(data.marketing_opt_in));
      }
      setLoading(false);
    });
  }, [user, authLoading, navigate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, phone, marketing_opt_in: marketingOptIn })
      .eq('id', user!.id);

    if (error) toast.error(error.message);
    else {
      toast.success('Profile updated!');
      if (marketingOptIn && !initialOptIn && user?.email) {
        const [first, ...rest] = (displayName || '').trim().split(/\s+/);
        subscribeToMailchimp({
          email: user.email,
          first_name: first ?? '',
          last_name: rest.join(' '),
          tags: ['newsletter'],
          source: 'profile-settings',
        });
      }
      setInitialOptIn(marketingOptIn);
    }
    setSaving(false);
  };

  if (loading || authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="container py-8 px-4 max-w-md">
      <h1 className="font-display text-3xl font-bold mb-8">Profile</h1>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <User className="h-5 w-5 text-primary" /> Your Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(208) 555-0123" />
            </div>
            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer pt-2 border-t border-border/40">
              <Checkbox
                checked={marketingOptIn}
                onCheckedChange={(v) => setMarketingOptIn(v === true)}
                className="mt-0.5"
              />
              <span>Email me about upcoming films, performances, and Kenworthy news.</span>
            </label>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
