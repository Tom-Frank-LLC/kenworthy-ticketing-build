import * as React from "react";

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
      {error && (
        // Not role="alert": the summary below announces the whole set once.
        // One alert per invalid field talks over itself.
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
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
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">{title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-destructive">
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
