import { jsPDF } from 'jspdf';

export interface SponsorshipOpportunity {
  title: string;
  tagline?: string | null;
  intro_text?: string | null;
  hook_text?: string | null;
  cta_label?: string | null;
  section_heading?: string | null;
  section_body?: string | null;
  benefits?: { title: string; description: string }[];
  stats_text?: string | null;
  price_text?: string | null;
  availability_text?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

// Kenworthy palette converted from HSL tokens
const BLACK: [number, number, number] = [12, 10, 14];
const CREAM: [number, number, number] = [248, 244, 233];
const MAGENTA: [number, number, number] = [216, 47, 122];
const GOLD: [number, number, number] = [212, 169, 84];
const MUTED: [number, number, number] = [120, 115, 110];

export function generateSponsorshipPdf(opp: SponsorshipOpportunity): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 56;

  // ===== Page 1: Cover =====
  doc.setFillColor(...BLACK);
  doc.rect(0, 0, W, H, 'F');

  // Eyebrow brand block
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('KENWORTHY', MARGIN, 80, { charSpace: 4 });
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('PERFORMING ARTS CENTRE', MARGIN, 96, { charSpace: 3 });

  // Hairline
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 110, MARGIN + 60, 110);

  // Title
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(46);
  const titleLines = doc.splitTextToSize(opp.title.toUpperCase(), W - MARGIN * 2);
  doc.text(titleLines, MARGIN, 200);

  // Tagline
  if (opp.tagline) {
    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(16);
    const tagLines = doc.splitTextToSize(opp.tagline, W - MARGIN * 2);
    doc.text(tagLines, MARGIN, 200 + titleLines.length * 50);
  }

  // Intro
  let y = 360;
  if (opp.intro_text) {
    doc.setTextColor(...CREAM);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    const intro = doc.splitTextToSize(opp.intro_text, W - MARGIN * 2);
    doc.text(intro, MARGIN, y);
    y += intro.length * 16 + 20;
  }

  // Hook
  if (opp.hook_text) {
    doc.setTextColor(...MAGENTA);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    const hook = doc.splitTextToSize(opp.hook_text, W - MARGIN * 2);
    doc.text(hook, MARGIN, y);
    y += hook.length * 18 + 30;
  }

  // CTA pill
  if (opp.cta_label) {
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(1);
    const pillW = doc.getTextWidth(opp.cta_label.toUpperCase()) + 40;
    doc.roundedRect(MARGIN, y, pillW, 30, 15, 15, 'S');
    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${opp.cta_label.toUpperCase()}  →`, MARGIN + 20, y + 19, { charSpace: 2 });
  }

  // Footer contact
  const contactY = H - 70;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, contactY - 14, W - MARGIN, contactY - 14);
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const contactLine = [
    opp.contact_name ? `${opp.contact_name}${opp.contact_title ? `, ${opp.contact_title}` : ''}` : '',
    opp.contact_email || '',
    opp.contact_phone || '',
  ].filter(Boolean).join('  |  ');
  doc.text(contactLine, MARGIN, contactY);

  // ===== Page 2: Details =====
  doc.addPage();
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, W, H, 'F');

  let y2 = 80;

  if (opp.section_heading) {
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.text(opp.section_heading.toUpperCase(), MARGIN, y2);
    y2 += 20;
    doc.setDrawColor(...MAGENTA);
    doc.setLineWidth(2);
    doc.line(MARGIN, y2, MARGIN + 50, y2);
    y2 += 30;
  }

  if (opp.section_body) {
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const body = doc.splitTextToSize(opp.section_body, W - MARGIN * 2);
    doc.text(body, MARGIN, y2);
    y2 += body.length * 15 + 24;
  }

  // Benefits
  (opp.benefits || []).forEach((b) => {
    doc.setTextColor(...MAGENTA);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(b.title, MARGIN, y2);
    y2 += 16;
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const desc = doc.splitTextToSize(b.description, W - MARGIN * 2);
    doc.text(desc, MARGIN, y2);
    y2 += desc.length * 14 + 14;
  });

  // Stats callout
  if (opp.stats_text) {
    y2 += 6;
    doc.setFillColor(...BLACK);
    doc.rect(MARGIN, y2, W - MARGIN * 2, 60, 'F');
    doc.setTextColor(...CREAM);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    const stats = doc.splitTextToSize(opp.stats_text, W - MARGIN * 2 - 32);
    doc.text(stats, MARGIN + 16, y2 + 22);
    y2 += 80;
  }

  // Price headline
  if (opp.price_text) {
    doc.setTextColor(...MAGENTA);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    const price = doc.splitTextToSize(opp.price_text, W - MARGIN * 2);
    doc.text(price, MARGIN, y2);
    y2 += price.length * 20 + 14;
  }

  if (opp.availability_text) {
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const avail = doc.splitTextToSize(opp.availability_text, W - MARGIN * 2);
    doc.text(avail, MARGIN, y2);
    y2 += avail.length * 14 + 18;
  }

  // Contact card
  if (opp.contact_name || opp.contact_email) {
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y2, W - MARGIN, y2);
    y2 += 18;
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('TO SECURE YOUR SPONSORSHIP', MARGIN, y2, { charSpace: 2 });
    y2 += 16;
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(
      `${opp.contact_name || ''}${opp.contact_title ? `, ${opp.contact_title}` : ''}`,
      MARGIN,
      y2,
    );
    y2 += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    if (opp.contact_email) {
      doc.text(opp.contact_email, MARGIN, y2);
      y2 += 14;
    }
    if (opp.contact_phone) {
      doc.text(opp.contact_phone, MARGIN, y2);
    }
  }

  return doc;
}

export function downloadSponsorshipPdf(opp: SponsorshipOpportunity, filename?: string) {
  const doc = generateSponsorshipPdf(opp);
  const safe = (opp.title || 'sponsorship').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(filename || `${safe}_sponsorship.pdf`);
}