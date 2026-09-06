import { resolveRedirect } from './redirects';
import { classify } from './routes';

const isPage = (p: string) => classify(p).kind !== 'unknown';

describe('legacy WordPress URLs', () => {
  it('maps the pages Google still holds to their successors', () => {
    expect(resolveRedirect('/contact-us/', '', isPage)).toEqual({ status: 301, location: '/about' });
    expect(resolveRedirect('/support/', '', isPage)).toEqual({ status: 301, location: '/donate' });
    expect(resolveRedirect('/donate/our-supporters/', '', isPage)).toEqual({ status: 301, location: '/sponsors' });
    expect(resolveRedirect('/theatre-rental-request-form/', '', isPage)).toEqual({ status: 301, location: '/rental-request' });
    expect(resolveRedirect('/privacy-policy', '', isPage)).toEqual({ status: 301, location: '/privacy' });
  });

  it('sends every old event page to the calendar', () => {
    expect(resolveRedirect('/events/some-film-2025/', '', isPage)).toEqual({ status: 301, location: '/calendar' });
    expect(resolveRedirect('/events/', '', isPage)).toEqual({ status: 301, location: '/calendar' });
  });

  it('strips the WordPress trailing slash from a current route', () => {
    expect(resolveRedirect('/calendar/', '', isPage)).toEqual({ status: 301, location: '/calendar' });
    expect(resolveRedirect('/history/', '?x=1', isPage)).toEqual({ status: 301, location: '/history?x=1' });
  });

  it('answers 410 for WordPress internals', () => {
    expect(resolveRedirect('/wp-content/uploads/a.jpg', '', isPage)).toEqual({ status: 410 });
    expect(resolveRedirect('/xmlrpc.php', '', isPage)).toEqual({ status: 410 });
    expect(resolveRedirect('/feed/', '', isPage)).toEqual({ status: 410 });
  });

  it('leaves current routes and unknown paths alone', () => {
    expect(resolveRedirect('/calendar', '', isPage)).toBeNull();
    expect(resolveRedirect('/', '', isPage)).toBeNull();
    expect(resolveRedirect('/', '?utm_source=x', isPage)).toBeNull();
    expect(resolveRedirect('/showing/8f07c7c3-6145-4158-b354-139d46f8fe82', '', isPage)).toBeNull();
    expect(resolveRedirect('/no-such-page/', '', isPage)).toBeNull();
  });

  it('collapses WordPress query permalinks to the home page', () => {
    expect(resolveRedirect('/', '?p=123', isPage)).toEqual({ status: 301, location: '/' });
  });
});
