import type { ReactNode } from 'react';
import { SEO } from '@/components/SEO';

// Shared shell for the two legal documents, /privacy and /terms.
//
// The site has no `prose` plugin, so long-form body copy has nowhere to get
// its typography from. Rather than repeat the same class strings on a few
// hundred paragraphs across two files, the styles live here. That is also
// what keeps the pair looking like a pair: the documents cross-link each
// other, and a reader who follows that link should not feel like they landed
// somewhere else.
//
// These are content pages, not a design system. Anything more elaborate than
// a heading, a paragraph, and a bulleted list belongs in the document itself.

export function LegalDoc({
  title,
  kicker,
  seoTitle,
  description,
  path,
  lastUpdated,
  children,
}: {
  title: string;
  kicker: string;
  seoTitle: string;
  description: string;
  path: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SEO title={seoTitle} description={description} path={path} />

      <section className="border-b border-accent/20 bg-card/40">
        <div className="container py-14 md:py-20 max-w-3xl">
          <p className="font-display uppercase tracking-[0.3em] text-sm text-primary mb-4">
            {kicker}
          </p>
          <h1 className="font-display uppercase text-4xl md:text-5xl leading-tight text-foreground">
            {title}
          </h1>
          <p className="font-display uppercase tracking-[0.15em] text-xs text-accent mt-6">
            Last updated: {lastUpdated}
          </p>
        </div>
      </section>

      <section className="container py-12 md:py-16 max-w-3xl [&>*:first-child]:mt-0">
        {children}
      </section>
    </div>
  );
}

/** A section heading. Numbered in the Terms, unnumbered in the Privacy Policy. */
export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display uppercase text-2xl md:text-3xl text-foreground mt-12 mb-4">
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="font-serif text-muted-foreground leading-relaxed mb-4">{children}</p>;
}

/** Emphasis inside body copy — lifts the phrase to full contrast. */
export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-3 mb-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 font-serif text-muted-foreground leading-relaxed">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** The address block that closes both documents. */
export function ContactBlock() {
  return (
    <address className="not-italic font-serif text-muted-foreground leading-relaxed rounded-lg border border-accent/20 bg-card/40 px-5 py-4">
      <span className="font-semibold text-foreground">Kenworthy Performing Arts Centre</span>
      <br />
      508 S Main St, Moscow, ID 83843
      <br />
      Phone:{' '}
      <a href="tel:+12088824127" className="text-primary hover:underline">
        208-882-4127
      </a>
      <br />
      Email:{' '}
      <a href="mailto:events@kenworthy.org" className="text-primary hover:underline">
        events@kenworthy.org
      </a>
    </address>
  );
}
