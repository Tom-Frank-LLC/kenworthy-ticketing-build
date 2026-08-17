import { Link } from 'react-router-dom';
import { LegalDoc, H2, P, B, Bullets, ContactBlock } from '@/components/LegalDoc';

// The privacy policy, published at /privacy.
//
// This describes what the site actually does, which is why it is specific
// about the service providers by name and blunt about the things we do not do
// (no ad pixels, no analytics, no stored card numbers, no patron accounts).
// If any of that changes — a tracker gets added, a provider gets swapped, a
// new category of data gets collected — this page has to change in the same
// commit, and the "Last updated" date below has to move with it.

export default function Privacy() {
  return (
    <LegalDoc
      kicker="Legal"
      title="Privacy Policy"
      seoTitle="Privacy Policy — Kenworthy"
      description="How the Kenworthy Performing Arts Centre collects, uses, and protects your personal information — and the things we deliberately don’t do."
      path="/privacy"
      lastUpdated="August 15, 2026"
    >
      <P>
        Kenworthy Performing Arts Centre (“the Kenworthy,” “we,” “us,” or “our”) operates this
        website to sell tickets and film passes, accept donations, take theatre-rental requests, and
        share information about our programs. This policy explains what personal information we
        collect, how we use it, who we share it with, and the choices you have. It applies to this
        website and the related email and text-message confirmations we send.
      </P>
      <P>
        We’ve written this to describe what the site <B>actually does</B> — including several things
        it deliberately <B>does not</B> do. Your use of the site is also governed by our{' '}
        <Link to="/terms" className="text-primary hover:underline">
          Terms of Use
        </Link>
        .
      </P>

      <H2>The short version</H2>
      <Bullets
        items={[
          <>
            We collect the minimum we need to sell you a ticket or pass, send it to you, process a
            donation, or respond to a rental request — typically your name, email, and/or phone
            number, and (for mailed film passes) a mailing address.
          </>,
          <>
            <B>We never see or store your full card number.</B> Card payments are handled by Square;
            our system only receives a one-time token that authorizes the charge.
          </>,
          <>
            <B>We do not sell, rent, or trade your personal information</B>, and we do not use
            advertising or behavioral tracking. There are no third-party ad pixels or analytics
            trackers on this site.
          </>,
          <>
            <B>You do not need an account</B> to buy tickets. You reach your tickets through a
            private link we email or text you.
          </>,
          <>
            We share information only with the service providers that make the site work (payments,
            email/text delivery, our mailing list, our donor and accounting systems), and only as
            needed to provide the service.
          </>,
        ]}
      />

      <H2>Information we collect</H2>
      <P>We collect information you give us directly when you use the site:</P>
      <P>
        <B>When you buy tickets:</B> your name, and an email address and/or phone number so we can
        deliver your tickets and confirmation. We create a purchase record (what you bought, when,
        and the amount).
      </P>
      <P>
        <B>When you buy a film pass:</B> your name, email, and/or phone; and, if you choose to have a
        physical pass mailed to you, a <B>mailing address</B>.
      </P>
      <P>
        <B>When you make a donation:</B> your name, email, phone (if provided), the donation amount,
        and any optional dedication or message you add.
      </P>
      <P>
        <B>When you request a theatre rental:</B> your name, email, phone, an optional secondary
        contact, and details about your proposed event.
      </P>
      <P>
        <B>When you sign up for our newsletter:</B> your email address (and name, if provided).
      </P>
      <P>
        <B>Payment information:</B> when you pay by card, you enter your card details directly into a
        secure payment field hosted by <B>Square</B>. Square processes the card and returns only a
        single-use token to us. We do not receive, see, or store your card number, CVV, or full card
        details.
      </P>
      <P>
        <B>Staff and volunteers:</B> people with staff or administrator accounts provide an email
        address and password (for login) and may have work-related records such as timecards and
        payroll information, and — if displayed on our site — a name, title, photo, and bio. This
        information is used to run the organization, not for marketing.
      </P>
      <P>
        <B>Information collected automatically:</B> like most websites, our hosting provider records
        basic technical information (such as IP address and browser type) in standard server logs to
        keep the site secure and running. We do not run analytics or advertising trackers.
      </P>

      <H2>How we use your information</H2>
      <P>We use the information we collect to:</P>
      <Bullets
        items={[
          'process and deliver your tickets, film passes, and donation receipts;',
          <>
            send you transactional confirmations by <B>email and/or text message</B> (for example,
            your tickets and QR codes, or a donation acknowledgment);
          </>,
          'respond to theatre-rental requests and prepare rental agreements and invoices;',
          <>
            send you our newsletter and program announcements <B>if</B> you have signed up or opted
            in — you can unsubscribe at any time;
          </>,
          'record donations in our donor system and issue acknowledgments;',
          'keep financial and accounting records as required to run a nonprofit and meet tax and reporting obligations;',
          'operate, secure, and improve the website, and prevent fraud and abuse.',
        ]}
      />

      <H2>Payment processing</H2>
      <P>
        Card payments are processed by <B>Square, Inc.</B> Your card information is entered into
        Square’s secure payment field and is transmitted directly to Square; our servers receive only
        a one-time payment token, never your card number. Square’s handling of your payment data is
        governed by Square’s own privacy policy. We designed the checkout this way specifically so
        that sensitive card data never touches our systems.
      </P>

      <H2>Service providers we share information with</H2>
      <P>
        We share personal information only with the third-party providers that operate parts of the
        service on our behalf, and only to the extent needed to provide it:
      </P>
      <Bullets
        items={[
          <>
            <B>Square</B> — card payment processing, and, for in-person sales, point-of-sale and
            related services.
          </>,
          <>
            <B>Resend</B> — delivery of transactional emails (ticket confirmations, receipts,
            account/security emails).
          </>,
          <>
            <B>Twilio</B> — delivery of text-message (SMS) confirmations, where you provide a mobile
            number.
          </>,
          <>
            <B>Mailchimp</B> — our email newsletter and marketing list. If you subscribe or opt in,
            we share your email address (and name, if provided) and basic purchase tags so we can
            send relevant updates.
          </>,
          <>
            <B>Little Green Light</B> — our donor management system. When you donate, we record your
            name, email, phone (if provided), and gift details there so we can acknowledge and track
            contributions.
          </>,
          <>
            <B>QuickBooks Online</B> — our accounting system, which receives financial records and
            staff payroll/labor summaries for bookkeeping.
          </>,
          <>
            <B>Supabase</B> — our database, authentication, and application backend, where the
            information above is securely stored.
          </>,
          <>
            <B>Cloudflare</B> — hosting and content delivery for the website.
          </>,
        ]}
      />
      <P>
        Each of these providers processes information under its own privacy and security terms. We do
        not authorize them to use your information for their own marketing.
      </P>
      <P>
        We may also disclose information if required by law, to comply with legal process, to enforce
        our agreements, or to protect the rights, safety, and property of the Kenworthy, our patrons,
        or others.
      </P>

      <H2>What we do not do</H2>
      <Bullets
        items={[
          <>
            We do <B>not</B> sell, rent, or trade your personal information to anyone.
          </>,
          <>
            We do <B>not</B> use third-party advertising networks, ad pixels, or
            behavioral-tracking/analytics scripts on this site.
          </>,
          <>
            We do <B>not</B> store your full credit-card number or security code — Square handles
            card data.
          </>,
          <>
            We do <B>not</B> require patrons to create an account or password; your tickets are
            reached through a private link we send you.
          </>,
          <>
            We do <B>not</B> use your information for automated decision-making that produces legal
            or similarly significant effects about you.
          </>,
        ]}
      />

      <H2>Cookies and local storage</H2>
      <P>
        We keep our use of cookies and browser storage to what’s necessary for the site to function.
        We do not use advertising or cross-site tracking cookies. Staff and administrators who log in
        have a secure session stored in their browser to keep them signed in. Our hosting provider
        (Cloudflare) may set essential operational cookies to deliver and secure the site. You can
        control cookies through your browser settings, though disabling essential storage may affect
        how the site works.
      </P>

      <H2>Email and text messages</H2>
      <P>
        Ticket confirmations, receipts, and other <B>transactional</B> messages are sent because
        they’re necessary to complete a purchase you made; these are not marketing.
      </P>
      <P>
        <B>Marketing emails</B> (our newsletter and program announcements) are sent only if you
        signed up or opted in. Every marketing email includes an unsubscribe link, and you can opt
        out at any time. If you receive text-message confirmations and wish to stop, you can reply
        STOP or contact us.
      </P>

      <H2>Data retention</H2>
      <P>
        We keep personal information for as long as needed to provide the service and to meet our
        legal, accounting, and reporting obligations. Purchase, donation, and financial records are
        retained as required for tax and nonprofit recordkeeping. Newsletter information is kept
        until you unsubscribe. When information is no longer needed, we take reasonable steps to
        delete or de-identify it.
      </P>

      <H2>How we protect your information</H2>
      <P>
        We use reasonable administrative and technical safeguards to protect personal information,
        including encrypted connections (HTTPS), tokenized payments so card data never reaches our
        servers, access controls that limit staff access to what their role requires, and audit
        logging of sensitive administrative actions. No method of transmission or storage is
        completely secure, so we cannot guarantee absolute security.
      </P>

      <H2>Your choices and rights</H2>
      <P>You can:</P>
      <Bullets
        items={[
          <>
            <B>unsubscribe</B> from marketing emails at any time via the link in any such email;
          </>,
          <>
            <B>access, correct, or delete</B> the personal information we hold about you, or ask us
            questions about it, by contacting us using the details below;
          </>,
          <>
            <B>decline to provide</B> information, though some of it is necessary to complete a
            purchase or request.
          </>,
        ]}
      />
      <P>
        The Kenworthy is based in Idaho, which does not currently have a comprehensive consumer
        data-privacy law. Even so, we honor reasonable requests to access, correct, or delete the
        personal information we hold about you. If you reside in a state or country whose laws grant
        additional privacy rights, we will honor those rights where they apply. To make a request,
        contact us using the details below; we may need to verify your identity first.
      </P>

      <H2>Children’s privacy</H2>
      <P>
        This site is intended for a general audience and is not directed to children under 13, and we
        do not knowingly collect personal information from children under 13. If you believe a child
        has provided us personal information, please contact us and we will delete it.
      </P>

      <H2>Links to other sites</H2>
      <P>
        Our site may link to third-party websites (for example, a press article, a performer’s page,
        or a payment provider). We are not responsible for the privacy practices of those sites; we
        encourage you to review their policies.
      </P>

      <H2>Changes to this policy</H2>
      <P>
        We may update this policy from time to time. When we do, we will revise the “Last updated”
        date above and post the new version on this page. Significant changes will be highlighted
        where appropriate.
      </P>

      <H2>Contact us</H2>
      <P>
        If you have questions about this policy or your personal information, contact:
      </P>
      <ContactBlock />
    </LegalDoc>
  );
}
