import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { openSignedContractPdf } from '@/lib/signedContractPdf';
import { format } from 'date-fns';

export type ContractVersion = {
  id: string;
  event: 'saved' | 'signed';
  contract_data: unknown;
  request_snapshot: Record<string, unknown> | null;
  signed_pdf_sha256: string | null;
  signed_pdf_path: string | null;
  saved_by: string | null;
  saved_at: string;
};

export type ContractSource = { rental_request_id: string } | { blank_contract_id: string };

const COLUMNS = 'id, event, contract_data, request_snapshot, signed_pdf_sha256, signed_pdf_path, saved_by, saved_at';

/** One version of this contract, for a contract page opened at ?version=. A
 *  version of some other contract is not found. */
export async function fetchContractVersion(id: string, source: ContractSource): Promise<ContractVersion | null> {
  const query = supabase.from('contract_versions').select(COLUMNS).eq('id', id);
  const { data, error } = await ('rental_request_id' in source
    ? query.eq('rental_request_id', source.rental_request_id)
    : query.eq('blank_contract_id', source.blank_contract_id)).limit(1);
  if (error) { toast.error(error.message); return null; }
  return ((data || [])[0] as ContractVersion | undefined) ?? null;
}

/**
 * A contract's versions, newest first. Loads when it mounts, so it is mounted
 * only once someone opens a History: the contract page, the Contracts list and
 * every public page read no versions until then.
 *
 * A signed version also has the file itself, the only copy /verify will
 * confirm; a PDF drawn again from the same terms is a new rasterisation and
 * never matches the hash. `actions` adds what the host can do with a version.
 */
export default function ContractVersionList({ source, highlightId = null, actions }: {
  source: ContractSource;
  highlightId?: string | null;
  actions?: (v: ContractVersion) => ReactNode;
}) {
  const [versions, setVersions] = useState<ContractVersion[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [column, id] = 'rental_request_id' in source
    ? ['rental_request_id', source.rental_request_id] as const
    : ['blank_contract_id', source.blank_contract_id] as const;

  useEffect(() => {
    (async () => {
      const query = supabase.from('contract_versions').select(COLUMNS);
      const { data, error } = await (column === 'rental_request_id'
        ? query.eq('rental_request_id', id)
        : query.eq('blank_contract_id', id))
        .order('saved_at', { ascending: false })
        .limit(200);
      if (error) { toast.error(error.message); setVersions([]); return; }
      const rows = (data || []) as ContractVersion[];
      setVersions(rows);
      const ids = [...new Set(rows.map(v => v.saved_by).filter((x): x is string => !!x))];
      if (ids.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, display_name, email').in('id', ids);
        setNames(Object.fromEntries((profiles || []).map(p => [p.id, p.display_name || p.email || 'Unnamed'])));
      }
    })();
  }, [column, id]);

  if (versions === null) return <p className="font-serif text-sm text-muted-foreground">Loading…</p>;
  if (versions.length === 0) {
    return (
      <p className="font-serif text-sm text-muted-foreground">
        No saved versions yet. History starts with the first save after 16 October 2026.
      </p>
    );
  }
  return (
    <ol className="space-y-2" aria-label="Versions, newest first">
      {versions.map(v => (
        <li key={v.id} className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border/40 px-3 py-2">
          <div className="min-w-0">
            <p className="font-serif text-sm">
              {format(new Date(v.saved_at), 'MMM d, yyyy h:mm a')}
              {' '}
              {v.event === 'signed'
                ? <Badge className="text-xs ml-1"><BadgeCheck className="h-3 w-3 mr-1" aria-hidden="true" />Signed</Badge>
                : <Badge variant="outline" className="text-xs ml-1">Saved</Badge>}
              {highlightId === v.id && <Badge variant="secondary" className="text-xs ml-1">Showing</Badge>}
            </p>
            <p className="font-serif text-xs text-muted-foreground">
              {v.saved_by ? names[v.saved_by] || '…' : 'Unknown'}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            {actions?.(v)}
            {v.signed_pdf_path && (
              <Button size="sm" variant="outline" onClick={() => openSignedContractPdf(v.signed_pdf_path!)} title="The file as it was signed">
                <BadgeCheck className="h-4 w-4 mr-1" /> Signed PDF
              </Button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
