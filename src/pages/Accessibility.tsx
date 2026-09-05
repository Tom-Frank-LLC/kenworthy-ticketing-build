import { Link } from 'react-router-dom';
import { B, Bullets, ContactBlock, H2, LegalDoc, P } from '@/components/LegalDoc';

/**
 * The accessibility statement.
 *
 * This page was a ComingSoon stub. #237 put KPAC's own facility list into that
 * stub's blurb, which was the right content in a page that could not hold it —
 * one paragraph, still headed "a full accessibility guide is in progress".
 * This is that guide.
 *
 * **The building facts are KPAC's, verbatim from #237**, and they are the
 * authority: one ADA restroom, wheelchair seating, stairless entry and access
 * throughout the entire auditorium, a stage lift, assistive listening devices,
 * and open caption screening options. An earlier draft of this page derived a
 * similar list from §4 of the Terms of Use and got it wrong in both directions
 * — it said "restrooms" plural, and it missed the stage lift and the stairless
 * entry entirely. If any of this changes, change it here and in
 * `src/pages/Terms.tsx`, which carries an overlapping subset.
 *
 * The digital half deliberately states a *target* and its current gaps rather
 * than a bare conformance claim. "Conforms to WCAG 2.2 AA" is a sentence a
 * plaintiff gets to test; "here is the standard we work to, here is what is
 * not there yet, here is a human who will help you today" is both truthful and
 * the stronger position. Keep the known-limitations list honest — see
 * docs/accessibility-audit.md, and update it when those items close.
 */
export default function Accessibility() {
  return (
    <LegalDoc
      kicker="Everyone at the Kenworthy"
      title="Accessibility"
      seoTitle="Accessibility — Kenworthy Performing Arts Centre"
      description="Wheelchair seating, stairless entry, assistive listening, a stage lift and open-caption screenings at the Kenworthy Performing Arts Centre in Moscow, Idaho — and how to reach us with an access request."
      path="/accessibility"
      lastUpdated="September 4, 2026"
    >
      <P>
        The Kenworthy has been a public building on Main Street since 1926, and we want a
        century-old theatre to be a place anyone can spend an evening in. This page sets out
        what we have, what we do not have yet, and how to ask us for something.
      </P>
      <P>
        <B>If something on this page or on this website gets in your way, tell us.</B> Call the
        box office on{' '}
        <a href="tel:+12088824127" className="text-primary underline underline-offset-4">
          208-882-4127
        </a>{' '}
        or email{' '}
        <a href="mailto:events@kenworthy.org" className="text-primary underline underline-offset-4">
          events@kenworthy.org
        </a>
        . We will help you directly — with a seat, with a booking, or by reading you what is on
        the screen.
      </P>

      <H2>In the building</H2>
      <Bullets
        items={[
          <>
            <B>Stairless entry, and access throughout the entire auditorium.</B>
          </>,
          <>
            <B>Wheelchair seating</B> in the auditorium.
          </>,
          <>
            <B>One ADA restroom.</B>
          </>,
          <>
            A <B>stage lift</B>.
          </>,
          <>
            <B>Assistive listening devices</B>, available from the box office.
          </>,
          <>
            <B>Open caption screening options.</B> Ask us which screenings are captioned, or
            request one.
          </>,
        ]}
      />
      <P>
        Seating for most screenings is general admission and is not reserved, so{' '}
        <B>please contact the box office as far in advance as you can</B> for an accessible seat
        or any other request. The lobby and box office typically open 30 minutes before start
        time. A request made in advance is one we can plan around; a request made at the door is
        one we will still do our best with. Neither costs anything, and neither needs
        documentation.
      </P>

      <H2>On this website</H2>
      <P>
        We build and test this site against <B>WCAG 2.2 Level AA</B> — the standard the Americans
        with Disabilities Act and Section 508 are generally read against. That is the target we
        work to, not a certificate we hold.
      </P>
      <P>What that means in practice:</P>
      <Bullets
        items={[
          <>
            Buying a ticket, buying a film pass and making a donation can each be completed{' '}
            <B>using only a keyboard</B>, with a visible focus indicator throughout.
          </>,
          <>
            Every form field has a label a screen reader can read, and form errors are announced
            rather than only shown.
          </>,
          <>
            Text is sized in relative units and the whole interface scales with your browser zoom
            or your operating system's large-text setting. The default is deliberately larger
            than most sites.
          </>,
          <>
            If your device is set to <B>reduce motion</B>, the site stops animating.
          </>,
          <>
            Body text and interface colours are checked against the AA contrast thresholds by
            calculation, not by eye.
          </>,
        ]}
      />

      <H2>What is not there yet</H2>
      <P>We would rather list these than let you discover them:</P>
      <Bullets
        items={[
          <>
            The <B>Silent Film Festival programmes</B> on{' '}
            <Link to="/silent-film-festival" className="text-primary underline underline-offset-4">
              our festival page
            </Link>{' '}
            are shown as page images. The <B>2025</B> booklet can be downloaded as a PDF whose
            text a screen reader can read; the <B>2024</B> and <B>2023</B> programmes cannot be
            read that way yet. Email or call us and we will tell you what is in any programme you
            are interested in.
          </>,
          <>
            <B>Film trailers</B> come from the studios and distributors that made them, and we
            cannot add captions to someone else's video. Our player asks for captions to be
            switched on wherever the distributor supplied them, but some trailers have none.
            Trailers are never the only place a showing's details appear — the title, date, time,
            price and synopsis are always in text on the same page.
          </>,
          <>
            Some parts of the <B>staff-facing admin tools</B> are still being brought up to the
            same standard as the public site.
          </>,
        ]}
      />

      <H2>Telling us about a problem</H2>
      <P>
        If you hit a barrier on this site, we want to hear about it, and we would rather hear
        about it early than politely. Tell us what page you were on and what happened; if you
        know what you were using — a screen reader, magnification, keyboard only, voice control —
        that helps us reproduce it, but it is not required.
      </P>
      <P>
        We aim to reply within two business days, and to tell you either that it is fixed or when
        it will be. In the meantime the box office can complete any purchase for you over the
        phone.
      </P>
      <ContactBlock />
    </LegalDoc>
  );
}
