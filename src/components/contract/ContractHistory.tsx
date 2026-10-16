import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Eye, FileText, History } from 'lucide-react';
import { format } from 'date-fns';
import ContractVersionList, { type ContractSource, type ContractVersion } from './ContractVersionList';

export type { ContractVersion } from './ContractVersionList';

/**
 * History on the contract page. View puts a version's terms back in the
 * editor, where Download prints it and Save makes it current again. The list
 * is read only once History is opened (ContractVersionList mounts then).
 */
export default function ContractHistory({ source, viewing, onView, onBackToCurrent, defaultOpen = false, linkedBlanksOf }: {
  source: ContractSource;
  viewing: ContractVersion | null;
  onView: (v: ContractVersion) => void;
  onBackToCurrent: () => void;
  defaultOpen?: boolean;
  /** A request's id: also list the history of any blank contract it was made from. */
  linkedBlanksOf?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const viewingId = viewing?.id ?? null;
  const [blanks, setBlanks] = useState<{ id: string; title: string }[]>([]);

  // A blank's versions are BlankFields, not this contract's shape, so they are
  // opened on the blank's own page rather than viewed in this editor.
  useEffect(() => {
    if (!open || !linkedBlanksOf) return;
    supabase.from('blank_contracts').select('id, title').eq('linked_request_id', linkedBlanksOf)
      .then(({ data }) => setBlanks((data as { id: string; title: string }[] | null) ?? []));
  }, [open, linkedBlanksOf]);

  return (
    <div className="print:hidden container max-w-5xl px-4 mt-4">
      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
              <History className="h-4 w-4 mr-1" /> {open ? 'Hide history' : 'History'}
            </Button>
            {viewing && (
              <Button size="sm" onClick={onBackToCurrent}>Back to the current version</Button>
            )}
          </div>
          {viewing && (
            <p className="font-serif text-sm" role="status">
              Showing the version {viewing.event === 'signed' ? 'signed' : 'saved'} {format(new Date(viewing.saved_at), 'MMM d, yyyy h:mm a')}.
              {' '}Download prints it as it was. Save makes its terms the current contract again
              {'rental_request_id' in source && "; the renter's name, dates and purpose stay as the request has them now"}.
            </p>
          )}
          {open && (
            <ContractVersionList
              source={source}
              highlightId={viewingId}
              actions={v => (
                <Button size="sm" variant="outline" onClick={() => onView(v)} disabled={viewingId === v.id}>
                  <Eye className="h-4 w-4 mr-1" /> View
                </Button>
              )}
            />
          )}
          {open && blanks.map(b => (
            <section key={b.id} className="space-y-2 border-t border-border/40 pt-3" aria-label={`Before it was linked: ${b.title || 'blank contract'}`}>
              <h3 className="font-display uppercase text-sm tracking-wide">
                Before it was linked: the blank contract{b.title && <> &ldquo;{b.title}&rdquo;</>}
              </h3>
              <ContractVersionList
                source={{ blank_contract_id: b.id }}
                actions={v => (
                  <Button size="sm" variant="outline" asChild title="Open the blank contract showing this version">
                    <a href={`/contract/blank/${b.id}?version=${v.id}`} target="_blank" rel="noreferrer">
                      <FileText className="h-4 w-4 mr-1" /> Open
                    </a>
                  </Button>
                )}
              />
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
