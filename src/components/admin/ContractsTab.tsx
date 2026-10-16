import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BadgeCheck, Copy, Download, ExternalLink, FileText, History, Link2, Plus, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { openSignedContractPdf } from '@/lib/signedContractPdf';
import { formatPlainDate } from '@/lib/datetime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  contractRows,
  type BlankContractSource,
  type ContractFilter,
  type ContractListRow,
  type RequestContractSource,
} from '@/lib/contracts';
import { useTeamRoster } from './useTeamRoster';
import ContractVersionList from '@/components/contract/ContractVersionList';

/**
 * Admin → Rentals → Contracts: every contract, whatever it came from.
 *
 * A rental request's contract lives on the request (contract_data); a blank
 * contract a staffer saved or downloaded lives in blank_contracts. Requests
 * stays the enquiry queue (status, invoice, notes); this is the paperwork.
 *
 * The list reads no history. A row's History expands it to list that
 * contract's versions, loaded then and only for that row; Open on a version
 * shows the contract as it was (/contract/…?version=<id>).
 */
export default function ContractsTab() {
  const [requests, setRequests] = useState<RequestContractSource[]>([]);
  const [blanks, setBlanks] = useState<BlankContractSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ContractFilter>('all');
  // Rows whose History is expanded, by row key.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { teamName } = useTeamRoster();

  async function load() {
    setLoading(true);
    const [reqs, blnk] = await Promise.all([
      fetchAllRows<RequestContractSource>((from, to) =>
        supabase
          .from('rental_requests')
          .select('id, event_title, proposed_date, contract_data, signed_at, signed_pdf_path, assigned_to, invite_token, status')
          .order('id')
          .range(from, to) as any),
      fetchAllRows<BlankContractSource>((from, to) =>
        supabase
          .from('blank_contracts')
          .select('id, title, event_date')
          .order('id')
          .range(from, to) as any),
    ]);
    if (reqs.error) toast.error((reqs.error as any).message);
    if (blnk.error) toast.error((blnk.error as any).message);
    setRequests(reqs.data);
    setBlanks(blnk.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const rows = contractRows(requests, blanks, filter);
  const publicFormUrl = `${window.location.origin}/rental-request`;

  function toggleHistory(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function copy(url: string, what: string) {
    navigator.clipboard.writeText(url);
    toast.success(`${what} copied to clipboard`);
  }

  async function deleteBlank(row: ContractListRow) {
    if (!confirm(`Delete "${row.title}" and its history? This cannot be undone.`)) return;
    const { data, error } = await supabase.from('blank_contracts').delete().eq('id', row.id).select('id');
    if (error) toast.error(error.message);
    else if (data?.length !== 1) toast.error('Not deleted — this account cannot delete contracts');
    else { toast.success('Deleted'); load(); }
  }

  return (
    <div className="space-y-4">
      <CollapsibleSection id="rentals.public-form" title="Public rental form">
        <p className="font-serif text-xs text-muted-foreground break-all">{publicFormUrl}</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => copy(publicFormUrl, 'Link')}>
            <Copy className="h-4 w-4 mr-1" /> Copy link
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={publicFormUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" /> Open
            </a>
          </Button>
          {/* For a rental done outside the request form: the full contract as a
              worksheet, every fill-in a ruled line until something is typed. */}
          <Button size="sm" variant="outline" asChild title="The contract with every fill-in left blank, to fill in here or by hand">
            <a href="/contract/blank" target="_blank" rel="noreferrer">
              <Plus className="h-4 w-4 mr-1" /> Blank contract
            </a>
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="rentals.contracts"
        title="Contracts"
        count={rows.length}
        defaultOpen
        actions={
          <Select value={filter} onValueChange={v => setFilter(v as ContractFilter)}>
            <SelectTrigger className="w-40" aria-label="Show"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Not signed</SelectItem>
              <SelectItem value="signed">Signed</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 font-serif">No contracts{filter !== 'all' && ' here'}.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(r => (
              <Card key={r.key} className="glass">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{r.title}</p>
                        {r.signed ? (
                          <Badge className="text-xs"><BadgeCheck className="h-3 w-3 mr-1" aria-hidden="true" />Signed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Not signed</Badge>
                        )}
                        {r.kind === 'blank' && <Badge variant="secondary" className="text-xs">Blank</Badge>}
                        {r.assignedTo && (
                          <Badge variant="outline" className="text-xs">
                            <UserRound className="h-3 w-3 mr-1" aria-hidden="true" />
                            <span className="sr-only">Point person: </span>{teamName(r.assignedTo)}
                          </Badge>
                        )}
                      </div>
                      <p className="font-serif text-xs text-muted-foreground mt-1">
                        {formatPlainDate(r.eventDate, 'EEE MMM d, yyyy') || 'No date yet'}
                        {r.requestStatus && <> • request <span className="capitalize">{r.requestStatus}</span></>}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0 flex-wrap">
                      <Button size="sm" variant="outline" asChild>
                        <a href={r.path} target="_blank" rel="noreferrer">
                          <FileText className="h-4 w-4 mr-1" /> Open
                        </a>
                      </Button>
                      {/* The PDF is drawn from the page, so Download opens the
                          contract and it downloads itself once it has rendered. */}
                      <Button size="sm" variant="outline" asChild title="Download the current contract as a PDF">
                        <a href={`${r.path}?download=1`} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4 mr-1" /> Download
                        </a>
                      </Button>
                      {r.signedPdfPath && (
                        <Button size="sm" variant="outline" onClick={() => openSignedContractPdf(r.signedPdfPath!)} title="The file as it was signed">
                          <BadgeCheck className="h-4 w-4 mr-1" /> Signed PDF
                        </Button>
                      )}
                      {r.renterPath && (
                        <Button size="sm" variant="ghost" title="Copy contract link for renter" aria-label="Copy contract link for renter"
                          onClick={() => copy(`${window.location.origin}${r.renterPath}`, 'Renter contract link')}>
                          <Link2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => toggleHistory(r.key)}
                        aria-expanded={expanded.has(r.key)} aria-controls={`history-${r.key}`}>
                        <History className="h-4 w-4 mr-1" /> {expanded.has(r.key) ? 'Hide history' : 'History'}
                      </Button>
                      {r.kind === 'blank' && (
                        <Button size="sm" variant="ghost" className="text-destructive" title="Delete this blank contract" aria-label={`Delete ${r.title}`}
                          onClick={() => deleteBlank(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded.has(r.key) && (
                    <div id={`history-${r.key}`} className="border-t border-border/40 pt-3">
                      <ContractVersionList
                        source={r.kind === 'request' ? { rental_request_id: r.id } : { blank_contract_id: r.id }}
                        actions={v => (
                          <Button size="sm" variant="outline" asChild title="Open the contract showing this version">
                            <a href={`${r.path}?version=${v.id}`} target="_blank" rel="noreferrer">
                              <FileText className="h-4 w-4 mr-1" /> Open
                            </a>
                          </Button>
                        )}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
