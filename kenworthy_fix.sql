-- ============================================================
-- Kenworthy Fix Script
-- Generated: 2026-08-11T01:57:08.428337
-- 1. Adds showings for all live events
-- 2. Fixes HTML entities in movie/event titles
-- Run against staging first, then production
-- ============================================================

-- TIMEZONE: Moscow, Idaho is in the PACIFIC half of Idaho, not Mountain.
-- These files were generated against 'America/Boise' (Mountain), which stored
-- every showtime exactly one hour early. Corrected to America/Los_Angeles on
-- 2026-08-12; see supabase/migrations/20260812180000_showings_pacific_not_mountain.sql
-- for the backfill of the rows the Boise version already wrote.
SET timezone = 'America/Los_Angeles';

-- ── FIX HTML ENTITIES IN MOVIE TITLES ──────────────────────

-- Fix: 'Maddie&#8217;s Secret' -> "Maddie's Secret"
UPDATE public.movies SET title = 'Maddie''s Secret' WHERE title = 'Maddie&#8217;s Secret';
-- Fix: 'Summer Family Matinee ~ Gabby&#8217;s Dollhouse: The Movie' -> "Summer Family Matinee ~ Gabby's Dollhouse: The Movie"
UPDATE public.movies SET title = 'Summer Family Matinee ~ Gabby''s Dollhouse: The Movie' WHERE title = 'Summer Family Matinee ~ Gabby&#8217;s Dollhouse: The Movie';
-- Fix: 'The Society for Conservation Biology: Fish &#038; Wildlife Film Festival' -> 'The Society for Conservation Biology: Fish & Wildlife Film Festival'
UPDATE public.movies SET title = 'The Society for Conservation Biology: Fish & Wildlife Film Festival' WHERE title = 'The Society for Conservation Biology: Fish &#038; Wildlife Film Festival';
-- Fix: 'The People&#8217;s Joker' -> "The People's Joker"
UPDATE public.movies SET title = 'The People''s Joker' WHERE title = 'The People&#8217;s Joker';
-- Fix: 'New Restorations: Kiki&#8217;s Delivery Service' -> "New Restorations: Kiki's Delivery Service"
UPDATE public.movies SET title = 'New Restorations: Kiki''s Delivery Service' WHERE title = 'New Restorations: Kiki&#8217;s Delivery Service';
-- Fix: 'The Apprentice with Filmmaker Q&#038;A' -> 'The Apprentice with Filmmaker Q&A'
UPDATE public.movies SET title = 'The Apprentice with Filmmaker Q&A' WHERE title = 'The Apprentice with Filmmaker Q&#038;A';
-- Fix: 'Moscow Film Society: Don&#8217;t Look Now' -> "Moscow Film Society: Don't Look Now"
UPDATE public.movies SET title = 'Moscow Film Society: Don''t Look Now' WHERE title = 'Moscow Film Society: Don&#8217;t Look Now';
-- Fix: 'Moscow Community Theatre: A Midsummer Night&#8217;s Dream' -> "Moscow Community Theatre: A Midsummer Night's Dream"
UPDATE public.movies SET title = 'Moscow Community Theatre: A Midsummer Night''s Dream' WHERE title = 'Moscow Community Theatre: A Midsummer Night&#8217;s Dream';
-- Fix: 'College Towns: Downtowns &#038; Campustowns' -> 'College Towns: Downtowns & Campustowns'
UPDATE public.movies SET title = 'College Towns: Downtowns & Campustowns' WHERE title = 'College Towns: Downtowns &#038; Campustowns';
-- Fix: 'Tiny Homes, Big Ideas: A Film Screening &#038; Community Discussion' -> 'Tiny Homes, Big Ideas: A Film Screening & Community Discussion'
UPDATE public.movies SET title = 'Tiny Homes, Big Ideas: A Film Screening & Community Discussion' WHERE title = 'Tiny Homes, Big Ideas: A Film Screening &#038; Community Discussion';
-- Fix: 'Oscars Recap: If I Had Legs I&#8217;d Kick You' -> "Oscars Recap: If I Had Legs I'd Kick You"
UPDATE public.movies SET title = 'Oscars Recap: If I Had Legs I''d Kick You' WHERE title = 'Oscars Recap: If I Had Legs I&#8217;d Kick You';
-- Fix: 'Dog Friendly Screening of &#8220;Best in Show&#8221;' -> 'Dog Friendly Screening of "Best in Show"'
UPDATE public.movies SET title = 'Dog Friendly Screening of "Best in Show"' WHERE title = 'Dog Friendly Screening of &#8220;Best in Show&#8221;';
-- Fix: 'Frames of Reference ~ Exhibition on Screen: Turner &#038; Constable' -> 'Frames of Reference ~ Exhibition on Screen: Turner & Constable'
UPDATE public.movies SET title = 'Frames of Reference ~ Exhibition on Screen: Turner & Constable' WHERE title = 'Frames of Reference ~ Exhibition on Screen: Turner &#038; Constable';
-- Fix: 'XR Palouse: Earth&#8217;s Greatest Enemy' -> "XR Palouse: Earth's Greatest Enemy"
UPDATE public.movies SET title = 'XR Palouse: Earth''s Greatest Enemy' WHERE title = 'XR Palouse: Earth&#8217;s Greatest Enemy';
-- Fix: 'Crafternoon: Ocean&#8217;s Eleven' -> "Crafternoon: Ocean's Eleven"
UPDATE public.movies SET title = 'Crafternoon: Ocean''s Eleven' WHERE title = 'Crafternoon: Ocean&#8217;s Eleven';
-- Fix: 'The Hunger Games: Mockingjay &#8211; Part 2' -> 'The Hunger Games: Mockingjay - Part 2'
UPDATE public.movies SET title = 'The Hunger Games: Mockingjay - Part 2' WHERE title = 'The Hunger Games: Mockingjay &#8211; Part 2';
-- Fix: 'The Hunger Games: Mockingjay &#8211; Part 1' -> 'The Hunger Games: Mockingjay - Part 1'
UPDATE public.movies SET title = 'The Hunger Games: Mockingjay - Part 1' WHERE title = 'The Hunger Games: Mockingjay &#8211; Part 1';
-- Fix: 'It&#8217;s a Wonderful Life' -> "It's a Wonderful Life"
UPDATE public.movies SET title = 'It''s a Wonderful Life' WHERE title = 'It&#8217;s a Wonderful Life';
-- Fix: 'Festive Flicks: National Lampoon&#8217;s Christmas Vacation' -> "Festive Flicks: National Lampoon's Christmas Vacation"
UPDATE public.movies SET title = 'Festive Flicks: National Lampoon''s Christmas Vacation' WHERE title = 'Festive Flicks: National Lampoon&#8217;s Christmas Vacation';
-- Fix: 'Met Live in HD: The Amazing Adventures of Kavalier &#038; Clay' -> 'Met Live in HD: The Amazing Adventures of Kavalier & Clay'
UPDATE public.movies SET title = 'Met Live in HD: The Amazing Adventures of Kavalier & Clay' WHERE title = 'Met Live in HD: The Amazing Adventures of Kavalier &#038; Clay';
-- Fix: 'Idaho Sierra Club: Wild &#038; Scenic Film Festival' -> 'Idaho Sierra Club: Wild & Scenic Film Festival'
UPDATE public.movies SET title = 'Idaho Sierra Club: Wild & Scenic Film Festival' WHERE title = 'Idaho Sierra Club: Wild &#038; Scenic Film Festival';
-- Fix: 'National Theatre Live: Mrs. Warren&#8217;s Profession' -> "National Theatre Live: Mrs. Warren's Profession"
UPDATE public.movies SET title = 'National Theatre Live: Mrs. Warren''s Profession' WHERE title = 'National Theatre Live: Mrs. Warren&#8217;s Profession';
-- Fix: 'Absolute Anime: Angel&#8217;s Egg' -> "Absolute Anime: Angel's Egg"
UPDATE public.movies SET title = 'Absolute Anime: Angel''s Egg' WHERE title = 'Absolute Anime: Angel&#8217;s Egg';
-- Fix: 'Palouse French Film Festival: Souleymane&#8217;s Story' -> "Palouse French Film Festival: Souleymane's Story"
UPDATE public.movies SET title = 'Palouse French Film Festival: Souleymane''s Story' WHERE title = 'Palouse French Film Festival: Souleymane&#8217;s Story';
-- Fix: 'Silent Film Festival: &#8220;Told in the Hills&#8221; Restoration Premiere' -> 'Silent Film Festival: "Told in the Hills" Restoration Premiere'
UPDATE public.movies SET title = 'Silent Film Festival: "Told in the Hills" Restoration Premiere' WHERE title = 'Silent Film Festival: &#8220;Told in the Hills&#8221; Restoration Premiere';
-- Fix: 'UIdaho PHA &#038; IFC: Monsters University' -> 'UIdaho PHA & IFC: Monsters University'
UPDATE public.movies SET title = 'UIdaho PHA & IFC: Monsters University' WHERE title = 'UIdaho PHA &#038; IFC: Monsters University';
-- Fix: 'It&#8217;s Never Over, Jeff Buckley' -> "It's Never Over, Jeff Buckley"
UPDATE public.movies SET title = 'It''s Never Over, Jeff Buckley' WHERE title = 'It&#8217;s Never Over, Jeff Buckley';
-- Fix: 'Moscow Film Society: A Knight&#8217;s Tale' -> "Moscow Film Society: A Knight's Tale"
UPDATE public.movies SET title = 'Moscow Film Society: A Knight''s Tale' WHERE title = 'Moscow Film Society: A Knight&#8217;s Tale';
-- Fix: 'Mission: Impossible &#8211; The Final Reckoning' -> 'Mission: Impossible - The Final Reckoning'
UPDATE public.movies SET title = 'Mission: Impossible - The Final Reckoning' WHERE title = 'Mission: Impossible &#8211; The Final Reckoning';
-- Fix: 'Summer Flicks: Bill &#038; Ted&#8217;s Excellent Adventure' -> "Summer Flicks: Bill & Ted's Excellent Adventure"
UPDATE public.movies SET title = 'Summer Flicks: Bill & Ted''s Excellent Adventure' WHERE title = 'Summer Flicks: Bill &#038; Ted&#8217;s Excellent Adventure';
-- Fix: 'Summer Family Matinee: Willy Wonka &#038; the Chocolate Factory' -> 'Summer Family Matinee: Willy Wonka & the Chocolate Factory'
UPDATE public.movies SET title = 'Summer Family Matinee: Willy Wonka & the Chocolate Factory' WHERE title = 'Summer Family Matinee: Willy Wonka &#038; the Chocolate Factory';
-- Fix: 'Cinema Classics: Ocean&#8217;s 11 (1960)' -> "Cinema Classics: Ocean's 11 (1960)"
UPDATE public.movies SET title = 'Cinema Classics: Ocean''s 11 (1960)' WHERE title = 'Cinema Classics: Ocean&#8217;s 11 (1960)';
-- Fix: 'Exhibition on Screen: Michelangelo &#8211; Love and Death' -> 'Exhibition on Screen: Michelangelo - Love and Death'
UPDATE public.movies SET title = 'Exhibition on Screen: Michelangelo - Love and Death' WHERE title = 'Exhibition on Screen: Michelangelo &#8211; Love and Death';
-- Fix: '20th Anniversary: Pride &#038; Prejudice' -> '20th Anniversary: Pride & Prejudice'
UPDATE public.movies SET title = '20th Anniversary: Pride & Prejudice' WHERE title = '20th Anniversary: Pride &#038; Prejudice';
-- Fix: 'Palouse Prairie Charter School: A Midsummer Night&#8217;s Dream' -> "Palouse Prairie Charter School: A Midsummer Night's Dream"
UPDATE public.movies SET title = 'Palouse Prairie Charter School: A Midsummer Night''s Dream' WHERE title = 'Palouse Prairie Charter School: A Midsummer Night&#8217;s Dream';
-- Fix: 'KINO Film Festival: Featured Film &#038; Trailblazer Award Presentation' -> 'KINO Film Festival: Featured Film & Trailblazer Award Presentation'
UPDATE public.movies SET title = 'KINO Film Festival: Featured Film & Trailblazer Award Presentation' WHERE title = 'KINO Film Festival: Featured Film &#038; Trailblazer Award Presentation';
-- Fix: 'Oscars Recap: I&#8217;m Still Here' -> "Oscars Recap: I'm Still Here"
UPDATE public.movies SET title = 'Oscars Recap: I''m Still Here' WHERE title = 'Oscars Recap: I&#8217;m Still Here';
-- Fix: 'Inland North Waste: Dog Friendly Screening of &#8220;A Goofy Movie&#8221;' -> 'Inland North Waste: Dog Friendly Screening of "A Goofy Movie"'
UPDATE public.movies SET title = 'Inland North Waste: Dog Friendly Screening of "A Goofy Movie"' WHERE title = 'Inland North Waste: Dog Friendly Screening of &#8220;A Goofy Movie&#8221;';
-- Fix: 'Magenta &#038; Co: Smallfoot' -> 'Magenta & Co: Smallfoot'
UPDATE public.movies SET title = 'Magenta & Co: Smallfoot' WHERE title = 'Magenta &#038; Co: Smallfoot';
-- Fix: 'Cinema Classics: Guess Who&#8217;s Coming to Dinner' -> "Cinema Classics: Guess Who's Coming to Dinner"
UPDATE public.movies SET title = 'Cinema Classics: Guess Who''s Coming to Dinner' WHERE title = 'Cinema Classics: Guess Who&#8217;s Coming to Dinner';
-- Fix: 'Stout Land &#038; Home: Elf' -> 'Stout Land & Home: Elf'
UPDATE public.movies SET title = 'Stout Land & Home: Elf' WHERE title = 'Stout Land &#038; Home: Elf';
-- Fix: 'The Three Musketeers: Part II &#8211; Milady' -> 'The Three Musketeers: Part II - Milady'
UPDATE public.movies SET title = 'The Three Musketeers: Part II - Milady' WHERE title = 'The Three Musketeers: Part II &#8211; Milady';
-- Fix: 'Exhibition on Screen ~ Van Gogh: Poets &#038; Lovers' -> 'Exhibition on Screen ~ Van Gogh: Poets & Lovers'
UPDATE public.movies SET title = 'Exhibition on Screen ~ Van Gogh: Poets & Lovers' WHERE title = 'Exhibition on Screen ~ Van Gogh: Poets &#038; Lovers';
-- Fix: 'Habib Institute for Asian Studies: Rent-a-Cat &#038; Children of the Sea' -> 'Habib Institute for Asian Studies: Rent-a-Cat & Children of the Sea'
UPDATE public.movies SET title = 'Habib Institute for Asian Studies: Rent-a-Cat & Children of the Sea' WHERE title = 'Habib Institute for Asian Studies: Rent-a-Cat &#038; Children of the Sea';
-- Fix: 'Vandal Entertainment: Spooky Double Feature (Hocus Pocus &#038; The Cabin in the Woods)' -> 'Vandal Entertainment: Spooky Double Feature (Hocus Pocus & The Cabin in the Woods)'
UPDATE public.movies SET title = 'Vandal Entertainment: Spooky Double Feature (Hocus Pocus & The Cabin in the Woods)' WHERE title = 'Vandal Entertainment: Spooky Double Feature (Hocus Pocus &#038; The Cabin in the Woods)';
-- Fix: 'UI School of Global Studies: The Teachers&#8217; Lounge' -> "UI School of Global Studies: The Teachers' Lounge"
UPDATE public.movies SET title = 'UI School of Global Studies: The Teachers'' Lounge' WHERE title = 'UI School of Global Studies: The Teachers&#8217; Lounge';
-- Fix: 'Indigenous Peoples&#8217; Day: Fancy Dance' -> "Indigenous Peoples' Day: Fancy Dance"
UPDATE public.movies SET title = 'Indigenous Peoples'' Day: Fancy Dance' WHERE title = 'Indigenous Peoples&#8217; Day: Fancy Dance';
-- Fix: 'Palouse French Film Festival: Les Trois Mousquetaires: D&#8217;Artagnan (The Three Musketeers: D&#8217;Artagnan)' -> "Palouse French Film Festival: Les Trois Mousquetaires: D'Artagnan (The Three Musketeers: D'Artagnan)"
UPDATE public.movies SET title = 'Palouse French Film Festival: Les Trois Mousquetaires: D''Artagnan (The Three Musketeers: D''Artagnan)' WHERE title = 'Palouse French Film Festival: Les Trois Mousquetaires: D&#8217;Artagnan (The Three Musketeers: D&#8217;Artagnan)';
-- Fix: 'Met Live in HD: Les Contes d&#8217;Hoffmann' -> "Met Live in HD: Les Contes d'Hoffmann"
UPDATE public.movies SET title = 'Met Live in HD: Les Contes d''Hoffmann' WHERE title = 'Met Live in HD: Les Contes d&#8217;Hoffmann';
-- Fix: 'AsiaPOP! ~ Us &#038; Them: Korean Indie Rock in a K-Pop World + God of Universe' -> 'AsiaPOP! ~ Us & Them: Korean Indie Rock in a K-Pop World + God of Universe'
UPDATE public.movies SET title = 'AsiaPOP! ~ Us & Them: Korean Indie Rock in a K-Pop World + God of Universe' WHERE title = 'AsiaPOP! ~ Us &#038; Them: Korean Indie Rock in a K-Pop World + God of Universe';
-- Fix: 'Summer Blockbuster: Ferris Bueller&#8217;s Day Off' -> "Summer Blockbuster: Ferris Bueller's Day Off"
UPDATE public.movies SET title = 'Summer Blockbuster: Ferris Bueller''s Day Off' WHERE title = 'Summer Blockbuster: Ferris Bueller&#8217;s Day Off';
-- Fix: 'Craftinee: You&#8217;ve Got Mail' -> "Craftinee: You've Got Mail"
UPDATE public.movies SET title = 'Craftinee: You''ve Got Mail' WHERE title = 'Craftinee: You&#8217;ve Got Mail';
-- Fix: 'Movie Book Club: One Flew Over the Cuckoo&#8217;s Nest' -> "Movie Book Club: One Flew Over the Cuckoo's Nest"
UPDATE public.movies SET title = 'Movie Book Club: One Flew Over the Cuckoo''s Nest' WHERE title = 'Movie Book Club: One Flew Over the Cuckoo&#8217;s Nest';
-- Fix: 'Summer Family Matinee | Madagascar 3: Europe&#8217;s Most Wanted' -> "Summer Family Matinee | Madagascar 3: Europe's Most Wanted"
UPDATE public.movies SET title = 'Summer Family Matinee | Madagascar 3: Europe''s Most Wanted' WHERE title = 'Summer Family Matinee | Madagascar 3: Europe&#8217;s Most Wanted';
-- Fix: 'Moscow Film Society: Thelma &#038; Louise' -> 'Moscow Film Society: Thelma & Louise'
UPDATE public.movies SET title = 'Moscow Film Society: Thelma & Louise' WHERE title = 'Moscow Film Society: Thelma &#038; Louise';
-- Fix: 'It&#8217;s Such a Beautiful Day + ME' -> "It's Such a Beautiful Day + ME"
UPDATE public.movies SET title = 'It''s Such a Beautiful Day + ME' WHERE title = 'It&#8217;s Such a Beautiful Day + ME';
-- Fix: 'Rosemary&#8217;s Baby' -> "Rosemary's Baby"
UPDATE public.movies SET title = 'Rosemary''s Baby' WHERE title = 'Rosemary&#8217;s Baby';
-- Fix: 'Family Flicks: Willy Wonka &#038; the Chocolate Factory' -> 'Family Flicks: Willy Wonka & the Chocolate Factory'
UPDATE public.movies SET title = 'Family Flicks: Willy Wonka & the Chocolate Factory' WHERE title = 'Family Flicks: Willy Wonka &#038; the Chocolate Factory';
-- Fix: 'Metal Monday: L&#8217;Inferno with Live Score' -> "Metal Monday: L'Inferno with Live Score"
UPDATE public.movies SET title = 'Metal Monday: L''Inferno with Live Score' WHERE title = 'Metal Monday: L&#8217;Inferno with Live Score';
-- Fix: 'Black Mold with Filmmaker Q&#038;A' -> 'Black Mold with Filmmaker Q&A'
UPDATE public.movies SET title = 'Black Mold with Filmmaker Q&A' WHERE title = 'Black Mold with Filmmaker Q&#038;A';
-- Fix: 'CCUCCC and The United Church of Moscow: God &#038; Country' -> 'CCUCCC and The United Church of Moscow: God & Country'
UPDATE public.movies SET title = 'CCUCCC and The United Church of Moscow: God & Country' WHERE title = 'CCUCCC and The United Church of Moscow: God &#038; Country';
-- Fix: 'University of Idaho Women&#8217;s Center: Marianne' -> "University of Idaho Women's Center: Marianne"
UPDATE public.movies SET title = 'University of Idaho Women''s Center: Marianne' WHERE title = 'University of Idaho Women&#8217;s Center: Marianne';
-- Fix: 'Inland North Waste: Dog Friendly Screening of &#8220;Isle of Dogs&#8221;' -> 'Inland North Waste: Dog Friendly Screening of "Isle of Dogs"'
UPDATE public.movies SET title = 'Inland North Waste: Dog Friendly Screening of "Isle of Dogs"' WHERE title = 'Inland North Waste: Dog Friendly Screening of &#8220;Isle of Dogs&#8221;';
-- Fix: 'APOD Productions: You Can&#8217;t Take it With You!' -> "APOD Productions: You Can't Take it With You!"
UPDATE public.movies SET title = 'APOD Productions: You Can''t Take it With You!' WHERE title = 'APOD Productions: You Can&#8217;t Take it With You!';
-- Fix: 'Innovia Foundation: The Emperor&#8217;s New Groove' -> "Innovia Foundation: The Emperor's New Groove"
UPDATE public.movies SET title = 'Innovia Foundation: The Emperor''s New Groove' WHERE title = 'Innovia Foundation: The Emperor&#8217;s New Groove';
-- Fix: 'Encanto with Filmmaker Q&#038;A' -> 'Encanto with Filmmaker Q&A'
UPDATE public.movies SET title = 'Encanto with Filmmaker Q&A' WHERE title = 'Encanto with Filmmaker Q&#038;A';
-- Fix: 'Studio Ghibli Retrospective: Kiki&#8217;s Delivery Service' -> "Studio Ghibli Retrospective: Kiki's Delivery Service"
UPDATE public.movies SET title = 'Studio Ghibli Retrospective: Kiki''s Delivery Service' WHERE title = 'Studio Ghibli Retrospective: Kiki&#8217;s Delivery Service';
-- Fix: 'Moscow Indigenous People&#8217;s Day: Rumble ~ The Indians Who Rocked the World' -> "Moscow Indigenous People's Day: Rumble ~ The Indians Who Rocked the World"
UPDATE public.movies SET title = 'Moscow Indigenous People''s Day: Rumble ~ The Indians Who Rocked the World' WHERE title = 'Moscow Indigenous People&#8217;s Day: Rumble ~ The Indians Who Rocked the World';
-- Fix: 'Palouse French Film Festival: L&#8217;Innocent (The Innocent)' -> "Palouse French Film Festival: L'Innocent (The Innocent)"
UPDATE public.movies SET title = 'Palouse French Film Festival: L''Innocent (The Innocent)' WHERE title = 'Palouse French Film Festival: L&#8217;Innocent (The Innocent)';
-- Fix: 'Tribute to Maurice Hornocker: American Ocelot &#038; Tigers of the Snow' -> 'Tribute to Maurice Hornocker: American Ocelot & Tigers of the Snow'
UPDATE public.movies SET title = 'Tribute to Maurice Hornocker: American Ocelot & Tigers of the Snow' WHERE title = 'Tribute to Maurice Hornocker: American Ocelot &#038; Tigers of the Snow';
-- Fix: 'Borah Symposium: Putin&#8217;s Attack on Ukraine &#8211; Documenting War Crimes' -> "Borah Symposium: Putin's Attack on Ukraine - Documenting War Crimes"
UPDATE public.movies SET title = 'Borah Symposium: Putin''s Attack on Ukraine - Documenting War Crimes' WHERE title = 'Borah Symposium: Putin&#8217;s Attack on Ukraine &#8211; Documenting War Crimes';
-- Fix: 'Women&#8217;s Final: Spain vs England' -> "Women's Final: Spain vs England"
UPDATE public.movies SET title = 'Women''s Final: Spain vs England' WHERE title = 'Women&#8217;s Final: Spain vs England';
-- Fix: 'Women&#8217;s Semi-final: Australia vs England' -> "Women's Semi-final: Australia vs England"
UPDATE public.movies SET title = 'Women''s Semi-final: Australia vs England' WHERE title = 'Women&#8217;s Semi-final: Australia vs England';
-- Fix: 'Women&#8217;s Semi-final: Spain vs Sweden' -> "Women's Semi-final: Spain vs Sweden"
UPDATE public.movies SET title = 'Women''s Semi-final: Spain vs Sweden' WHERE title = 'Women&#8217;s Semi-final: Spain vs Sweden';
-- Fix: 'Studio Ghibli Retrospective: Howl&#8217;s Moving Castle' -> "Studio Ghibli Retrospective: Howl's Moving Castle"
UPDATE public.movies SET title = 'Studio Ghibli Retrospective: Howl''s Moving Castle' WHERE title = 'Studio Ghibli Retrospective: Howl&#8217;s Moving Castle';
-- Fix: 'Films From the Vault: Singin&#8217; in the Rain' -> "Films From the Vault: Singin' in the Rain"
UPDATE public.movies SET title = 'Films From the Vault: Singin'' in the Rain' WHERE title = 'Films From the Vault: Singin&#8217; in the Rain';
-- Fix: 'Moscow Film Society: But I&#8217;m a Cheerleader' -> "Moscow Film Society: But I'm a Cheerleader"
UPDATE public.movies SET title = 'Moscow Film Society: But I''m a Cheerleader' WHERE title = 'Moscow Film Society: But I&#8217;m a Cheerleader';
-- Fix: 'Sound on Screen: A Hard Day&#8217;s Night' -> "Sound on Screen: A Hard Day's Night"
UPDATE public.movies SET title = 'Sound on Screen: A Hard Day''s Night' WHERE title = 'Sound on Screen: A Hard Day&#8217;s Night';
-- Fix: 'APOD Productions: Lionel Bart&#8217;s Oliver!' -> "APOD Productions: Lionel Bart's Oliver!"
UPDATE public.movies SET title = 'APOD Productions: Lionel Bart''s Oliver!' WHERE title = 'APOD Productions: Lionel Bart&#8217;s Oliver!';
-- Fix: 'Palouse Cult Film Revival: Pee-wee&#8217;s Big Adventure' -> "Palouse Cult Film Revival: Pee-wee's Big Adventure"
UPDATE public.movies SET title = 'Palouse Cult Film Revival: Pee-wee''s Big Adventure' WHERE title = 'Palouse Cult Film Revival: Pee-wee&#8217;s Big Adventure';
-- Fix: 'Research and Education for Autistic Children&#8217;s Treatment: Spellers' -> "Research and Education for Autistic Children's Treatment: Spellers"
UPDATE public.movies SET title = 'Research and Education for Autistic Children''s Treatment: Spellers' WHERE title = 'Research and Education for Autistic Children&#8217;s Treatment: Spellers';
-- Fix: 'Moscow Film Society: Pan&#8217;s Labyrinth' -> "Moscow Film Society: Pan's Labyrinth"
UPDATE public.movies SET title = 'Moscow Film Society: Pan''s Labyrinth' WHERE title = 'Moscow Film Society: Pan&#8217;s Labyrinth';
-- Fix: 'The Chelseas &#038; Bigger Boat' -> 'The Chelseas & Bigger Boat'
UPDATE public.movies SET title = 'The Chelseas & Bigger Boat' WHERE title = 'The Chelseas &#038; Bigger Boat';
-- Fix: 'UI Fish &#038; Wildlife Film Festival' -> 'UI Fish & Wildlife Film Festival'
UPDATE public.movies SET title = 'UI Fish & Wildlife Film Festival' WHERE title = 'UI Fish &#038; Wildlife Film Festival';
-- Fix: 'NWPB &#038; NOVA: Climate Across America' -> 'NWPB & NOVA: Climate Across America'
UPDATE public.movies SET title = 'NWPB & NOVA: Climate Across America' WHERE title = 'NWPB &#038; NOVA: Climate Across America';
-- Fix: 'University of Idaho Women&#8217;s Center: LunaFest' -> "University of Idaho Women's Center: LunaFest"
UPDATE public.movies SET title = 'University of Idaho Women''s Center: LunaFest' WHERE title = 'University of Idaho Women&#8217;s Center: LunaFest';
-- Fix: 'Palouse Cult Film Revival: Romy and Michele&#8217;s High School Reunion' -> "Palouse Cult Film Revival: Romy and Michele's High School Reunion"
UPDATE public.movies SET title = 'Palouse Cult Film Revival: Romy and Michele''s High School Reunion' WHERE title = 'Palouse Cult Film Revival: Romy and Michele&#8217;s High School Reunion';
-- Fix: 'The Whale and Virtual Q&#038;A with Sam Hunter' -> 'The Whale and Virtual Q&A with Sam Hunter'
UPDATE public.movies SET title = 'The Whale and Virtual Q&A with Sam Hunter' WHERE title = 'The Whale and Virtual Q&#038;A with Sam Hunter';
-- Fix: 'Films From the Vault: McCabe &#038; Mrs. Miller' -> 'Films From the Vault: McCabe & Mrs. Miller'
UPDATE public.movies SET title = 'Films From the Vault: McCabe & Mrs. Miller' WHERE title = 'Films From the Vault: McCabe &#038; Mrs. Miller';
-- Fix: 'Understanding Addiction &#038; Substance Use Stigma' -> 'Understanding Addiction & Substance Use Stigma'
UPDATE public.movies SET title = 'Understanding Addiction & Substance Use Stigma' WHERE title = 'Understanding Addiction &#038; Substance Use Stigma';
-- Fix: 'Moscow Community Theatre: Dracula &#8211; A Comic Thriller' -> 'Moscow Community Theatre: Dracula - A Comic Thriller'
UPDATE public.movies SET title = 'Moscow Community Theatre: Dracula - A Comic Thriller' WHERE title = 'Moscow Community Theatre: Dracula &#8211; A Comic Thriller';
-- Fix: 'PCFR &#038; SARB: Snakes on a Plane' -> 'PCFR & SARB: Snakes on a Plane'
UPDATE public.movies SET title = 'PCFR & SARB: Snakes on a Plane' WHERE title = 'PCFR &#038; SARB: Snakes on a Plane';
-- Fix: 'Inland North Waste Double Feature: The NeverEnding Story &#038; Indiana Jones and the Raiders of the Lost Ark' -> 'Inland North Waste Double Feature: The NeverEnding Story & Indiana Jones and the Raiders of the Lost Ark'
UPDATE public.movies SET title = 'Inland North Waste Double Feature: The NeverEnding Story & Indiana Jones and the Raiders of the Lost Ark' WHERE title = 'Inland North Waste Double Feature: The NeverEnding Story &#038; Indiana Jones and the Raiders of the Lost Ark';
-- Fix: 'Saturday Cartoons at the Farmer&#8217;s Market' -> "Saturday Cartoons at the Farmer's Market"
UPDATE public.movies SET title = 'Saturday Cartoons at the Farmer''s Market' WHERE title = 'Saturday Cartoons at the Farmer&#8217;s Market';
-- Fix: 'Women&#8217;s History Month: The Rider (R)' -> "Women's History Month: The Rider (R)"
UPDATE public.movies SET title = 'Women''s History Month: The Rider (R)' WHERE title = 'Women&#8217;s History Month: The Rider (R)';
-- Fix: 'Women&#8217;s History Month: Harlan County, U.S.A. (1976)' -> "Women's History Month: Harlan County, U.S.A. (1976)"
UPDATE public.movies SET title = 'Women''s History Month: Harlan County, U.S.A. (1976)' WHERE title = 'Women&#8217;s History Month: Harlan County, U.S.A. (1976)';
-- Fix: 'Mission: Joy &#8211; Finding Happiness in Troubled Times' -> 'Mission: Joy - Finding Happiness in Troubled Times'
UPDATE public.movies SET title = 'Mission: Joy - Finding Happiness in Troubled Times' WHERE title = 'Mission: Joy &#8211; Finding Happiness in Troubled Times';
-- Fix: 'Don&#8217;t Look Up' -> "Don't Look Up"
UPDATE public.movies SET title = 'Don''t Look Up' WHERE title = 'Don&#8217;t Look Up';
-- Fix: 'Moscow Food Co-op presents &#8220;Fauci&#8221;' -> 'Moscow Food Co-op presents "Fauci"'
UPDATE public.movies SET title = 'Moscow Food Co-op presents "Fauci"' WHERE title = 'Moscow Food Co-op presents &#8220;Fauci&#8221;';
-- Fix: 'MET Live in HD: The Gershwins&#8217; Porgy and Bess' -> "MET Live in HD: The Gershwins' Porgy and Bess"
UPDATE public.movies SET title = 'MET Live in HD: The Gershwins'' Porgy and Bess' WHERE title = 'MET Live in HD: The Gershwins&#8217; Porgy and Bess';

-- ── FIX HTML ENTITIES IN EVENT TITLES ─────────────────────

-- Fix: 'Moscow Music &#038; More Showcase' -> 'Moscow Music & More Showcase'
UPDATE public.events SET title = 'Moscow Music & More Showcase' WHERE title = 'Moscow Music &#038; More Showcase';
-- Fix: 'Washington Idaho Symphony ~ Voices of the East: Prokofiev &#038; Tchaikovsky' -> 'Washington Idaho Symphony ~ Voices of the East: Prokofiev & Tchaikovsky'
UPDATE public.events SET title = 'Washington Idaho Symphony ~ Voices of the East: Prokofiev & Tchaikovsky' WHERE title = 'Washington Idaho Symphony ~ Voices of the East: Prokofiev &#038; Tchaikovsky';
-- Fix: 'The Chelseas with Allison Anders &#038; Corey Oglesby' -> 'The Chelseas with Allison Anders & Corey Oglesby'
UPDATE public.events SET title = 'The Chelseas with Allison Anders & Corey Oglesby' WHERE title = 'The Chelseas with Allison Anders &#038; Corey Oglesby';
-- Fix: 'Jon &#038; Rand Band' -> 'Jon & Rand Band'
UPDATE public.events SET title = 'Jon & Rand Band' WHERE title = 'Jon &#038; Rand Band';
-- Fix: 'Backstage New Year&#8217;s Eve Party' -> "Backstage New Year's Eve Party"
UPDATE public.events SET title = 'Backstage New Year''s Eve Party' WHERE title = 'Backstage New Year&#8217;s Eve Party';
-- Fix: 'Bishop Place Senior Living: Aging in Confidence &#8211; Session 2' -> 'Bishop Place Senior Living: Aging in Confidence - Session 2'
UPDATE public.events SET title = 'Bishop Place Senior Living: Aging in Confidence - Session 2' WHERE title = 'Bishop Place Senior Living: Aging in Confidence &#8211; Session 2';
-- Fix: 'Bishop Place Senior Living: Aging in Confidence &#8211; Session 1' -> 'Bishop Place Senior Living: Aging in Confidence - Session 1'
UPDATE public.events SET title = 'Bishop Place Senior Living: Aging in Confidence - Session 1' WHERE title = 'Bishop Place Senior Living: Aging in Confidence &#8211; Session 1';
-- Fix: 'UIdaho Esports: Mario Kart 8 &#038; Super Smash Bros. Ultimate Tournament' -> 'UIdaho Esports: Mario Kart 8 & Super Smash Bros. Ultimate Tournament'
UPDATE public.events SET title = 'UIdaho Esports: Mario Kart 8 & Super Smash Bros. Ultimate Tournament' WHERE title = 'UIdaho Esports: Mario Kart 8 &#038; Super Smash Bros. Ultimate Tournament';
-- Fix: 'Eilen Jewell with Charlie &#038; The Changelings' -> 'Eilen Jewell with Charlie & The Changelings'
UPDATE public.events SET title = 'Eilen Jewell with Charlie & The Changelings' WHERE title = 'Eilen Jewell with Charlie &#038; The Changelings';
-- Fix: 'Moscow&#8217;s Music &#038; More Showcase' -> "Moscow's Music & More Showcase"
UPDATE public.events SET title = 'Moscow''s Music & More Showcase' WHERE title = 'Moscow&#8217;s Music &#038; More Showcase';
-- Fix: 'Open Mic, Music &#038; More Showcase' -> 'Open Mic, Music & More Showcase'
UPDATE public.events SET title = 'Open Mic, Music & More Showcase' WHERE title = 'Open Mic, Music &#038; More Showcase';
-- Fix: 'Vandal Entertainment ~ Anthem &#038; Aria: Seance' -> 'Vandal Entertainment ~ Anthem & Aria: Seance'
UPDATE public.events SET title = 'Vandal Entertainment ~ Anthem & Aria: Seance' WHERE title = 'Vandal Entertainment ~ Anthem &#038; Aria: Seance';
-- Fix: 'Blaine Andrew Ross &#038; the Contraband Cowboys + Will Fontaine Band' -> 'Blaine Andrew Ross & the Contraband Cowboys + Will Fontaine Band'
UPDATE public.events SET title = 'Blaine Andrew Ross & the Contraband Cowboys + Will Fontaine Band' WHERE title = 'Blaine Andrew Ross &#038; the Contraband Cowboys + Will Fontaine Band';
-- Fix: 'Community Event: A Love Letter to Librarians, Libraries &#038; Literature' -> 'Community Event: A Love Letter to Librarians, Libraries & Literature'
UPDATE public.events SET title = 'Community Event: A Love Letter to Librarians, Libraries & Literature' WHERE title = 'Community Event: A Love Letter to Librarians, Libraries &#038; Literature';
-- Fix: 'BookPeople: Eija Sumner | The Good Little Mermaid&#8217;s Guide to Bedtime' -> "BookPeople: Eija Sumner | The Good Little Mermaid's Guide to Bedtime"
UPDATE public.events SET title = 'BookPeople: Eija Sumner | The Good Little Mermaid''s Guide to Bedtime' WHERE title = 'BookPeople: Eija Sumner | The Good Little Mermaid&#8217;s Guide to Bedtime';
-- Fix: 'Tom&#8217;s Elton Tribute' -> "Tom's Elton Tribute"
UPDATE public.events SET title = 'Tom''s Elton Tribute' WHERE title = 'Tom&#8217;s Elton Tribute';
-- Fix: 'Backstage Music: The Chelseas &#038; Will Fontaine' -> 'Backstage Music: The Chelseas & Will Fontaine'
UPDATE public.events SET title = 'Backstage Music: The Chelseas & Will Fontaine' WHERE title = 'Backstage Music: The Chelseas &#038; Will Fontaine';
-- Fix: 'Closed for New Year&#8217;s Day' -> "Closed for New Year's Day"
UPDATE public.events SET title = 'Closed for New Year''s Day' WHERE title = 'Closed for New Year&#8217;s Day';
-- Fix: 'Palouse Land Trust Benefit Concert: Charlie Sutton &#038; The Changelings' -> 'Palouse Land Trust Benefit Concert: Charlie Sutton & The Changelings'
UPDATE public.events SET title = 'Palouse Land Trust Benefit Concert: Charlie Sutton & The Changelings' WHERE title = 'Palouse Land Trust Benefit Concert: Charlie Sutton &#038; The Changelings';
-- Fix: 'Innovia Foundation: Curious Conversations with Mónica Guzmán &#038; Erin Jones' -> 'Innovia Foundation: Curious Conversations with Mónica Guzmán & Erin Jones'
UPDATE public.events SET title = 'Innovia Foundation: Curious Conversations with Mónica Guzmán & Erin Jones' WHERE title = 'Innovia Foundation: Curious Conversations with Mónica Guzmán &#038; Erin Jones';
-- Fix: 'DJ Dave&#8217;s Backstage Mix' -> "DJ Dave's Backstage Mix"
UPDATE public.events SET title = 'DJ Dave''s Backstage Mix' WHERE title = 'DJ Dave&#8217;s Backstage Mix';
-- Fix: 'Backstage with the Band &#8211; A Kenworthy Benefit Concert' -> 'Backstage with the Band - A Kenworthy Benefit Concert'
UPDATE public.events SET title = 'Backstage with the Band - A Kenworthy Benefit Concert' WHERE title = 'Backstage with the Band &#8211; A Kenworthy Benefit Concert';
-- Fix: 'Heart of the Arts Forum &#038; Productions &#8211; Community Showcase' -> 'Heart of the Arts Forum & Productions - Community Showcase'
UPDATE public.events SET title = 'Heart of the Arts Forum & Productions - Community Showcase' WHERE title = 'Heart of the Arts Forum &#038; Productions &#8211; Community Showcase';
-- Fix: 'Book People Presents &#8220;Navigating Elder Care: Julia Parker in Conversation with Carol Price&#8221;' -> 'Book People Presents "Navigating Elder Care: Julia Parker in Conversation with Carol Price"'
UPDATE public.events SET title = 'Book People Presents "Navigating Elder Care: Julia Parker in Conversation with Carol Price"' WHERE title = 'Book People Presents &#8220;Navigating Elder Care: Julia Parker in Conversation with Carol Price&#8221;';
-- Fix: 'Book People of Moscow Present: Robert Wrigley&#8217;s &#8220;The True Account of Myself as a Bird&#8221;' -> 'Book People of Moscow Present: Robert Wrigley\'s "The True Account of Myself as a Bird"'
UPDATE public.events SET title = 'Book People of Moscow Present: Robert Wrigley''s "The True Account of Myself as a Bird"' WHERE title = 'Book People of Moscow Present: Robert Wrigley&#8217;s &#8220;The True Account of Myself as a Bird&#8221;';
-- Fix: 'LCHS: How It&#8217;s Going, How It Started' -> "LCHS: How It's Going, How It Started"
UPDATE public.events SET title = 'LCHS: How It''s Going, How It Started' WHERE title = 'LCHS: How It&#8217;s Going, How It Started';
-- Fix: '&#8220;Picture a Scientist&#8221; Documentary' -> '"Picture a Scientist" Documentary'
UPDATE public.events SET title = '"Picture a Scientist" Documentary' WHERE title = '&#8220;Picture a Scientist&#8221; Documentary';
-- Fix: 'It&#8217;s a Wonderful Life (PG)' -> "It's a Wonderful Life (PG)"
UPDATE public.events SET title = 'It''s a Wonderful Life (PG)' WHERE title = 'It&#8217;s a Wonderful Life (PG)';
-- Fix: 'How It&#8217;s Going, How It Started' -> "How It's Going, How It Started"
UPDATE public.events SET title = 'How It''s Going, How It Started' WHERE title = 'How It&#8217;s Going, How It Started';
-- Fix: 'Book People presents DJ Lee &#038; Tina Ontiveros' -> 'Book People presents DJ Lee & Tina Ontiveros'
UPDATE public.events SET title = 'Book People presents DJ Lee & Tina Ontiveros' WHERE title = 'Book People presents DJ Lee &#038; Tina Ontiveros';
-- Fix: 'Book People presents Trevor Bond&#8217;s &#8220;Coming Home to Nez Perce Country&#8221;' -> 'Book People presents Trevor Bond\'s "Coming Home to Nez Perce Country"'
UPDATE public.events SET title = 'Book People presents Trevor Bond''s "Coming Home to Nez Perce Country"' WHERE title = 'Book People presents Trevor Bond&#8217;s &#8220;Coming Home to Nez Perce Country&#8221;';

-- ── ADD SHOWINGS FOR LIVE EVENTS ───────────────────────────

-- "Picture a Scientist" Documentary (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = '"Picture a Scientist" Documentary' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-02-24 18:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-02-24 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-02-24 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- A Reading by Distinguished Visiting Writer William Logan (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'A Reading by Distinguished Visiting Writer William Logan' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-27 07:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-27 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-27 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: A Theatre Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'APOD Productions: A Theatre Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-01-20 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-01-20 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-01-20 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Annette Bay Pimentel | Before Music (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Annette Bay Pimentel | Before Music' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-25 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-25 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-25 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Art Walk: Common Tone (Live Performance) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Art Walk: Common Tone (Live Performance)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-16 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-16 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-16 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Art Walk: Moscow Film Society (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Art Walk: Moscow Film Society' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-19 16:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Burlesque (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Burlesque' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-12-14 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-14 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-14 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Dance Party (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Dance Party' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-07-15 21:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-07-15 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-07-15 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Dance Party: Mosaic of Sound (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Dance Party: Mosaic of Sound' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-05-13 21:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-05-13 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-05-13 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Gente Boa (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Gente Boa' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-08-23 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Green Flannel + Earthworks + Minot (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Green Flannel + Earthworks + Minot' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-05-19 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-05-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-05-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Himalayan Duo (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Himalayan Duo' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-02-10 20:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-02-10 20:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-02-10 20:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Itchy Kitty / Ideomotor / The Himbos (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Itchy Kitty / Ideomotor / The Himbos' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-03-02 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-03-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-03-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Jazz Fest Afterparty (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Jazz Fest Afterparty' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-04-17 22:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-04-17 22:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-04-17 22:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Mars Child (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Mars Child' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-04-26 22:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-04-26 22:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-04-26 22:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Plaid Raptor + Green Flannel (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Plaid Raptor + Green Flannel' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-11-18 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-11-18 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-11-18 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: Plaid Raptor Vinyl Release Party (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: Plaid Raptor Vinyl Release Party' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-10-20 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: The Chelseas & Will Fontaine (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: The Chelseas & Will Fontaine' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-01-12 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-01-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-01-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: The Widow Cameron + Bill Tracy (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Music: The Widow Cameron + Bill Tracy' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-02-07 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-02-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-02-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage New Year's Eve Party (4 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage New Year''s Eve Party' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-12-31 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-12-31 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2023-12-31 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-12-31 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Pride (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Pride' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-06-24 22:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-06-24 22:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-06-24 22:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Sessions: MPQT with Kate Skinner (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Sessions: MPQT with Kate Skinner' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-06-03 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-03 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-03 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Sessions: Palouse Forro (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Sessions: Palouse Forro' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-07-12 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-07-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-07-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Sessions: Surf Green Machine + Maryhill + Paul Arbor (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Sessions: Surf Green Machine + Maryhill + Paul Arbor' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-08 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Stories (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Stories' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- Showing: 2026-08-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-08-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-08-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2026-06-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Stories: Love Is a Battlefield (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Stories: Love Is a Battlefield' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-02-15 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-02-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-02-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Stories: Origin Stories (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage Stories: Origin Stories' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-29 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage with the Band - A Kenworthy Benefit Concert (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Backstage with the Band - A Kenworthy Benefit Concert' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-10-01 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-10-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 50.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-10-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bans Off Moscow: Diva Night (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Bans Off Moscow: Diva Night' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-06-27 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-06-29 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-06-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-06-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Beyond the Deep: A Look at What It Took to Swim the English Channel (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Beyond the Deep: A Look at What It Took to Swim the English Channel' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-10-26 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-10-26 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-10-26 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bingo Night at the 1912 Center (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Bingo Night at the 1912 Center' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-07-27 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-07-27 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-07-27 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bishop Place Senior Living Community Event (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Bishop Place Senior Living Community Event' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-18 17:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-18 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-18 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bishop Place Senior Living: Aging in Confidence - Session 1 (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Bishop Place Senior Living: Aging in Confidence - Session 1' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-10-20 17:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-10-20 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-10-20 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bishop Place Senior Living: Aging in Confidence - Session 2 (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Bishop Place Senior Living: Aging in Confidence - Session 2' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-10-27 17:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-10-27 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-10-27 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Black History Month: Creating an Environment where Black people can Flourish and Thrive (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Black History Month: Creating an Environment where Black people can Flourish and Thrive' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-02-04 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-02-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-02-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Blaine Andrew Ross & the Contraband Cowboys + Will Fontaine Band (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Blaine Andrew Ross & the Contraband Cowboys + Will Fontaine Band' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-08-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-08-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-08-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People Presents "Navigating Elder Care: Julia Parker in Conversation with Carol Price" (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People Presents "Navigating Elder Care: Julia Parker in Conversation with Carol Price"' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-13 07:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-13 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-13 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People Presents: Adam Sowards (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People Presents: Adam Sowards' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-04 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People Presents: Eija Sumner (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People Presents: Eija Sumner' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-03-05 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-03-05 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-03-05 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People Presents: Women Who Misbehave (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People Presents: Women Who Misbehave' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-20 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People of Moscow Present: Robert Wrigley's "The True Account of Myself as a Bird" (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People of Moscow Present: Robert Wrigley''s "The True Account of Myself as a Bird"' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-08 07:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-08 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-08 07:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People presents Annette Pimentel (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People presents Annette Pimentel' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-09-11 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-11 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-11 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People presents DJ Lee & Tina Ontiveros (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People presents DJ Lee & Tina Ontiveros' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-13 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Book People presents Trevor Bond's "Coming Home to Nez Perce Country" (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Book People presents Trevor Bond''s "Coming Home to Nez Perce Country"' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-09-15 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Book Launch with Buddy Levy | Realm of Ice and Sky (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Book Launch with Buddy Levy | Realm of Ice and Sky' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-02-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-02-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-02-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Buddy Levy | Empire of Ice and Stone (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Buddy Levy | Empire of Ice and Stone' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-07 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Eija Sumner | The Good Little Mermaid's Guide to Bedtime (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Eija Sumner | The Good Little Mermaid''s Guide to Bedtime' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-03-23 14:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-03-23 14:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-03-23 14:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Ice Age Floodscapes | Bruce Bjornstad (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Ice Age Floodscapes | Bruce Bjornstad' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-05-17 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-05-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-05-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Jess Walter | The Angel of Rome and Other Stories (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Jess Walter | The Angel of Rome and Other Stories' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-08-31 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Mary Clearman Blew | Think of Horses (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'BookPeople: Mary Clearman Blew | Think of Horses' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-11-15 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-11-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-11-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Boundless Live with Ben Greenfield (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Boundless Live with Ben Greenfield' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-07-31 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-07-31 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-07-31 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- CLOSED (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'CLOSED' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-09-06 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-07-04 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-07-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-07-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cameroon vs Brazil (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Cameroon vs Brazil' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-02 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-02 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-02 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Candyman (R) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Candyman (R)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-11-27 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-11-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-11-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-12-25 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Christmas (3 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for Christmas' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-12-24 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-12-24 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2023-12-24 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Cleaning (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for Cleaning' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-12-30 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-12-30 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-12-30 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Holiday Break (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for Holiday Break' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-24 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for New Year's Day (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for New Year''s Day' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-01-01 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-01-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-01-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Renovations (4 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for Renovations' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-07-27 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-07-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-07-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2026-06-29 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2026-05-10 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-07-14 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-07-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-07-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Thanksgiving (3 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Closed for Thanksgiving' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-11-27 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-11-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-11-27 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2023-11-23 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-11-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-11-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-11-24 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-11-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-11-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Common Tone Arts: The Sound Ensemble and the Northwest Edvard Grieg Society (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Common Tone Arts: The Sound Ensemble and the Northwest Edvard Grieg Society' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-06-08 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-06-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-06-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Community Event: A Love Letter to Librarians, Libraries & Literature (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Community Event: A Love Letter to Librarians, Libraries & Literature' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-07-01 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-07-01 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-07-01 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cruella (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Cruella' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-07-08 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-07-08 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-07-08 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- DJ Dave's Backstage Mix (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'DJ Dave''s Backstage Mix' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-03-11 21:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-03-11 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-03-11 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2023-02-04 21:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-02-04 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-02-04 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Daytime Private Event (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Daytime Private Event' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-08-16 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-08-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-08-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Dune (PG-13) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Dune (PG-13)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-11-19 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-19 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-19 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Eilen Jewell with Charlie & The Changelings (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Eilen Jewell with Charlie & The Changelings' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-02 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Election Day (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Election Day' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-11-08 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-11-08 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-11-08 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Enhanced Harmony (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Enhanced Harmony' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-01-13 12:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-01-13 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-01-13 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Everdream: A Celtic Christmas (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Everdream: A Celtic Christmas' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-12-13 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 32.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2023-12-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-12-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 32.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-12-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Fall Banquet: A Night with the Stars (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Fall Banquet: A Night with the Stars' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-09-27 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-09-27 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-09-27 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Fall Banquet: Backstage Dinner with Cellar Door (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Fall Banquet: Backstage Dinner with Cellar Door' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-10-06 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-10-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 100.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-10-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Festival Dance: Jesús Muñoz Flamenco (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Festival Dance: Jesús Muñoz Flamenco' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-26 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-26 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-26 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Festival Dance: Quiero Flamenco (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Festival Dance: Quiero Flamenco' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-05-19 15:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-05-19 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-05-19 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Finals (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Finals' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-18 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-18 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-18 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Gem State Flyers: Love at First Flight (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Gem State Flyers: Love at First Flight' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-02-15 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-02-15 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-02-15 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Gem State Flyers: Trick or Tease (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Gem State Flyers: Trick or Tease' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-10-17 18:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-10-17 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-10-17 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Germany vs Costa Rica (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Germany vs Costa Rica' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-01 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-01 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-01 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Giant Palouse Earthworm: Academy Order + Wallower + Casual Violence (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Giant Palouse Earthworm: Academy Order + Wallower + Casual Violence' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-04-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-04-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-04-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Giant Palouse Earthworm: Dancing Plague + Skerries (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Giant Palouse Earthworm: Dancing Plague + Skerries' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-10-06 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-06 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-06 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Giant Palouse Earthworm: Dry Wedding + Wallower + Csikos (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Giant Palouse Earthworm: Dry Wedding + Wallower + Csikos' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-05-24 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-05-24 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-05-24 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet ~ Swan Lake: Symphony of Lights (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet ~ Swan Lake: Symphony of Lights' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- Showing: 2026-10-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet ~ The Nutcracker: Symphony of Lights (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet ~ The Nutcracker: Symphony of Lights' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- Showing: 2026-12-20 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-12-20 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-12-20 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet: Don Quixote (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet: Don Quixote' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-10-07 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet: Nutcracker (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet: Nutcracker' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-12-23 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet: Snow White (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet: Snow White' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-02-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-02-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-02-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet: Swan Lake (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Grand Kyiv Ballet: Swan Lake' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-09-22 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-09-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-09-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-02-20 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-02-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-02-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Groove for Good (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Groove for Good' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-07 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-07 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-07 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Happy Birthday Buildings! (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Happy Birthday Buildings!' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-06-06 11:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-06 11:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-06 11:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Heart of the Arts Forum & Productions - Community Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Heart of the Arts Forum & Productions - Community Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-07-18 17:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-07-18 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-07-18 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- How It's Going, How It Started (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'How It''s Going, How It Started' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-14 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- In the Heights (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'In the Heights' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-07-15 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-07-15 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-07-15 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Inland Harmony Chorus: Holiday Harmony (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Inland Harmony Chorus: Holiday Harmony' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Inland North Waste Movie Night (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Inland North Waste Movie Night' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-19 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Inland North Waste Presents: Kiss the Ground (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Inland North Waste Presents: Kiss the Ground' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-21 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Inland North Waste and Palouse Cult Film Revival Present: This is Spinal Tap (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Inland North Waste and Palouse Cult Film Revival Present: This is Spinal Tap' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Inland Northwest Magic: Stardust (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Inland Northwest Magic: Stardust' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-13 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 22.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Innovia Foundation: Curious Conversations with Mónica Guzmán & Erin Jones (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Innovia Foundation: Curious Conversations with Mónica Guzmán & Erin Jones' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-05-31 18:15:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-05-31 18:15:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-05-31 18:15:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- It's a Wonderful Life (PG) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'It''s a Wonderful Life (PG)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-12-16 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Izzy Burns + The Hipocrats (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Izzy Burns + The Hipocrats' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-07-17 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-07-17 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-07-17 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Jon & Rand Band (3 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Jon & Rand Band' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-01-15 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-01-24 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-01-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-01-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-03-01 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-03-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-03-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Josh Ritter (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Josh Ritter' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-10-12 15:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-10-12 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 35.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-10-12 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Just Hit Post (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Just Hit Post' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-24 09:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-24 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 97.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-24 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- King of Cowtown Tour: William Lee Martin (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'King of Cowtown Tour: William Lee Martin' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-08-02 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-08-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-08-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Kino Short Film Festival (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Kino Short Film Festival' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-29 18:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-29 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-29 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- LCHS: How It's Going, How It Started (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'LCHS: How It''s Going, How It Started' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-03-22 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-03-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-03-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-02-17 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-02-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-02-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Latah County Historical Society: Robinson Unboxing Event (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Latah County Historical Society: Robinson Unboxing Event' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-10-23 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-10-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-10-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Learning To Live By Our Family Mottos: One-act plays written and performed by Palouse Prairie Charter School fourth-grade crew (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Learning To Live By Our Family Mottos: One-act plays written and performed by Palouse Prairie Charter School fourth-grade crew' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-01 18:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-01 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-01 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Lena Whitmore Elementary School: Third Grade Film Festival (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Lena Whitmore Elementary School: Third Grade Film Festival' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-07 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-07 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-07 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Locals Only Comedy (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Locals Only Comedy' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-06-26 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-26 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-26 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- LunaFest: Short Films by Independent Women Filmmakers (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'LunaFest: Short Films by Independent Women Filmmakers' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-03-01 17:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-03-01 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-03-01 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MCT Presents: Sally Cotter and the Censored Stone (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'MCT Presents: Sally Cotter and the Censored Stone' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-01 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-01 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-01 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MCT Rehearsal (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'MCT Rehearsal' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-03-26 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-03-26 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-03-26 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Carmen (2010) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'MET Live in HD: Carmen (2010)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-07-21 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-07-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-07-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Madeline Hawthorne (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Madeline Hawthorne' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-03-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-03-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-03-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Madeline Hawthorne with Izzy Burns (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Madeline Hawthorne with Izzy Burns' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-07-12 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-07-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-07-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Mama Bears (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Mama Bears' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-06-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Mario Kart 8 Deluxe Tournament (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Mario Kart 8 Deluxe Tournament' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-11-19 16:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-11-19 16:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-11-19 16:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Mason Oyler Big Band (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Mason Oyler Big Band' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-17 17:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-17 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-17 17:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Mason Oyler Jazz Orchestra (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Mason Oyler Jazz Orchestra' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-17 16:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-17 16:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-17 16:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-12-20 15:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-12-20 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-12-20 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Chamber of Commerce: Primary Candidate Forum (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Chamber of Commerce: Primary Candidate Forum' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-21 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-21 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-21 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Chamber of Commerce: State of the State Address Viewing Party (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Chamber of Commerce: State of the State Address Viewing Party' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-01-09 12:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-01-09 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-01-09 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Charter School: The Sound of Music (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Charter School: The Sound of Music' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-14 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-14 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-14 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-09-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-09-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-09-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-09-08 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-09-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-09-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: CP + Sarah Lawrence (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: CP + Sarah Lawrence' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-31 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 35.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Cory Michaelis + Simon King (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Cory Michaelis + Simon King' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Jackie Kashian + Alvin Williams (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Jackie Kashian + Alvin Williams' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-09-06 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-09-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-09-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: John Roy + Alvin Williams (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: John Roy + Alvin Williams' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-29 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Key Lewis + Brandon Vestal (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Key Lewis + Brandon Vestal' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-09-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-09-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-09-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Lara Beitz + Tom Dustin (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Lara Beitz + Tom Dustin' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-05-29 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Rob Haze + Aaron Woodall (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Rob Haze + Aaron Woodall' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-09-07 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-09-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 35.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-09-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Ron G + Jen Adams (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Ron G + Jen Adams' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 35.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest: Tyler Boeh + Jeanne Whitney (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Comedy Fest: Tyler Boeh + Jeanne Whitney' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre presents The Nerd (4 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Community Theatre presents The Nerd' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-11-14 14:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-14 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-14 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-11-07 14:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-07 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-07 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-11-12 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-11-05 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Film Society: Carrie (1976) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Film Society: Carrie (1976)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-07-06 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Human Rights Commission Presents: Bamboo and Barbed Wire (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Human Rights Commission Presents: Bamboo and Barbed Wire' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-06 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-06 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-06 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Music & More Showcase (9 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Music & More Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-08-03 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-08-03 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-08-03 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2026-03-17 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-03-17 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-03-17 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2026-01-06 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-01-06 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-01-06 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-11-25 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-11-25 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-11-25 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-09-30 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-09-30 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-09-30 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-08-19 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-08-19 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-08-19 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-07-01 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-07-01 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-07-01 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-05-12 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-05-12 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-05-12 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-03-11 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-03-11 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-03-11 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Music Academy Student Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Music Academy Student Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-22 12:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-22 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-22 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Realty presents The Polar Express (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow Realty presents The Polar Express' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-12-04 16:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-04 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-04 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow's Music & More Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Moscow''s Music & More Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-01-21 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-01-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-01-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Nimiipuu Protecting The Environment: The Grand Salmon (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Nimiipuu Protecting The Environment: The Grand Salmon' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-11-22 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-11-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-11-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Open Mic Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Open Mic Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-07-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-07-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-07-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Open Mic, Music & More Showcase (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Open Mic, Music & More Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-12-10 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-12-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-12-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2024-10-01 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Watch Party (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Oscars Watch Party' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-03-15 17:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-03-15 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-03-15 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse Forro (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse Forro' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-07-21 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-07-21 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-07-21 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse French Film Festival: Au nom de la terre (In the Name of the Land) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse French Film Festival: Au nom de la terre (In the Name of the Land)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-12 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse French Film Festival: Grâce à Dieu (By the Grace of God) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse French Film Festival: Grâce à Dieu (By the Grace of God)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-19 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse French Film Festival: La Daronne (Mama Weed) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse French Film Festival: La Daronne (Mama Weed)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-26 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse French Film Festival: Le retour du héros / Return of the Hero (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse French Film Festival: Le retour du héros / Return of the Hero' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-10-05 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse Land Trust Benefit Concert: Charlie Sutton & The Changelings (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Palouse Land Trust Benefit Concert: Charlie Sutton & The Changelings' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-07-20 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Passing (PG-13) (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Passing (PG-13)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-12-05 16:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-12-03 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Petals and Pasties (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Petals and Pasties' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-09 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Pigs on the Wing: The Dark Side of the Moon 2022 (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Pigs on the Wing: The Dark Side of the Moon 2022' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-10-15 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-10-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 30.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-10-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Proposition 1: A Community Conversation (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Proposition 1: A Community Conversation' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-09-30 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-09-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-09-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Punk Palouse Fest (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Punk Palouse Fest' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-24 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-24 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 60.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-24 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Punk Palouse: Nothing Good Quartet (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Punk Palouse: Nothing Good Quartet' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-19 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-19 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-19 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Punk Palouse: The Alex Aguilar Sextet (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Punk Palouse: The Alex Aguilar Sextet' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-03-23 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-03-23 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-03-23 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Puppeteers for Fears ~ Robopocalypse: The Musical (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Puppeteers for Fears ~ Robopocalypse: The Musical' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-08-03 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-08-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-08-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Quarterfinals (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Quarterfinals' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-09 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-09 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-09 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Remi Goode Duo / Owen McGreevy (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Remi Goode Duo / Owen McGreevy' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-07-19 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-07-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-07-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Rendezvous Kick-off Show (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Rendezvous Kick-off Show' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-07-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-07-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-07-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Rendezvous in the Park Showcase (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Rendezvous in the Park Showcase' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-03-22 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-03-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-03-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- RepublicEn: Conservative and Care About Climate Change? (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'RepublicEn: Conservative and Care About Climate Change?' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-04-08 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-04-08 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-04-08 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Reserved for Event (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Reserved for Event' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-09-23 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2021-09-14 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Road to Rendezvous (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Road to Rendezvous' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-03-28 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-03-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-03-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Round of 16 (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Round of 16' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-06 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-06 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-06 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-12-05 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-05 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-05 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- San Francisco Scottish Fiddlers (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'San Francisco Scottish Fiddlers' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-08-02 15:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-08-02 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-08-02 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Second Annual Fall48 Film Festival (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Second Annual Fall48 Film Festival' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-12-01 18:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-01 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-01 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Semifinals (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Semifinals' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-12-14 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-14 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-14 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2022-12-13 11:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-12-13 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-12-13 11:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Shared Legacies (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Shared Legacies' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-09-30 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-09-30 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-09-30 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Showtune Karaoke Showdown Fundraiser at Forty Two Bar (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Showtune Karaoke Showdown Fundraiser at Forty Two Bar' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-08 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-08 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-08 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Spencer (R) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Spencer (R)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-12-09 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-12-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-12-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Tango Del Cielo (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Tango Del Cielo' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2023-05-21 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2023-05-21 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2023-05-21 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Terry Buffington Foundation: Fundraising Gala (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Terry Buffington Foundation: Fundraising Gala' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-11-01 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-11-01 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-11-01 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Bee Gees Tribute: You Should Be Dancing (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Bee Gees Tribute: You Should Be Dancing' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-22 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-22 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 50.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-22 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Chelseas + The Moscow Mules (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Chelseas + The Moscow Mules' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-11-21 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-11-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-11-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Chelseas with Allison Anders & Corey Oglesby (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Chelseas with Allison Anders & Corey Oglesby' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-01-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-01-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-01-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The French Dispatch (R) (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The French Dispatch (R)' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-11-26 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-11-26 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-11-26 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Moscow Chamber of Commerce and PCFR Present: Troop Beverly Hills (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Moscow Chamber of Commerce and PCFR Present: Troop Beverly Hills' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-24 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-24 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-24 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Senders (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Senders' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-05-16 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-05-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-05-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Widow Cameron with Allison Curet + Corey Oglesby (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'The Widow Cameron with Allison Curet + Corey Oglesby' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-01-31 20:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-01-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-01-31 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Tom's Elton Tribute (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Tom''s Elton Tribute' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-07-10 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-07-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-07-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Top Gun (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Top Gun' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2021-07-02 08:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2021-07-02 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2021-07-02 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Trilingual Reading: An Evening with Shawn Vestal, Domenico Müllensiefen and Hemil Garcia Linares (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Trilingual Reading: An Evening with Shawn Vestal, Domenico Müllensiefen and Hemil Garcia Linares' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-10-20 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-10-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-10-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UI Department of History: Crossing Boundaries (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'UI Department of History: Crossing Boundaries' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-11-18 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-11-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-11-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UI Pollinator Conference (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'UI Pollinator Conference' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-02-23 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-02-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-02-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UI VTD Event (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'UI VTD Event' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-05-10 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-05-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-05-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UI: Fish and Wildlife Film Festival (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'UI: Fish and Wildlife Film Festival' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-22 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-22 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-22 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UIdaho Esports: Mario Kart 8 & Super Smash Bros. Ultimate Tournament (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'UIdaho Esports: Mario Kart 8 & Super Smash Bros. Ultimate Tournament' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2025-04-12 12:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-04-12 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-04-12 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-01-18 13:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-01-18 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-01-18 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Ukrainian Cinema Night (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Ukrainian Cinema Night' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-04-16 18:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-04-16 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-04-16 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Urban Bush Women: This Is Risk (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Urban Bush Women: This Is Risk' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-02-13 19:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-02-13 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-02-13 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Vandal Entertainment ~ Anthem & Aria: Seance (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Vandal Entertainment ~ Anthem & Aria: Seance' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-10-17 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Vandal Entertainment: Sailesh the Hypnotist (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Vandal Entertainment: Sailesh the Hypnotist' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-05-03 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-05-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-05-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Veterans for Idaho Voters: Majority Rules (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Veterans for Idaho Voters: Majority Rules' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2024-10-24 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2024-10-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2024-10-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- WSU Association of Faculty Women (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'WSU Association of Faculty Women' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2022-02-26 09:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2022-02-26 09:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2022-02-26 09:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Washington Idaho Symphony ~ Voices of the East: Prokofiev & Tchaikovsky (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Washington Idaho Symphony ~ Voices of the East: Prokofiev & Tchaikovsky' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-03-01 15:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-03-01 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 27.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-03-01 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Wild Rumours: A Fleetwood Mac Experience (2 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'Wild Rumours: A Fleetwood Mac Experience' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-06-25 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-06-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-06-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    -- [PAST] Showing: 2025-09-04 19:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2025-09-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2025-09-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- William Lee Martin: Seemed Smart at the Time Tour (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'William Lee Martin: Seemed Smart at the Time Tour' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- Showing: 2026-10-17 15:30:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-10-17 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-10-17 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- World Cup Final (1 showing(s))
DO $$
DECLARE v_event_id UUID;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title = 'World Cup Final' LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    -- [PAST] Showing: 2026-07-19 12:00:00
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_event_id, '2026-07-19 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_event_id AND start_time = '2026-07-19 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

