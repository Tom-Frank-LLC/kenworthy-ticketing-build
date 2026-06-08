import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Upload } from 'lucide-react';
import { format } from 'date-fns';

type SigRow = {
  event_title: string;
  applicant_name: string;
  signed_at: string | null;
  signed_by_name: string | null;
  signed_by_title: string | null;
  signed_pdf_sha256: string | null;
  signature_b64: string | null;
  public_key_b64: string | null;
  algorithm: string | null;
};

type Result =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'valid'; sha256: string }
  | { state: 'tampered'; sha256: string }
  | { state: 'no-signature' }
  | { state: 'error'; message: string };

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(bytes: BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function VerifyContract() {
  const { id } = useParams();
  const [sig, setSig] = useState<SigRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<Result>({ state: 'idle' });

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data, error } = await supabase.rpc('get_contract_signature', { p_request_id: id });
      if (error) {
        setResult({ state: 'error', message: error.message });
      } else {
        const row = (data as any)?.[0] || null;
        setSig(row);
        if (row && !row.signed_at) setResult({ state: 'no-signature' });
      }
      setLoading(false);
    })();
  }, [id]);

  async function handleFile(file: File) {
    if (!sig?.signature_b64 || !sig?.public_key_b64) {
      setResult({ state: 'no-signature' });
      return;
    }
    setResult({ state: 'checking' });
    try {
      const buffer = await file.arrayBuffer();
      const sha = await sha256Hex(buffer);

      const pubKey = await crypto.subtle.importKey(
        'raw',
        b64decode(sig.public_key_b64),
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      const ok = await crypto.subtle.verify(
        'Ed25519',
        pubKey,
        b64decode(sig.signature_b64),
        buffer
      );

      if (ok && sha === sig.signed_pdf_sha256) {
        setResult({ state: 'valid', sha256: sha });
      } else {
        setResult({ state: 'tampered', sha256: sha });
      }
    } catch (e: any) {
      setResult({ state: 'error', message: e?.message || 'Verification failed' });
    }
  }

  if (loading) return <div className="container py-16 text-center text-muted-foreground">Loading…</div>;
  if (!sig) return <div className="container py-16 text-center text-muted-foreground">Contract not found.</div>;

  return (
    <div className="container max-w-2xl py-10 px-4 space-y-6">
      <header className="text-center">
        <h1 className="font-display text-3xl uppercase tracking-wider">Verify Contract</h1>
        <p className="font-serif text-muted-foreground mt-2">
          Confirm a Kenworthy rental contract has not been altered since it was signed.
        </p>
      </header>

      <Card className="glass">
        <CardContent className="p-6 space-y-2">
          <Row k="Event" v={sig.event_title} />
          <Row k="Licensee" v={sig.applicant_name} />
          <Row k="Signed by" v={sig.signed_by_name ? `${sig.signed_by_name}${sig.signed_by_title ? ' — ' + sig.signed_by_title : ''}` : '—'} />
          <Row k="Signed at" v={sig.signed_at ? format(new Date(sig.signed_at), 'PPpp') : '—'} />
          <Row k="Algorithm" v={sig.algorithm || '—'} />
          {sig.signed_pdf_sha256 && (
            <Row k="Expected SHA-256" v={<span className="font-mono text-xs break-all">{sig.signed_pdf_sha256}</span>} />
          )}
        </CardContent>
      </Card>

      {result.state === 'no-signature' ? (
        <Card className="glass border-muted">
          <CardContent className="p-6 text-center font-serif">
            <ShieldQuestion className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <p>This contract has not been signed yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass">
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="font-display uppercase text-sm tracking-wider">Upload the signed PDF</Label>
              <p className="font-serif text-xs text-muted-foreground">
                The file is read entirely in your browser. Nothing is uploaded.
              </p>
              <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-md p-6 cursor-pointer hover:bg-muted/30 transition">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="font-serif text-sm">Choose PDF…</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
            </div>

            {result.state === 'checking' && (
              <p className="text-center font-serif text-sm text-muted-foreground">Verifying…</p>
            )}
            {result.state === 'valid' && (
              <div className="text-center space-y-2 py-4">
                <ShieldCheck className="h-14 w-14 mx-auto text-accent" />
                <p className="font-display uppercase text-lg tracking-wider text-accent">Signature valid</p>
                <p className="font-serif text-sm text-muted-foreground">
                  This file matches the one signed by Kenworthy on {format(new Date(sig.signed_at!), 'PPpp')}.
                </p>
              </div>
            )}
            {result.state === 'tampered' && (
              <div className="text-center space-y-2 py-4">
                <ShieldAlert className="h-14 w-14 mx-auto text-destructive" />
                <p className="font-display uppercase text-lg tracking-wider text-destructive">Signature invalid</p>
                <p className="font-serif text-sm text-muted-foreground">
                  This PDF does not match the signed original. It has been modified, or this isn't the right file.
                </p>
                <p className="font-mono text-[10px] break-all text-muted-foreground mt-2">Got: {result.sha256}</p>
              </div>
            )}
            {result.state === 'error' && (
              <p className="text-center font-serif text-sm text-destructive">{result.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Button variant="outline" className="w-full" asChild>
        <a href="/">Back to Kenworthy</a>
      </Button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1">
      <span className="font-display uppercase text-xs text-muted-foreground tracking-wider">{k}</span>
      <span className="font-serif text-sm">{v}</span>
    </div>
  );
}