-- The History page's timeline moves out of the bundle and into kenworthy_history.
--
-- Until now every milestone on /history came from a SEED array hardcoded in
-- src/pages/History.tsx; kenworthy_history held 0 rows in both production and
-- staging (checked 2026-11-13). The page merged the two, so the admin editor
-- could add a milestone but could never change or remove one of the 26 that
-- were actually on the page. Moving them here makes every milestone editable.
--
-- Photos: the seed's images were Vite-imported, so their URLs carried a content
-- hash that changes with every build and could not be stored. They now live in
-- public/images/history/ at stable paths. A replacement photo uploaded from the
-- admin goes to the public `posters` bucket (folder history/) as a full URL.
--
-- Idempotent: a row is inserted only if no milestone with the same year and
-- title (case-insensitive) exists, which is the same key the old page used to
-- let a database row override a seed entry. Re-running it, or running it after
-- someone has added one of these by hand, does not duplicate anything.
--
-- display_order carries the seed's original order; the page sorts by year
-- first and uses it only to break a tie within a year.

INSERT INTO public.kenworthy_history
  (year, category, title, description, image_url, source_url, display_order)
SELECT v.year, v.category, v.title, v.description, v.image_url, v.source_url, v.display_order
FROM (VALUES
  (1908, 'milestone', 'The Crystal Theater opens', 'Part of the building at 508 S. Main first operates as The Crystal Theater — Moscow''s opera house.', '/images/history/Crystal-Theatre-1908.webp', 'https://www.kenworthy.org/history/', 0),
  (1925, 'milestone', 'Milburn Kenworthy buys the theater', 'Milburn Kenworthy purchases the theater and gives it the name it still carries a century later.', NULL, 'https://www.kenworthy.org/history/', 1),
  (1926, 'milestone', 'Opening night on Main Street', 'The Kenworthy opens to the public on January 4, 1926. The premiere film is "We Moderns" — a silent picture that is now lost.', '/images/history/kenworthy-1926-auditorium.webp', 'https://www.kenworthy.org/history/', 2),
  (1927, 'programming', 'Vaudeville, silents, and a pipe organ', 'A full but shallow stage with proscenium and fly space hosts vaudeville and dramatic productions; a screen rolls in front for silent films. Milburn Kenworthy buys a Robert Morton theater pipe organ to accompany them.', '/images/history/Kenworthy-1926.webp', 'https://www.kenworthy.org/history/', 3),
  (1928, 'renovation', 'The brick building is enlarged', 'The original brick structure is extended twenty feet to the south.', '/images/history/kenworthy-1928-facade.webp', 'https://www.kenworthy.org/history/', 4),
  (1935, 'milestone', 'A decade in: the family movie house', 'By the mid-1930s Kenworthy is woven into downtown — the vertical blade sign and chained marquee a fixture of Main Street.', NULL, 'https://www.kenworthy.org/history/', 5),
  (1936, 'community', 'The pipe organ goes to the University of Idaho', 'Milburn Kenworthy gifts the Robert Morton organ to the University of Idaho. After restoration it''s installed in the U of I Auditorium, where it still resides.', NULL, 'https://www.kenworthy.org/history/', 6),
  (1949, 'renovation', 'New terracotta façade and bigger marquee', 'A streamlined terracotta tile façade and enlarged marquee go up. By now the Kenworthy is Moscow''s premier movie theater.', NULL, 'https://www.kenworthy.org/history/', 7),
  (1952, 'programming', 'Quo Vadis and the postwar Main Street', 'A summer afternoon on S. Main: the Kenworthy blade sign rises over a row of parked sedans, "Quo Vadis" on the marquee next door to the Nuart.', '/images/history/moscow-main-street-1952.webp', NULL, 8),
  (1953, 'programming', 'Kirk Douglas in The Bad and the Beautiful', 'A real-photo postcard of Main Street, Moscow — the Nuart marquee playing "The Band Wagon" and Kirk Douglas, with the Kenworthy a block south.', '/images/history/moscow-main-street-1953.webp', NULL, 9),
  (1958, 'community', 'A wet night under the neon', 'Saturday night downtown: rain on the asphalt, Fonk''s and the Paper House lit up, holiday lights strung across Main.', '/images/history/moscow-main-street-1950s-night.webp', NULL, 10),
  (1965, 'community', 'Davids’, Drugs, and the long blue hour', 'Postcard dusk on Main Street in the mid-1960s — the Kenworthy still anchoring the block as downtown rebuilds around it.', '/images/history/moscow-main-street-1965.webp', NULL, 11),
  (1971, 'milestone', 'Milburn Kenworthy passes', 'Milburn Kenworthy dies on December 2, 1971. After several years of management transitions, Judd Kenworthy inherits the family theaters.', NULL, 'https://www.kenworthy.org/history/', 12),
  (1979, 'renovation', 'Café Libre takes over backstage', 'The back stage is converted into a coffee house — Café Libre — connected to BookPeople of Moscow next door. Movies keep running in the main auditorium.', NULL, 'https://www.kenworthy.org/history/', 13),
  (1984, 'closure', 'Leased to Carmike Cinemas', 'The Kenworthy Theatre is leased to the Carmike chain. Judd Kenworthy retires from the movie business.', NULL, 'https://www.kenworthy.org/history/', 14),
  (1987, 'renovation', 'Backstage becomes offices', 'The back stage is converted again, this time into an office and apartment housing Kenworthy Enterprises.', NULL, 'https://www.kenworthy.org/history/', 15),
  (1999, 'milestone', 'Gifted to the community', 'On December 31, 1999, the Judd Kenworthy family gifts the theater to Moscow Community Theatre, Inc.', NULL, 'https://www.kenworthy.org/history/', 16),
  (2000, 'reopening', 'Live theater returns after 75 years', 'The nonprofit Kenworthy Performing Arts Centre, Inc. forms and begins restoration. On November 2, Moscow Community Theater stages Little Shop of Horrors — complete with the original Broadway Audrey II puppet — and live theater is back at the Kenworthy after a 75-year absence.', '/images/history/kenworthy-historic-interior.webp', 'https://www.kenworthy.org/history/', 17),
  (2001, 'milestone', 'On the National Register of Historic Places', 'The Kenworthy Theatre is listed on the National Register of Historic Places.', NULL, 'https://www.kenworthy.org/history/', 18),
  (2008, 'renovation', 'ADA restrooms, marquee, expanded stage', 'Major renovations through the 2000s: ADA-accessible restrooms are installed, the marquee is refurbished, and the stage is expanded for live productions.', NULL, 'https://www.kenworthy.org/history/', 19),
  (2012, 'renovation', 'Bathrooms, paint, sidewalk — original tile kept', 'New paint, sidewalk work, and refreshed bathrooms — the original 1949 tile is preserved.', NULL, 'https://www.kenworthy.org/history/', 20),
  (2013, 'renovation', 'Digital projection conversion', 'A community fundraising push pays for a digital projector, completing the conversion so first-run independent and foreign films can keep playing in Moscow.', NULL, 'https://www.kenworthy.org/history/', 21),
  (2014, 'programming', 'Inaugural MET Live in HD season', 'The Kenworthy launches its first season of MET Live in HD broadcasts.', NULL, 'https://www.kenworthy.org/history/', 22),
  (2019, 'renovation', 'Art Deco seats and carpet, true to the original', 'Major interior renovations install new Art Deco seats and carpeting consistent with the building''s original design.', NULL, 'https://www.kenworthy.org/history/', 23),
  (2025, 'renovation', 'Marquee comes down for restoration', 'Crews strip the 1949 marquee back to its frame — original timbers, rusted steel, and all — to rebuild it for the next hundred years.', '/images/history/kenworthy-2025-marquee-restoration.webp', NULL, 24),
  (2026, 'milestone', '100 years on Main Street', 'A full centennial season — retrospectives, restorations, and a town-wide birthday party for the theater that has outlasted almost everything around it.', '/images/history/kenworthy-today-marquee-night.webp', NULL, 25)
) AS v(year, category, title, description, image_url, source_url, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.kenworthy_history h
  WHERE h.year = v.year AND lower(h.title) = lower(v.title)
);
