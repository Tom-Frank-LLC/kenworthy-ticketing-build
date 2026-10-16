import { formatPlainDate } from '@/lib/datetime';

/**
 * A contract PDF's file name: the event day and title, `2026_11_13_French_Film_Festival.pdf`,
 * so a folder of downloads sorts by date. `-signed` marks the signed copy.
 *
 * The day is a calendar date (`yyyy-MM-dd`), read as written by formatPlainDate:
 * `new Date('2026-11-13')` is UTC midnight, which is the 12th in Moscow, Idaho.
 * A contract with no title yet is BLANK; one with no date just leaves it off.
 */
export function contractFilename({ date, title, signed = false }: {
  date?: string | null;
  title?: string | null;
  signed?: boolean;
}): string {
  const day = formatPlainDate(date, 'yyyy_MM_dd');
  const name = (title ?? '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'BLANK';
  return `${[day, name].filter(Boolean).join('_')}${signed ? '-signed' : ''}.pdf`;
}

/** What a blank contract is called in a list and a file name: what it is for, else who it is with. */
export function blankTitle(f: { purpose: string; name: string; organization: string }): string {
  return f.purpose.trim() || f.name.trim() || f.organization.trim();
}

/**
 * The day a request's contract is for: the Term as staff set it, else the day
 * the renter asked for. An empty term_date is a deliberate blank on the
 * contract, and is no date here either.
 */
export function requestContractDate(
  contractData: unknown,
  proposedDate: string | null | undefined,
): string | null {
  const term = (contractData as { term_date?: unknown } | null)?.term_date;
  const day = typeof term === 'string' ? term : proposedDate;
  return day || null;
}

export type RequestContractSource = {
  id: string;
  event_title: string | null;
  proposed_date: string | null;
  contract_data: unknown;
  signed_at: string | null;
  signed_pdf_path: string | null;
  assigned_to: string | null;
  invite_token: string;
  status: string;
};

export type BlankContractSource = {
  id: string;
  title: string;
  event_date: string | null;
};

/** One row of the Contracts list, from either source. */
export type ContractListRow = {
  key: string;
  kind: 'request' | 'blank';
  /** The rental request's id, or the blank contract's. */
  id: string;
  title: string;
  eventDate: string | null;
  signed: boolean;
  assignedTo: string | null;
  /** The rental request's own status (pending, approved…); none for a blank. */
  requestStatus: string | null;
  /** Where staff open and edit it. */
  path: string;
  /** The renter's link; a blank contract has no renter. */
  renterPath: string | null;
  signedPdfPath: string | null;
};

export type ContractFilter = 'all' | 'draft' | 'signed';

/**
 * Every request's contract and every saved blank, latest event first. Rows
 * with no date go last: they are mostly blanks still being filled in.
 */
export function contractRows(
  requests: RequestContractSource[],
  blanks: BlankContractSource[],
  filter: ContractFilter = 'all',
): ContractListRow[] {
  const rows: ContractListRow[] = [
    ...requests.map((r): ContractListRow => ({
      key: `request:${r.id}`,
      kind: 'request',
      id: r.id,
      title: r.event_title || 'Untitled rental',
      eventDate: requestContractDate(r.contract_data, r.proposed_date),
      signed: !!r.signed_at,
      assignedTo: r.assigned_to,
      requestStatus: r.status,
      path: `/contract/${r.invite_token}`,
      renterPath: `/contract/${r.invite_token}`,
      signedPdfPath: r.signed_pdf_path,
    })),
    ...blanks.map((b): ContractListRow => ({
      key: `blank:${b.id}`,
      kind: 'blank',
      id: b.id,
      title: b.title || 'Untitled blank contract',
      eventDate: b.event_date,
      signed: false,
      assignedTo: null,
      requestStatus: null,
      path: `/contract/blank/${b.id}`,
      renterPath: null,
      signedPdfPath: null,
    })),
  ];
  return rows
    .filter(r => filter === 'all' || (filter === 'signed') === r.signed)
    .sort((a, b) => {
      if (a.eventDate !== b.eventDate) {
        if (!a.eventDate) return 1;
        if (!b.eventDate) return -1;
        return a.eventDate < b.eventDate ? 1 : -1;
      }
      return a.title.localeCompare(b.title);
    });
}
