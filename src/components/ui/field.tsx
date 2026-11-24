import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The label / hint / error wiring every hand-rolled form on this site was
 * missing.
 *
 * `ui/form.tsx` already does this, but only for react-hook-form, and nothing
 * imports it — the public forms (guest checkout, film passes, donate, rental
 * request) are all plain `useState`. So each of them grew its own shape:
 * `<Label>` with no `htmlFor`, and errors as loose `<p className="text-
 * destructive">` next to the input. Visually correct, and invisible to a
 * screen reader — submit an invalid checkout and nothing is announced at all.
 * That is WCAG 3.3.1 and 3.3.3, on the page that takes the card.
 *
 * The render-prop is deliberate. Handing the caller the wired props keeps this
 * component out of the business of knowing whether the control is an Input, a
 * Textarea, a Select or a Switch, which is what made the shared helper in
 * RentalRequest useless — it wrapped `children` and so could never reach the
 * control to put an id on it.
 *
 *   <Field label="Email" required error={errors.email} hint="For your tickets">
 *     {(p) => <Input {...p} type="email" value={email} onChange={...} />}
 *   </Field>
 */

export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
  required?: boolean;
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  labelClassName,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  /** Marks the control required for AT *and* the browser. */
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
        {required && (
          // The asterisk is decoration; `aria-required` is what carries the
          // meaning, so it is not read out twice.
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
        required,
      })}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * The one look for an error under a field, shared by `Field` and the forms that
 * still wire their own inputs (GuestCheckoutForm, SquareCardForm), so the pay
 * path cannot drift back to bare red text.
 *
 * The icon is the point (WCAG 1.4.1). Red text alone marks an error by colour,
 * and a red-deficient buyer sees it only as another line of grey copy. The
 * colour passes as it stands: `--destructive` is 6.1:1 on the background and
 * 5.7:1 on a card, and still 4.9 / 4.6:1 under a full protanopia simulation
 * (Machado 2009). The old `0 72% 51%` red, which the original checkout brief
 * was written against, dropped to 2.6:1 under that simulation.
 *
 * Not role="alert": FormErrorSummary (or CheckoutError) announces the failure
 * once. An alert per field talks over itself.
 */
export function FieldError({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-sm text-destructive", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * What actually gets announced on a failed submit.
 *
 * `aria-describedby` on each field tells someone what is wrong once they reach
 * it. It does not tell them anything happened. Without a live region a screen
 * reader user presses Pay, hears nothing, and has no way to know the form
 * refused — which is the failure this pair exists to close.
 *
 * `tabIndex={-1}` so the caller can move focus here after a failed submit.
 */
export const FormErrorSummary = React.forwardRef<
  HTMLDivElement,
  { errors: Record<string, string>; title?: string; className?: string }
>(({ errors, title = "There is a problem with this form", className }, ref) => {
  const list = Object.entries(errors).filter(([, v]) => !!v);
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-live="assertive" className={cn(className)}>
      {list.length > 0 && (
        // Foreground text on the tint, with the red kept for the border and
        // icon — the same treatment as CheckoutError. Red text on this tint is
        // 5.0:1 to normal vision but 4.2:1 under a protanopia simulation, and
        // this is the box a red-deficient buyer most needs to read.
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          <p className="flex items-start gap-2 text-sm font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{title}</span>
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-10 text-sm">
            {list.map(([key, message]) => (
              <li key={key}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
FormErrorSummary.displayName = "FormErrorSummary";
