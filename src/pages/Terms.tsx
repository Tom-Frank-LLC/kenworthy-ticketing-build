import { Link } from 'react-router-dom';
import { LegalDoc, H2, P, B, Bullets, ContactBlock } from '@/components/LegalDoc';

// The terms of use, published at /terms.
//
// Several sections here are policy, not description, and they were set
// deliberately against what the Kenworthy already publishes elsewhere:
//
//   §6  refunds/exchanges — matches kenworthy.org/ticket-info-policies
//       verbatim in substance: full refund on a cancelled performance, no
//       other refunds, exchanges up to 24 hours prior. Do not loosen the
//       exchange window here without changing it there too; patrons have
//       been promised it since at least 2025.
//   §8  the 501(c)(3) language and Tax ID mirror the donation receipt in
//       supabase/functions/_shared/donations.ts. If one moves, move both —
//       the receipt is what a donor uses to substantiate a deduction.
//   §4  house rules (general admission, 30-minute lobby open, accessibility
//       equipment, group discounts) also come from the ticket-info page.
//
// Sections 14, 15, 16 and 19 are boilerplate that has not been through
// counsel. They are accurate as written but conservative.

export default function Terms() {
  return (
    <LegalDoc
      kicker="Legal"
      title="Terms of Use"
      seoTitle="Terms of Use — Kenworthy"
      description="The terms governing ticket and film pass purchases, donations, and theatre rental requests made through the Kenworthy Performing Arts Centre website."
      path="/terms"
      lastUpdated="August 15, 2026"
    >
      <P>
        These Terms of Use (“Terms”) govern your use of the Kenworthy Performing Arts Centre website
        and your purchases of tickets, film passes, donations, and rental requests made through it
        (“the Services”). By using the site or making a purchase, you agree to these Terms. If you do
        not agree, please do not use the Services.
      </P>
      <P>
        In these Terms, “the Kenworthy,” “we,” “us,” and “our” refer to Kenworthy Performing Arts
        Centre, 508 S Main St, Moscow, ID 83843.
      </P>

      <H2>1. Who we are and what we offer</H2>
      <P>
        The Kenworthy is a historic performing arts venue. Through this site you can buy tickets to
        films, events, and live performances; purchase film passes; make donations; and submit
        theatre-rental requests. Availability, showtimes, pricing, and programming may change.
      </P>

      <H2>2. Eligibility and accounts</H2>
      <P>
        You do not need an account to buy tickets, passes, or make a donation — you complete these as
        a guest and receive your tickets by a private link sent to your email or phone. Accounts
        exist only for Kenworthy staff and administrators; if you hold one, you are responsible for
        keeping your login credentials secure and for activity under your account.
      </P>

      <H2>3. Purchases, prices, and payment</H2>
      <P>
        All prices are shown in U.S. dollars. Applicable taxes and fees, if any, are shown before you
        complete a purchase. Card payments are processed securely by <B>Square, Inc.</B>; we do not
        receive or store your full card number. By submitting a payment, you represent that you are
        authorized to use the payment method. We may cancel or refuse an order if we suspect fraud,
        error, or a pricing mistake. If an event is priced or listed in error, we reserve the right to
        correct it and to cancel affected orders with a refund.
      </P>

      <H2>4. Tickets and admission</H2>
      <P>
        When you buy a ticket, we deliver it — with a QR code — by email and/or text message, and it
        can be viewed through the private link we send. Please have your QR code ready for scanning
        at the door. Each ticket admits entry once; a ticket that has already been scanned, or that
        has been refunded or voided, will not be admitted.
      </P>
      <P>
        Seating for most screenings is <B>general admission</B> and is not reserved, unless a specific
        event uses assigned seating. Our box office and lobby typically open 30 minutes before start
        time. Accessible and wheelchair seating is available, as are assistive listening devices and
        ADA closed captioning and audio description devices for digital films; please contact the box
        office as far in advance as possible for accessible seats or special requests. Discounts are
        available for groups of 8 or more.
      </P>
      <P>
        We may refuse admission or remove anyone for disruptive, unsafe, or unlawful behavior, and
        latecomers may be seated at a break or at staff discretion.
      </P>

      <H2>5. Programming changes and cancellations</H2>
      <P>
        Showtimes, films, performers, and events are subject to change. If we <B>cancel</B> an event,
        we will make available a refund as described in §6. If an event is <B>rescheduled</B>, your
        ticket will normally be honored for the new date, or you may request the remedy described in
        §6.
      </P>

      <H2>6. Refunds and exchanges</H2>
      <P>
        <B>Refunds.</B> If the Kenworthy cancels a performance, refunds will be made in full. Except
        where required by law, no other refunds will be made. Refunds, where granted, are issued to
        the original payment method.
      </P>
      <P>
        <B>Exchanges.</B> Tickets may be exchanged up to 24 hours prior to the performance, subject to
        availability. To arrange an exchange, contact the box office using the details in §20.
      </P>
      <P>
        <B>Rescheduled events.</B> If an event is rescheduled, your ticket will be honored for the new
        date. If you cannot attend the new date, contact the box office.
      </P>
      <P>
        Film passes are non-refundable except as required by law; see §7.
      </P>

      <H2>7. Film passes</H2>
      <P>
        Film passes may be purchased online and picked up at the box office or mailed to the address
        you provide. A pass is valid for <B>eligible showings</B> (generally standard-admission films)
        at the pass’s redemption price, subject to seating availability. Some pass types expire a set
        number of days after purchase, and some limit how many admissions may be used per showing;
        the specific terms for each pass are shown at purchase.
      </P>
      <P>
        Passes are <B>transferable</B> — a pass may be given as a gift and used by whoever presents
        it — but a lost or stolen pass <B>cannot be replaced</B>, so please treat a pass like cash.
        Passes have no cash value and are non-refundable except as required by law. Commercial resale
        of passes is prohibited; see §11.
      </P>

      <H2>8. Donations</H2>
      <P>
        Donations are voluntary and, once made, are <B>non-refundable</B> except in the case of a
        processing error.
      </P>
      <P>
        Kenworthy Performing Arts Centre is a{' '}
        <B>
          501(c)(3) nonprofit organization, Tax ID{' '}
          <span className="whitespace-nowrap">82-0519693</span>
        </B>
        . No goods or services are provided in exchange for a contribution, so donations are
        tax-deductible to the full extent allowed by law. We send an acknowledgment for your records
        — keep it for tax purposes.
      </P>

      <H2>9. Theatre rentals</H2>
      <P>
        Submitting a rental <B>request</B> through the site does not confirm a booking. A rental is
        confirmed only when the Kenworthy and you enter into a signed rental agreement. The rental
        agreement (and any deposit, invoice, or payment terms in it, processed via Square) governs the
        rental and prevails over these Terms for that transaction. Rental fees, deposits, and
        cancellation terms are set out in that agreement.
      </P>

      <H2>10. Communications</H2>
      <P>
        By providing your email or phone number at checkout, you agree that we may send you{' '}
        <B>transactional</B> messages necessary to complete and confirm your purchase (tickets,
        receipts, event updates). Marketing emails are sent only if you sign up or opt in, and you may
        unsubscribe at any time. For how we handle your information, see our{' '}
        <Link to="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>
        .
      </P>

      <H2>11. Acceptable use and ticket resale</H2>
      <P>You agree not to:</P>
      <Bullets
        items={[
          'use the Services for any unlawful or fraudulent purpose;',
          'interfere with or disrupt the site or its security;',
          'attempt to access data or accounts that are not yours;',
          'scrape, harvest, or bulk-download content.',
        ]}
      />
      <P>
        Tickets and film passes are sold for your personal, non-commercial use. You may not resell,
        offer for resale, or transfer any ticket or pass for commercial purposes or at a price above
        what you paid, and you may not use automated means — bots, scripts, or bulk-purchasing tools
        — to purchase tickets. We may void or cancel, without refund, any ticket or pass we
        reasonably believe was purchased or transferred in violation of this section, and we may
        refuse admission to the holder.
      </P>
      <P>You are responsible for the accuracy of the information you provide.</P>

      <H2>12. Intellectual property</H2>
      <P>
        The site and its content — text, layout, the Kenworthy name and logo, and other materials we
        create — are owned by or licensed to the Kenworthy and are protected by law. Film posters,
        artwork, trailers, and performer materials remain the property of their respective owners and
        are used to promote scheduled programming. You may not copy, reproduce, or use our content
        except for your personal, non-commercial use of the Services.
      </P>

      <H2>13. Third-party services and links</H2>
      <P>
        The Services rely on third-party providers (for example, Square for payments) and may link to
        third-party websites. Your use of those services is subject to their own terms and privacy
        practices. We are not responsible for the content, products, or practices of third parties.
      </P>

      <H2>14. Disclaimers</H2>
      <P>
        The Services are provided “as is” and “as available,” without warranties of any kind, express
        or implied, to the fullest extent permitted by law. We do not warrant that the site will be
        uninterrupted or error-free, or that programming details shown are free of mistakes. Nothing
        in these Terms excludes any warranty or right that cannot be excluded under applicable law.
      </P>

      <H2>15. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, the Kenworthy and its officers, directors, staff, and
        volunteers will not be liable for any indirect, incidental, special, or consequential damages
        arising from your use of the Services or attendance at an event. Where liability cannot be
        excluded, our total liability for any claim relating to a purchase is limited to the amount
        you paid for the ticket, pass, or item at issue.
      </P>

      <H2>16. Indemnification</H2>
      <P>
        You agree to indemnify and hold harmless the Kenworthy from claims arising out of your misuse
        of the Services or violation of these Terms, to the extent permitted by law.
      </P>

      <H2>17. Privacy</H2>
      <P>
        Your use of the Services is also governed by our{' '}
        <Link to="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>
        , which explains what information we collect and how we use it.
      </P>

      <H2>18. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. Changes take effect when posted, and we will
        update the “Last updated” date above. Your continued use of the Services after changes are
        posted means you accept the updated Terms.
      </P>

      <H2>19. Governing law</H2>
      <P>
        These Terms are governed by the laws of the State of Idaho, without regard to its
        conflict-of-laws rules. Any dispute relating to these Terms or the Services will be brought in
        the state or federal courts located in Idaho, and you consent to their jurisdiction.
      </P>

      <H2>20. Contact us</H2>
      <P>Questions about these Terms or a purchase? Contact:</P>
      <ContactBlock />
    </LegalDoc>
  );
}
