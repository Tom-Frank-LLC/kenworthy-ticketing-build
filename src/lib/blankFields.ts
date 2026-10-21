/**
 * What a staffer has typed into the blank contract. Strings throughout, numbers
 * included: an empty field must stay empty and print as a ruled line, where a
 * number would fall back to 0 and print "$0.00" for someone to cross out.
 * `alcohol_addendum` empty means undecided, and the form carries both addenda.
 */
export type BlankFields = {
  name: string;
  organization: string;
  email: string;
  phone: string;
  agreement_date: string;
  event_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  purpose: string;
  max_attendees: string;
  hourly_rate: string;
  base_hours: string;
  /** A second theater-rental rate, for an event billed at two (e.g. $120 and $180). */
  rental_rate_2: string;
  rental_hours_2: string;
  additional_hours_rate: string;
  additional_hours: string;
  rehearsal_rate: string;
  rehearsal_hours: string;
  staff_rate: string;
  staff_hours: string;
  concessions_fee: string;
  av_fee: string;
  nonprofit_discount: string;
  alcohol_addendum: '' | 'served' | 'not_served';
  /**
   * Days in the Term besides the event, each with its own hours: a rehearsal
   * on the Thursday before a Friday show. Not the same thing as `end_date`,
   * which is one run of consecutive days at the same hours.
   */
  extra_days: TermDay[];
};

export type TermDay = { label: string; date: string; start: string; end: string };

export const EMPTY_BLANK: BlankFields = {
  name: '', organization: '', email: '', phone: '',
  agreement_date: '', event_date: '', end_date: '', start_time: '', end_time: '',
  purpose: '', max_attendees: '',
  hourly_rate: '', base_hours: '', rental_rate_2: '', rental_hours_2: '', additional_hours_rate: '', additional_hours: '',
  rehearsal_rate: '', rehearsal_hours: '',
  staff_rate: '', staff_hours: '', concessions_fee: '', av_fee: '', nonprofit_discount: '',
  alcohol_addendum: '',
  extra_days: [],
};
