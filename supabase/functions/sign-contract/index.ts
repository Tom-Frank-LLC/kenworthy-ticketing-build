// supabase-js and its /cors entry are imported at ONE exact version. This
// function once took BOOT_ERROR from `npm:…@2.45.0` beside `npm:…@2/cors`:
// Deno dedupes npm packages by name, so /cors resolved against 2.45.0, which
// has no such export — fine under local Deno, fatal once deployed (see
// docs/TICKET-DELIVERY.md). Every function pins exact versions now (security
// audit 2026-10-06, L6), and supabase/tests/boot/run.sh boots each one in the
// real edge runtime, so that class of failure is caught before a deploy.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { actorHeaders } from '../_shared/audit.ts';
import { requireRole } from '../_shared/callers.ts';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.117.2/cors';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateSigningKey(admin: any) {
  const { data: existing } = await admin
    .from('signing_keys')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  const { data: inserted, error } = await admin
    .from('signing_keys')
    .insert({
      algorithm: 'Ed25519',
      private_key_b64: b64encode(priv),
      public_key_b64: b64encode(pub),
      active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create signing key: ${error.message}`);
  return inserted;
}

async function stampVerifyPage(pdfBytes: Uint8Array, fields: {
  signerName: string;
  signerTitle: string;
  signedAt: string;
  eventTitle: string;
  contractId: string;
  verifyUrl: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  let y = height - 72;
  page.drawText('VERIFIED BY KENWORTHY', { x: 72, y, size: 18, font: bold, color: rgb(0.72, 0.16, 0.42) });
  y -= 28;
  page.drawLine({ start: { x: 72, y }, end: { x: width - 72, y }, thickness: 1, color: rgb(0.72, 0.16, 0.42) });
  y -= 24;

  const label = (k: string, v: string) => {
    page.drawText(k, { x: 72, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(v, { x: 72, y: y - 14, size: 11, font });
    y -= 36;
  };

  label('SIGNED BY', `${fields.signerName} — ${fields.signerTitle}`);
  label('SIGNED AT', new Date(fields.signedAt).toUTCString());
  label('CONTRACT', `${fields.eventTitle}  (id: ${fields.contractId})`);

  y -= 6;
  page.drawText('VERIFY THIS DOCUMENT', { x: 72, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
  y -= 14;
  page.drawText(fields.verifyUrl, { x: 72, y, size: 10, font, color: rgb(0.2, 0.3, 0.7) });
  y -= 22;

  page.drawText('SIGNATURE SCHEME', { x: 72, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
  y -= 14;
  page.drawText('SHA-256 hash + Ed25519 (RFC 8032) detached signature', { x: 72, y, size: 10, font });
  y -= 24;

  const note =
    'This page records a detached cryptographic signature for the preceding contract. The Kenworthy server has stored the SHA-256 hash of this entire signed PDF together with an Ed25519 signature over that hash. To verify: visit the link above, upload this PDF file unchanged, and the verifier will recompute its SHA-256 and check the signature against the Kenworthy public key. Any modification to the contract — even one character — will cause verification to fail.';
  // wrap
  const words = note.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, 9) > width - 144) {
      page.drawText(line, { x: 72, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 12;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x: 72, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });

  // Footer
  page.drawText('Kenworthy Performing Arts Centre  •  508 S Main St, Moscow ID 83843', {
    x: 72, y: 48, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });

  return await pdf.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verify caller + admin role. The gate is asked through a plain service
    // client because the actor is not known until it answers.
    const signer = await requireRole(req, createClient(SUPABASE_URL, SERVICE_ROLE_KEY), 'admin', {
      headers: corsHeaders,
      unauthorized: 'Not authenticated',
      forbidden: 'Admin role required to sign contracts',
    });
    if (signer instanceof Response) return signer;
    const userId = signer.id;

    // Names the verified admin to the audit trigger on rental_requests and
    // signing_keys (_shared/audit.ts); otherwise a signed contract is nobody's.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: actorHeaders(userId) } });

    const body = await req.json();
    const { request_id, pdf_base64 } = body;
    if (!request_id || !pdf_base64) {
      return new Response(JSON.stringify({ error: 'request_id and pdf_base64 required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up rental request + signer profile
    const { data: rental, error: rentalErr } = await admin
      .from('rental_requests')
      .select('id, event_title')
      .eq('id', request_id)
      .single();
    if (rentalErr || !rental) {
      return new Response(JSON.stringify({ error: 'Rental request not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, signer_title')
      .eq('id', userId)
      .single();
    const signerName = profile?.display_name || signer.email || 'Authorized Admin';
    const signerTitle = profile?.signer_title || 'Authorized Signer';

    // Get / create signing key
    const key = await getOrCreateSigningKey(admin);
    const privKey = await crypto.subtle.importKey(
      'pkcs8',
      b64decode(key.private_key_b64),
      { name: 'Ed25519' },
      false,
      ['sign']
    );

    // Stamp verify page onto the incoming PDF
    const incoming = b64decode(pdf_base64);
    const signedAtIso = new Date().toISOString();
    const origin = req.headers.get('origin') || Deno.env.get('SITE_URL') || 'https://kenworthy-ticketing-build.mrtomfrank.workers.dev';
    const verifyUrl = `${origin}/verify/${rental.id}`;

    const stamped = await stampVerifyPage(incoming, {
      signerName,
      signerTitle,
      signedAt: signedAtIso,
      eventTitle: rental.event_title,
      contractId: rental.id,
      verifyUrl,
    });

    // Hash the stamped (final) PDF and sign that hash
    const sha256 = await sha256Hex(stamped);
    const sigBytes = new Uint8Array(await crypto.subtle.sign('Ed25519', privKey, stamped));
    const signatureB64 = b64encode(sigBytes);

    // Record on the rental request
    await admin
      .from('rental_requests')
      .update({
        signed_at: signedAtIso,
        signed_by: userId,
        signed_by_name: signerName,
        signed_by_title: signerTitle,
        signed_pdf_sha256: sha256,
        signature_serial: signatureB64,
        contract_status: 'signed',
      })
      .eq('id', request_id);

    return new Response(
      JSON.stringify({
        pdf_base64: b64encode(stamped),
        sha256,
        signature_b64: signatureB64,
        public_key_b64: key.public_key_b64,
        algorithm: key.algorithm,
        signed_at: signedAtIso,
        signer_name: signerName,
        signer_title: signerTitle,
        verify_url: verifyUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Signing failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});