import { CreditCard, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { useTerminalReader } from '@/lib/terminalReader';

/** The reader this station sends card sales to. Sits in the POS header. */
export function TerminalReaderPicker({ reader }: { reader: ReturnType<typeof useTerminalReader> }) {
  const { readers, chosenId, choose, loading, error, refresh } = reader;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
      <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Label htmlFor="terminal-reader" className="text-sm">Card reader</Label>
      <Select value={chosenId ?? ''} onValueChange={(v) => choose(v || null)} disabled={loading || readers.length === 0}>
        <SelectTrigger id="terminal-reader" className="w-64">
          <SelectValue placeholder={loading ? 'Looking for readers…' : readers.length === 0 ? 'No readers paired' : 'Choose this station’s reader'} />
        </SelectTrigger>
        <SelectContent>
          {readers.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}{r.status !== 'AVAILABLE' ? ` (${r.status.toLowerCase()})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon" aria-label="Refresh readers" onClick={() => refresh()} disabled={loading}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
      {!loading && !error && !chosenId && readers.length > 0 && (
        <span className="text-sm text-muted-foreground">Card sales need a reader — pick the one on this counter.</span>
      )}
    </div>
  );
}
