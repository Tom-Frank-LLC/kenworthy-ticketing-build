import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DollarSign, Banknote, CreditCard, AlertTriangle } from 'lucide-react';
import { useSquareEnvironment } from '@/hooks/useSquareEnvironment';

export type PaymentMethod = 'cash' | 'card';

interface PaymentMethodSelectorProps {
  paymentMethod: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentMethodSelector({ paymentMethod, onSelect }: PaymentMethodSelectorProps) {
  // The sandbox warning used to render on every card sale, production
  // included, because nothing here knew the environment. Only a confirmed
  // sandbox shows it; unknown shows nothing (see useSquareEnvironment).
  const environment = useSquareEnvironment();

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" /> Payment Method
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onSelect('cash')}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
              paymentMethod === 'cash'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            )}
          >
            <Banknote className={cn('h-8 w-8', paymentMethod === 'cash' ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-sm font-medium', paymentMethod === 'cash' ? 'text-primary' : 'text-muted-foreground')}>
              Cash
            </span>
          </button>
          <button
            onClick={() => onSelect('card')}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
              paymentMethod === 'card'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            )}
          >
            <CreditCard className={cn('h-8 w-8', paymentMethod === 'card' ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-sm font-medium', paymentMethod === 'card' ? 'text-primary' : 'text-muted-foreground')}>
              Card (Square)
            </span>
          </button>
        </div>

        {paymentMethod === 'card' && environment === 'sandbox' && (
          <div className="mt-3 p-3 rounded-lg bg-secondary/50 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Sandbox mode — payments are simulated, no real charges</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
