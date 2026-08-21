import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Eye, Check, Trash2, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface ConcessionMenu {
  id: string;
  label: string;
  file_path: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const BUCKET = 'concession-menus';

/**
 * Versioned concession menu PDFs. Admins upload new menu PDFs, preview
 * them in-place with an embedded viewer, and flip which one is "active"
 * (the version linked from the public homepage).
 */
export default function ConcessionMenusTab() {
  const [menus, setMenus] = useState<ConcessionMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewMenu, setPreviewMenu] = useState<ConcessionMenu | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('concession_menus')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setMenus((data as ConcessionMenu[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async () => {
    if (!file || !label.trim()) {
      toast.error('Add a label and choose a PDF');
      return;
    }
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are supported');
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('concession_menus').insert({
        label: label.trim(),
        file_path: path,
        notes: notes.trim() || null,
        uploaded_by: userId,
        is_active: false,
      });
      if (insErr) throw insErr;
      toast.success('Menu uploaded — preview before publishing');
      setLabel(''); setNotes(''); setFile(null);
      setUploadOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // The bucket is public, so a signed URL here would be ceremony that proves
  // nothing — and a ten-minute expiry would strand a preview left open. Same
  // reasoning as the festival programme archive.
  const openPreview = (menu: ConcessionMenu) => {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(menu.file_path);
    setPreviewMenu(menu);
    setPreviewUrl(data.publicUrl);
  };

  const activate = async (menu: ConcessionMenu) => {
    // .select() and a row count, not just the absence of an error: an RLS
    // denial comes back 204 with no error, so without this a blocked publish
    // reports success and the menu never appears on the home page — the same
    // silent failure this migration was written to fix, one layer up.
    const { data, error } = await supabase
      .from('concession_menus')
      .update({ is_active: true })
      .eq('id', menu.id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error(error?.message ?? 'Nothing was published — you may not have admin rights.');
      return;
    }
    toast.success(`"${menu.label}" is now the published menu`);
    await load();
  };

  const remove = async (menu: ConcessionMenu) => {
    if (menu.is_active) {
      toast.error('Activate another menu first');
      return;
    }
    if (!confirm(`Delete "${menu.label}"? This cannot be undone.`)) return;
    await supabase.storage.from(BUCKET).remove([menu.file_path]);
    const { error } = await supabase.from('concession_menus').delete().eq('id', menu.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Menu deleted');
    await load();
  };

  return (
    <div className="space-y-6">
      <CollapsibleSection
        id="concessions.menus"
        title="Menu Versions"
        icon={FileText}
        count={menus.length}
        description="Upload menu PDFs, preview them, and choose which one shows on the homepage."
        defaultOpen
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload menu PDF
          </Button>
        }
      >
        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading…</p>
        ) : menus.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No menu PDFs yet. Upload one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {menus.map((m) => (
              <Card key={m.id} className={m.is_active ? 'border-primary' : ''}>
                <CardContent className="p-4 flex items-center gap-4">
                  <FileText className="h-8 w-8 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-lg truncate">{m.label}</span>
                      {m.is_active && <Badge>Active on homepage</Badge>}
                    </div>
                    {m.notes && (
                      <p className="text-sm text-muted-foreground font-serif italic mt-0.5">
                        {m.notes}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Uploaded {new Date(m.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => openPreview(m)}>
                      <Eye className="h-4 w-4 mr-1" /> Preview
                    </Button>
                    {!m.is_active && (
                      <Button size="sm" onClick={() => activate(m)}>
                        <Check className="h-4 w-4 mr-1" /> Publish
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(m)}
                      disabled={m.is_active}
                      title={m.is_active ? 'Activate another menu first' : 'Delete'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload menu PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="menu-label">Label</Label>
              <Input
                id="menu-label"
                placeholder="e.g. Spring 2026 menu"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="menu-notes">Notes (optional)</Label>
              <Input
                id="menu-notes"
                placeholder="What changed in this version?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="menu-file">PDF file</Label>
              <Input
                id="menu-file"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog
        open={!!previewMenu}
        onOpenChange={(open) => {
          if (!open) { setPreviewMenu(null); setPreviewUrl(null); }
        }}
      >
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {previewMenu?.label}
              {previewMenu?.is_active && <Badge>Active</Badge>}
            </DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <iframe
              src={previewUrl}
              title={previewMenu?.label}
              className="flex-1 w-full rounded border border-border bg-background"
            />
          )}
          <DialogFooter>
            {previewMenu && !previewMenu.is_active && (
              <Button onClick={() => { activate(previewMenu); setPreviewMenu(null); setPreviewUrl(null); }}>
                <Check className="h-4 w-4 mr-1" /> Publish this version
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}