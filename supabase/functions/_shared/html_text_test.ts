// Tests for flattening description HTML server-side.
//
// Run: deno test --node-modules-dir=none --allow-env \
//        supabase/functions/_shared/html_text_test.ts
//
// These cases mirror the `htmlToPlainText` block in src/lib/richText.test.ts on
// purpose. The two implementations are deliberate copies — Deno cannot import
// from src/, and neither `npm run build` nor vitest compiles this directory, so
// nothing but these tests keeps them from drifting apart.
//
// What is at stake is not a crash. The Mailchimp campaign builder HTML-escapes
// whatever it is handed, so an unflattened description would go out as visible
// `<p>` tags in a real marketing blast — and staging shares production's
// Mailchimp key and audience, so there is no safe place to notice that first.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { htmlToPlainText } from "./html_text.ts";

Deno.test("separates blocks with a space rather than joining the words", () => {
  assertEquals(htmlToPlainText("<p>One.</p><p>Two.</p>"), "One. Two.");
  assertEquals(htmlToPlainText("<ul><li>A</li><li>B</li></ul>"), "A B");
});

Deno.test("drops inline formatting without eating the words", () => {
  assertEquals(
    htmlToPlainText("<p>A <strong>restored</strong> print</p>"),
    "A restored print",
  );
});

Deno.test("removes a link but keeps its text, and the punctuation after it", () => {
  // <a> is inline, so it is not a block boundary — no space is inserted and the
  // full stop stays against the last word.
  assertEquals(
    htmlToPlainText('<p>See <a href="https://kenworthy.org">the site</a>.</p>'),
    "See the site.",
  );
});

Deno.test("decodes entities without re-creating markup", () => {
  assertEquals(
    htmlToPlainText("<p>Tickets &lt; $10 &amp; worth it</p>"),
    "Tickets < $10 & worth it",
  );
  // The author escaped this deliberately; it stays text, it does not become a tag.
  assertEquals(htmlToPlainText("<p>&amp;lt;b&amp;gt;</p>"), "&lt;b&gt;");
});

Deno.test("leaves a pre-editor plain-text row readable", () => {
  assertEquals(htmlToPlainText("One.\n\nTwo."), "One. Two.");
});

Deno.test("is empty for nothing at all", () => {
  assertEquals(htmlToPlainText(null), "");
  assertEquals(htmlToPlainText(undefined), "");
  assertEquals(htmlToPlainText("<p></p>"), "");
});

Deno.test("strips a script tag's markup", () => {
  // Not the security boundary — that is the allowlist at render — but an email
  // must never carry the tag through either.
  const out = htmlToPlainText("<p>Hi</p><script>alert(1)</script>");
  assertEquals(out.includes("<"), false);
});
