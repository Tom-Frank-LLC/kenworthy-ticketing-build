import RentalRequest from './RentalRequest';

/**
 * /backstage-enquiry — the Backstage page's "Enquire about booking Backstage".
 *
 * A route of its own rather than a query parameter on /rental-request, because
 * this is a link staff will send to people ("here, fill this in") and a URL
 * that says what it is survives being pasted into a text message. It is also
 * the thing that can be made noindex without touching the theatre form.
 *
 * All of the form is in RentalRequest — this only chooses the door. See the
 * mode comment there for what Backstage mode changes and why it is a mode
 * rather than a second copy of the form.
 */
export default function BackstageEnquiry() {
  return <RentalRequest mode="backstage" />;
}
