import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Download, Globe, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { downloadSponsorshipPdf } from '@/lib/sponsorshipPdf';

export default function SponsorsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('sponsorship_opportunities')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) toast.error(error.message);
    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(id: string, current: boolean) {
    const { error } = await (supabase as any)
      .from('sponsorship_opportunities')
      .update({ is_active: !current })
      .eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success(!current ? 'Published to Sponsors page' : 'Unpublished');
      load();
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this sponsorship opportunity?')) return;
    const { error } = await (supabase as any)
      .from('sponsorship_opportunities')
      .delete()
      .eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Deleted');
      load();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold">Sponsorship Opportunities</h2>
        <Button size="sm" asChild>
          <Link to="/admin/sponsorships/new">
            <Plus className="h-4 w-4 mr-1" /> New Opportunity
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <Card className="glass">
          <CardContent className="p-8 text-center text-muted-foreground">
            No sponsorship opportunities yet. Create one to publish on the Sponsors page.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <Card key={o.id} className="glass">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{o.title}</p>
                    <Badge variant={o.is_active ? 'default' : 'secondary'} className="text-xs">
                      {o.is_active ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  {o.tagline && (
                    <p className="text-xs text-muted-foreground mt-1">{o.tagline}</p>
                  )}
                </div>
                <div className="flex gap-1 items-center">
                  <Button
                    variant={o.is_active ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => toggleActive(o.id, o.is_active)}
                    title={o.is_active ? 'Unpublish from public Sponsors page' : 'Publish to public Sponsors page'}
                  >
                    {o.is_active ? (
                      <><EyeOff className="h-4 w-4 mr-1" /> Unpublish</>
                    ) : (
                      <><Globe className="h-4 w-4 mr-1" /> Publish</>
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => downloadSponsorshipPdf(o)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/admin/sponsorships/${o.id}`}>
                      <Edit className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(o.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}