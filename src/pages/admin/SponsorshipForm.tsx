import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadSponsorshipPdf } from '@/lib/sponsorshipPdf';

const EMPTY = {
  slug: '',
  title: '',
  tagline: '',
  intro_text: '',
  hook_text: '',
  cta_label: 'Learn more',
  section_heading: 'Engage The Community',
  section_body: '',
  benefits: [
    { title: 'Recognition', description: '' },
    { title: 'Tabling Opportunity', description: '' },
    { title: 'Marketing & Outreach', description: '' },
  ],
  stats_text: '',
  price_text: '',
  availability_text: '',
  contact_name: 'Colin Mannex',
  contact_title: 'Executive Director',
  contact_email: 'executive@kenworthy.org',
  contact_phone: '208.892.9752',
  display_order: 0,
  is_active: true,
};

export default function SponsorshipForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isStaff, loading: authLoading } = useAuth();
  const isNew = !id || id === 'new';
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin && !isStaff) {
      navigate('/');
      return;
    }
    if (!isNew) {
      (supabase as any)
        .from('sponsorship_opportunities')
        .select('*')
        .eq('id', id)
        .maybeSingle()
        .then(({ data, error }: any) => {
          if (error) toast.error(error.message);
          else if (data) setForm({ ...EMPTY, ...data, benefits: data.benefits || [] });
        });
    }
  }, [id, isNew, isAdmin, isStaff, authLoading, navigate]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const setBenefit = (i: number, k: 'title' | 'description', v: string) => {
    setForm((f: any) => {
      const benefits = [...(f.benefits || [])];
      benefits[i] = { ...benefits[i], [k]: v };
      return { ...f, benefits };
    });
  };

  const addBenefit = () =>
    setForm((f: any) => ({ ...f, benefits: [...(f.benefits || []), { title: '', description: '' }] }));

  const removeBenefit = (i: number) =>
    setForm((f: any) => ({ ...f, benefits: (f.benefits || []).filter((_: any, j: number) => j !== i) }));

  async function save() {
    if (!form.title) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    const slug =
      form.slug ||
      form.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 80);
    const payload = { ...form, slug };
    const q = isNew
      ? (supabase as any).from('sponsorship_opportunities').insert(payload).select().single()
      : (supabase as any)
          .from('sponsorship_opportunities')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
    const { data, error } = await q;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isNew ? 'Created' : 'Saved');
    if (isNew && data) navigate(`/admin/sponsorships/${data.id}`);
  }

  if (authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="container py-8 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
      </Button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold">
          {isNew ? 'New Sponsorship Opportunity' : 'Edit Sponsorship Opportunity'}
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} />
            <Label className="text-sm">Active</Label>
          </div>
          <Button variant="outline" onClick={() => downloadSponsorshipPdf(form)}>
            <Download className="h-4 w-4 mr-1" /> Preview PDF
          </Button>
        </div>
      </div>

      <Card className="glass">
        <CardContent className="p-6 space-y-5">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Tagline">
            <Input value={form.tagline || ''} onChange={(e) => set('tagline', e.target.value)} />
          </Field>
          <Field label="Intro paragraph (about KPAC / the program)">
            <Textarea
              rows={4}
              value={form.intro_text || ''}
              onChange={(e) => set('intro_text', e.target.value)}
            />
          </Field>
          <Field label="Hook line (the ask)">
            <Textarea
              rows={2}
              value={form.hook_text || ''}
              onChange={(e) => set('hook_text', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CTA label">
              <Input value={form.cta_label || ''} onChange={(e) => set('cta_label', e.target.value)} />
            </Field>
            <Field label="Display order">
              <Input
                type="number"
                value={form.display_order ?? 0}
                onChange={(e) => set('display_order', parseInt(e.target.value) || 0)}
              />
            </Field>
          </div>

          <hr className="border-accent/20" />

          <Field label="Section heading (page 2)">
            <Input
              value={form.section_heading || ''}
              onChange={(e) => set('section_heading', e.target.value)}
            />
          </Field>
          <Field label="Section body">
            <Textarea
              rows={3}
              value={form.section_body || ''}
              onChange={(e) => set('section_body', e.target.value)}
            />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Benefits / bullets</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addBenefit}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-3">
              {(form.benefits || []).map((b: any, i: number) => (
                <div key={i} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Title"
                      value={b.title}
                      onChange={(e) => setBenefit(i, 'title', e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBenefit(i)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <Textarea
                    rows={2}
                    placeholder="Description"
                    value={b.description}
                    onChange={(e) => setBenefit(i, 'description', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <Field label="Stats / quote callout">
            <Textarea
              rows={2}
              value={form.stats_text || ''}
              onChange={(e) => set('stats_text', e.target.value)}
            />
          </Field>
          <Field label="Price headline (e.g. 'Sponsorships start at $400 per film…')">
            <Input value={form.price_text || ''} onChange={(e) => set('price_text', e.target.value)} />
          </Field>
          <Field label="Availability / scheduling notes">
            <Textarea
              rows={2}
              value={form.availability_text || ''}
              onChange={(e) => set('availability_text', e.target.value)}
            />
          </Field>

          <hr className="border-accent/20" />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact name">
              <Input
                value={form.contact_name || ''}
                onChange={(e) => set('contact_name', e.target.value)}
              />
            </Field>
            <Field label="Contact title">
              <Input
                value={form.contact_title || ''}
                onChange={(e) => set('contact_title', e.target.value)}
              />
            </Field>
            <Field label="Contact email">
              <Input
                value={form.contact_email || ''}
                onChange={(e) => set('contact_email', e.target.value)}
              />
            </Field>
            <Field label="Contact phone">
              <Input
                value={form.contact_phone || ''}
                onChange={(e) => set('contact_phone', e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate('/admin')}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}