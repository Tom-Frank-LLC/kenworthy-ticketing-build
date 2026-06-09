ALTER TABLE public.seats ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'center';
ALTER TABLE public.venue_seats ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'center';

DELETE FROM public.tickets WHERE seat_id IS NOT NULL;
DELETE FROM public.seats;
DELETE FROM public.venue_seats WHERE venue_id IN (SELECT id FROM public.venues WHERE name = 'Main Theater');

INSERT INTO public.seats (seat_row, seat_number, seat_type, section) VALUES
('L',1,'standard','left'),('L',2,'standard','left'),
('K',1,'standard','left'),('K',2,'standard','left'),('K',4,'standard','left'),('K',5,'standard','left'),('K',6,'standard','left'),('K',7,'standard','left'),
('J',1,'standard','left'),('J',2,'standard','left'),('J',3,'standard','left'),('J',5,'standard','left'),('J',6,'standard','left'),('J',7,'standard','left'),
('I',1,'standard','left'),('I',2,'standard','left'),('I',4,'standard','left'),('I',5,'standard','left'),('I',6,'standard','left'),('I',7,'standard','left'),
('H',1,'standard','left'),('H',2,'standard','left'),('H',3,'standard','left'),('H',4,'standard','left'),('H',6,'standard','left'),('H',7,'standard','left'),
('G',1,'standard','left'),('G',2,'standard','left'),('G',3,'standard','left'),('G',5,'standard','left'),('G',6,'standard','left'),('G',7,'standard','left'),
('F',1,'standard','left'),('F',2,'standard','left'),('F',4,'standard','left'),('F',5,'standard','left'),('F',6,'standard','left'),('F',7,'standard','left'),
('E',1,'standard','left'),('E',2,'standard','left'),('E',3,'standard','left'),('E',4,'standard','left'),('E',6,'standard','left'),('E',7,'standard','left'),
('D',1,'standard','left'),('D',2,'standard','left'),('D',3,'standard','left'),('D',5,'standard','left'),('D',6,'standard','left'),('D',7,'standard','left'),
('C',1,'standard','left'),('C',2,'standard','left'),('C',4,'standard','left'),('C',5,'standard','left'),('C',6,'standard','left'),('C',7,'standard','left'),
('B',1,'standard','left'),('B',2,'standard','left'),('B',3,'standard','left'),('B',4,'standard','left'),('B',6,'standard','left'),('B',7,'standard','left'),
('A',1,'standard','left'),('A',2,'standard','left'),('A',3,'standard','left'),('A',4,'standard','left'),('A',5,'standard','left'),('A',6,'standard','left'),('A',7,'standard','left'),
('L',8,'standard','center'),('L',9,'standard','center'),('L',10,'standard','center'),('L',11,'standard','center'),('L',12,'standard','center'),('L',13,'standard','center'),('L',14,'standard','center'),('L',15,'standard','center'),('L',16,'standard','center'),('L',17,'standard','center'),('L',18,'standard','center'),('L',19,'standard','center'),
('K',8,'standard','center'),('K',9,'standard','center'),('K',10,'standard','center'),('K',12,'standard','center'),('K',13,'standard','center'),('K',14,'standard','center'),('K',15,'standard','center'),('K',17,'standard','center'),('K',18,'standard','center'),('K',19,'standard','center'),
('J',8,'standard','center'),('J',9,'standard','center'),('J',11,'standard','center'),('J',12,'standard','center'),('J',13,'standard','center'),('J',15,'standard','center'),('J',16,'standard','center'),('J',18,'standard','center'),('J',19,'standard','center'),
('I',8,'standard','center'),('I',9,'standard','center'),('I',10,'standard','center'),('I',11,'standard','center'),('I',13,'standard','center'),('I',14,'standard','center'),('I',16,'standard','center'),('I',17,'standard','center'),('I',18,'standard','center'),('I',19,'standard','center'),
('H',10,'standard','center'),('H',11,'standard','center'),('H',12,'standard','center'),('H',13,'standard','center'),('H',14,'standard','center'),('H',15,'standard','center'),('H',17,'standard','center'),('H',18,'standard','center'),('H',19,'standard','center'),
('G',8,'standard','center'),('G',9,'standard','center'),('G',10,'standard','center'),('G',11,'standard','center'),('G',13,'standard','center'),('G',14,'standard','center'),('G',16,'standard','center'),('G',17,'standard','center'),('G',18,'standard','center'),('G',19,'standard','center'),
('F',8,'standard','center'),('F',9,'standard','center'),('F',10,'standard','center'),('F',12,'standard','center'),('F',13,'standard','center'),('F',15,'standard','center'),('F',16,'standard','center'),('F',18,'standard','center'),('F',19,'standard','center'),
('E',8,'standard','center'),('E',9,'standard','center'),('E',11,'standard','center'),('E',12,'standard','center'),('E',13,'standard','center'),('E',14,'standard','center'),('E',16,'standard','center'),('E',17,'standard','center'),('E',18,'standard','center'),('E',19,'standard','center'),
('D',8,'standard','center'),('D',9,'standard','center'),('D',10,'standard','center'),('D',11,'standard','center'),('D',13,'standard','center'),('D',14,'standard','center'),('D',15,'standard','center'),('D',16,'standard','center'),('D',18,'standard','center'),('D',19,'standard','center'),
('C',8,'standard','center'),('C',9,'standard','center'),('C',10,'standard','center'),('C',12,'standard','center'),('C',13,'standard','center'),('C',14,'standard','center'),('C',15,'standard','center'),('C',17,'standard','center'),('C',18,'standard','center'),('C',19,'standard','center'),
('B',8,'standard','center'),('B',9,'standard','center'),('B',10,'standard','center'),('B',11,'standard','center'),('B',13,'standard','center'),('B',14,'standard','center'),('B',15,'standard','center'),('B',16,'standard','center'),('B',18,'standard','center'),('B',19,'standard','center'),
('A',8,'standard','center'),('A',9,'standard','center'),('A',10,'standard','center'),('A',11,'standard','center'),('A',12,'standard','center'),('A',13,'standard','center'),('A',14,'standard','center'),('A',15,'standard','center'),('A',16,'standard','center'),('A',17,'standard','center'),('A',18,'standard','center'),('A',19,'standard','center'),
('M',20,'standard','right'),('M',21,'standard','right'),('M',22,'standard','right'),('M',23,'standard','right'),
('L',21,'standard','right'),('L',22,'standard','right'),('L',23,'standard','right'),('L',24,'standard','right'),
('K',20,'standard','right'),('K',21,'standard','right'),('K',22,'standard','right'),('K',23,'standard','right'),('K',25,'standard','right'),('K',26,'standard','right'),
('J',20,'standard','right'),('J',21,'standard','right'),('J',22,'standard','right'),('J',24,'standard','right'),('J',25,'standard','right'),('J',26,'standard','right'),
('I',20,'standard','right'),('I',21,'standard','right'),('I',22,'standard','right'),('I',23,'standard','right'),('I',25,'standard','right'),('I',26,'standard','right'),
('H',20,'standard','right'),('H',21,'standard','right'),('H',23,'standard','right'),('H',24,'standard','right'),('H',25,'standard','right'),('H',26,'standard','right'),
('G',20,'standard','right'),('G',21,'standard','right'),('G',22,'standard','right'),('G',24,'standard','right'),('G',25,'standard','right'),('G',26,'standard','right'),
('F',20,'standard','right'),('F',21,'standard','right'),('F',22,'standard','right'),('F',23,'standard','right'),('F',25,'standard','right'),('F',26,'standard','right'),
('E',20,'standard','right'),('E',21,'standard','right'),('E',23,'standard','right'),('E',24,'standard','right'),('E',25,'standard','right'),('E',26,'standard','right'),
('D',20,'standard','right'),('D',21,'standard','right'),('D',22,'standard','right'),('D',24,'standard','right'),('D',25,'standard','right'),('D',26,'standard','right'),
('C',20,'standard','right'),('C',21,'standard','right'),('C',22,'standard','right'),('C',23,'standard','right'),('C',25,'standard','right'),('C',26,'standard','right'),
('B',20,'standard','right'),('B',21,'standard','right'),('B',23,'standard','right'),('B',24,'standard','right'),('B',25,'standard','right'),('B',26,'standard','right'),
('A',20,'standard','right'),('A',21,'standard','right'),('A',22,'standard','right'),('A',23,'standard','right'),('A',24,'standard','right'),('A',25,'standard','right'),('A',26,'standard','right');

INSERT INTO public.venue_seats (venue_id, seat_row, seat_number, seat_type, section)
SELECT v.id, s.seat_row, s.seat_number, s.seat_type, s.section
FROM public.seats s, public.venues v
WHERE v.name = 'Main Theater';

UPDATE public.venues SET total_seats = 265, has_assigned_seating = true WHERE name = 'Main Theater';

CREATE UNIQUE INDEX IF NOT EXISTS seats_row_number_section_key ON public.seats(seat_row, seat_number, section);