import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { History, Banknote, CreditCard, RotateCcw, Send } from 'lucide-react';

export interface SessionTransaction {
  id: string;
  ticketIds: string[];
  /** Handle for a resend — the only identifier send-ticket-confirmation takes. */
  orderToken: string;
  /** What the confirmation was actually sent to, so a resend can correct it. */
  patronEmail: string;
  patronPhone: string;
  movieTitle: string;
  seatLabels: string[];
  total: number;
  paymentMethod: 'cash' | 'card';
  timestamp: Date;
  refunded: boolean;
}

interface TransactionHistoryProps {
  transactions: SessionTransaction[];
  onRefund: (tx: SessionTransaction) => void;
  onResend: (tx: SessionTransaction) => void;
}

export function TransactionHistory({ transactions, onRefund, onResend }: TransactionHistoryProps) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Session Transactions
          {transactions.length > 0 && (
            <Badge variant="secondary" className="ml-auto">{transactions.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            No transactions yet this session
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Movie</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(tx => (
                  <TableRow key={tx.id} className={tx.refunded ? 'opacity-50' : ''}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(tx.timestamp, 'h:mm a')}
                    </TableCell>
                    <TableCell className="text-sm font-medium max-w-[150px] truncate">
                      {tx.movieTitle}
                    </TableCell>
                    <TableCell className="text-xs">
                      {tx.seatLabels.join(', ')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {tx.paymentMethod === 'cash' ? (
                          <><Banknote className="h-3 w-3 mr-1" /> Cash</>
                        ) : (
                          <><CreditCard className="h-3 w-3 mr-1" /> Card</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      ${tx.total.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Offered even on a refunded sale: the patron may still
                            need the record, and the refund is what tells them
                            the seat is gone — not a missing email. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onResend(tx)}
                        >
                          <Send className="h-3.5 w-3.5 mr-1" />
                          Resend
                        </Button>
                        {tx.refunded ? (
                          <Badge variant="destructive" className="text-xs">Refunded</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRefund(tx)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Refund
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
