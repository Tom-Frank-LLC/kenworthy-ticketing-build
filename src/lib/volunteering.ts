/**
 * Volunteer copy and contact details, ported from kenworthy.org/hiring and
 * kenworthy.org/volunteer. Shared because the Hiring and Volunteer pages quote
 * the same roster of duties and the same coordinator — keeping one copy means
 * a phone number or a role only has to change in one place.
 */

export const VOLUNTEER_DUTIES = [
  'Help prepare, serve, and sell our iconic movie popcorn, candy, and sodas',
  'Assist patrons with ticket purchases in the box office',
  'Help clean-up after a show',
  'Assist with special events',
] as const;

export const VOLUNTEER_COORDINATOR = {
  name: 'Natalia Valencia',
  title: 'Volunteer Coordinator',
  email: 'hiring@kenworthy.org',
  phone: '(208) 882-4127',
  /** E.164-ish form for the `tel:` href. */
  phoneHref: '+12088824127',
} as const;
