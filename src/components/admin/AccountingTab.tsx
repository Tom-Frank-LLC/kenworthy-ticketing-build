import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Upload, Loader2, Trash2 } from 'lucide-react';
import { parseFinancialWorkbook } from '@/lib/parseFinancialXlsx';

const CHUNK = 500;

async function insertChunked(rows: any[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await (supabase.from('financial_entries') as any).insert(slice);
    if (error) throw new Error(`chunk ${i}: ${error.message}`);
  }
}

export default function AccountingTab() {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const { count } = await supabase.from('financial_entries').select('*', { count: 'exact', head: true });
    setCount(count ?? 0);
  }
  useEffect(() => { refresh(); }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setProgress('Reading workbook…');
    try {
      const m = file.name.match(/(\d{4})/);
      const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
      const buf = await file.arrayBuffer();
      const rows = parseFinancialWorkbook(buf, year);
      setProgress(`Parsed ${rows.length} entries for ${year}. Uploading…`);
      await insertChunked(rows);
      toast.success(`Imported ${rows.length} financial entries for ${year}.`);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
      setProgress('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function clearAll() {
    if (!confirm('Delete ALL financial entries? This cannot be undone.')) return;
    setBusy(true);
    const { error } = await supabase.from('financial_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) toast.error(error.message);
    else { toast.success('Cleared'); refresh(); }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <Card className="glass">
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Financial entries</p>
          <p className="text-2xl font-display font-bold">{count.toLocaleString()}</p>
        </CardContent>
      </Card>

      {busy && (
        <Card className="glass border-primary/40">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm">{progress || 'Working…'}</span>
          </CardContent>
        </Card>
      )}

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><Upload className="h-5 w-5" /> Income & Expenses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload one yearly xlsx (sheets named January … December). The importer tolerates column drift across years.
            Year is read from the filename.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input ref={fileRef} type="file" accept=".xlsx" className="max-w-sm"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <Button onClick={clearAll} disabled={busy} variant="ghost">
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Clear financials
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}