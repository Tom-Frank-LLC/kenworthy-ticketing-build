---
brief: section-504-compliance
title: Establish whether Section 504 applies to the Kenworthy, and put the record behind it in place
status: queued
track: ops
severity: P2
date: 2026-08-23
verified: false
findings: ../accessibility-audit.md
---

# Brief (for Claude Code): Section 504 — establish the obligation, then evidence it

**Status:** 🟡 Investigation → documentation. Very little code.
**Date:** August 23, 2026
**Requested by:** Tom, following the WCAG 2.2 AA remediation
(`BRIEF-accessibility-ada.md`).
**Companion:** `docs/accessibility-audit.md` — the technical state of the site,
already remediated to zero axe violations on every public route.

> **This brief is not legal advice and must not be turned into any.** It is a
> research and record-keeping task. Where it calls for a legal conclusion, the
> deliverable is *the question, the evidence, and who to ask* — never an
> answer. Tom retains counsel; Claude does not.

## Why this exists

The ADA analysis for this site is settled and is *not* what this brief is about:

- **Title III** (public accommodations) covers everything publicly viewable.
  That is the litigation surface, it has been audited, and it is at zero.
- **Title I** (employment) does not apply — fewer than 15 employees.
- **Title II** (state and local government) does not apply — the building is
  owned by Kenworthy Performing Arts Centre, Inc., a private 501(c)(3). The
  Kenworthy family gifted the theatre to Moscow Community Theatre, Inc. on 31
  December 1999 and the current non-profit was formed in 2000. It is not a
  municipal facility.

**Section 504 of the Rehabilitation Act is the one that is genuinely open**,
because it does not key off employee count or public-accommodation status at
all. It attaches to whoever takes **federal financial assistance** — including
money that arrives through a state or regional intermediary rather than
directly from Washington.

### The evidence that this is a live question, not a hypothetical

Found while answering a different question; **all of it needs confirming
against the actual grant agreements, which are not in this repo.**

1. **National Park Service / Department of the Interior money, already
   received.** The Idaho Heritage Trust names the Kenworthy Performing Arts
   Centre, 508 S. Main Street, as a recipient of its Historic Theatre
   Revitalization Subgrant — the marquee restoration — out of a $821,000
   programme covering nine Idaho theatres. IHT's own attribution reads: the
   subgrant "is made possible by the Paul Bruhn Historic Revitalization Grant
   Program funded by the Historic Preservation Fund as administered by the
   National Park Service (NPS), Department of Interior."

   That is federal financial assistance, passed through a state-level
   intermediary, spent on the building. A subrecipient of federal funds is a
   recipient for Section 504 purposes.

2. **Two sponsors on `/sponsors` are federal pass-through bodies.**
   `src/pages/Sponsors.tsx` lists **Idaho Humanities Council** (the Idaho state
   affiliate of the National Endowment for the Humanities) and **Arts Idaho**
   (the Idaho Commission on the Arts, which re-grants National Endowment for
   the Arts partnership funds). Appearing as a sponsor logo is not proof of a
   federal subaward — it could be private or state money — so this is a lead,
   not a finding.

## What Section 504 actually requires, and how it differs

Enough to scope the work. Verify all of it before relying on it.

- **The rule.** 29 U.S.C. § 794: no qualified individual with a disability may,
  by reason of disability, be excluded from, denied the benefits of, or
  discriminated against under **any program or activity receiving federal
  financial assistance**.
- **No employee floor for coverage.** The 15-employee threshold that appears in
  504 regulations governs *procedural* duties — designating a responsible
  employee and adopting grievance procedures — and, separately, the phased web
  deadlines in the HHS rule. It does not decide whether 504 applies.
- **Scope is wide.** Under the Civil Rights Restoration Act of 1987, "program
  or activity" reaches all the operations of the recipient, or at minimum the
  entire facility to which the assistance was extended. Federal money spent on
  the Kenworthy's marquee therefore implicates the Kenworthy's programme, and
  selling tickets online is how that programme is delivered.
- **Each funding agency writes its own 504 regulations.** They are not
  identical. NEA's are at 45 CFR Part 1151; NEH's at 45 CFR Part 1170; the
  Department of the Interior's at 43 CFR Part 17. **Which agency's money you
  took decides which rulebook you are under** — do not assume one grant's terms
  generalise to another.
- **Only HHS has so far adopted an explicit web technical standard.** Its May
  2024 rule requires WCAG 2.1 Level AA for web content and mobile apps of HHS
  recipients. In **May 2026 HHS extended the dates by a year**: recipients with
  15+ employees to **11 May 2027**, recipients with fewer than 15 to **10 May
  2028**. The Kenworthy is unlikely to hold HHS money, so this probably does
  not bind it — but it is the direction of travel and the obvious benchmark if
  DOI, NEA or NEH follow.
- **Duration matters for a building grant.** Where federal assistance is
  extended for real property, 504 obligations typically continue for as long as
  the property is used for the purpose the assistance was given for. A one-off
  marquee grant is not necessarily a one-off obligation.
- **The NEA publishes a Section 504 Self-Evaluation Workbook** and requires
  recipients to complete a self-evaluation of programmes, activities, policies
  and practices. If any NEA-derived money is in play, that workbook is the
  template — do not invent one.

**The practical shape of this:** the site is already remediated to WCAG 2.2 AA
on every public route. What 504 adds is not more code. It adds **a record** —
that someone evaluated the programme, that there is a named person to complain
to, that complaints get handled, and that the evaluation is kept. That is the
gap.

## Phase 1 — establish the facts (mostly Tom, not Claude)

Claude cannot do this part alone; the documents are not in the repo. Produce a
short questionnaire and chase the answers.

- [ ] **Pull every grant agreement from the last six years.** For each: funder,
      is any of it federal money, which federal agency is the ultimate source,
      what were the assurances signed, and what does the agreement say about
      Section 504.
- [ ] **The IHT / Paul Bruhn subgrant specifically.** Get the executed
      subaward. It will almost certainly carry an Assurance of Compliance
      naming Section 504. That document is the single most decisive artefact in
      this brief.
- [ ] **Idaho Humanities Council and Arts Idaho** — were these federal
      subawards or state/private money?
- [ ] **Confirm the employee count** and whether volunteers change it, for the
      procedural duties only.
- [ ] **Confirm building ownership** in writing, to close out Title II for
      good.

**Deliverable:** `docs/FINDINGS-section-504-applicability.md` — one table, one
row per funding source, columns: funder · federal? · originating agency ·
agency's 504 rule · assurance signed? · evidence (document name and date). Where
the answer is unknown, the cell says *unknown* and who was asked. **A blank is
not a "no".**

## Phase 2 — the record, if Phase 1 says 504 applies

Almost all documentation. Nothing here should be built before Phase 1 answers,
because the right template depends on which agency's money it is.

- [ ] **A 504 self-evaluation.** Use the funding agency's own workbook (the NEA
      one, if NEA money is involved). It covers the building and the programme,
      not only the website — seating, box office, restrooms, assistive
      listening, communications — so it needs Tom's input on the physical
      plant. `docs/accessibility-audit.md` and `src/pages/Accessibility.tsx`
      supply the digital half and the venue facts already on record.
- [ ] **Name a responsible person.** A 504 coordinator by another name: someone
      access requests and complaints actually reach.
- [ ] **A grievance procedure**, published. `/accessibility`
      (`src/pages/Accessibility.tsx`) currently offers a phone number, an email
      address, and an aim to reply within two business days. That is a good
      contact route and it is *not* a grievance procedure — it does not say how
      a complaint is recorded, who decides, or what happens if the answer is
      no. Add that section to the page.
- [ ] **Records retention.** Say where the self-evaluation and any complaints
      live, and for how long.
- [ ] **Re-check the technical standard.** Confirm whether DOI, NEA or NEH have
      adopted a WCAG standard by the time this is done. If any of them has, the
      audit re-runs against that version and the answer goes in the findings
      file. `scripts/a11y-audit.mjs` already takes a tag list; WCAG 2.1 AA is a
      subset of what it runs today, so this is a re-run and a note, not new
      tooling.

## Non-goals

- **Do not state a legal conclusion.** "Section 504 applies" is Tom's call with
  counsel, on the evidence this brief assembles.
- **Do not put a conformance claim on `/accessibility`.** That decision is
  already settled: state the target and the known gaps. See
  `BRIEF-accessibility-ada.md`.
- **Do not re-audit the site.** It is at zero on every public route. If a new
  standard turns out to apply, re-run the existing scripts; do not start over.
- **Do not touch the admin dashboard for this.** 504 concerns the programme
  delivered to the public. Admin is kept clean on its own merits.

## Test plan (acceptance)

- `docs/FINDINGS-section-504-applicability.md` exists, has a row per funding
  source, and every cell is either evidenced or explicitly marked unknown with
  a named owner.
- The IHT / Paul Bruhn subaward agreement has been read, and whether it carries
  a Section 504 assurance is recorded either way.
- If 504 applies: a completed self-evaluation on the funder's own form, a named
  responsible person, and a published grievance procedure on `/accessibility`.
- If 504 does not apply: that conclusion is written down **with the evidence
  and the date**, so the next person does not re-derive it. This project has
  been bitten before by an untested claim believed for four days — see
  `docs/INCIDENT-2026-08-14-square-catalog.md`.
- `npm run build:production` and `npx vitest run` still pass if any page changed.

## Sources

Web sources consulted 23 August 2026. All secondary — none is a substitute for
the grant agreements themselves.

- NEA, Section 504 implementing regulations: <https://www.ecfr.gov/current/title-45/subtitle-B/chapter-XI/subchapter-B> (45 CFR 1151)
- NEA, Section 504 Self-Evaluation Workbook: <https://www.arts.gov/about/civil-rights-office/applicants-recipients-of-federal-financial-assistance/section-504-self-evaluation-workbook>
- NEA, Legal Requirements and Assurance of Compliance: <https://www.arts.gov/grants/legal-requirements-and-assurance-of-compliance>
- HHS, Section 504 final rule fact sheet (WCAG 2.1 AA for HHS recipients): <https://www.hhs.gov/civil-rights/for-individuals/disability/section-504-rehabilitation-act-of-1973/ocr-detailed-504-fact-sheet/index.html>
- Alston & Bird, compliance deadlines under the HHS 504 rule (May 2026 extension): <https://www.alston.com/en/insights/publications/2026/03/compliance-section-504-rehabilitation-act>
- WebAIM, the Rehabilitation Act sections 504 and 508: <https://webaim.org/articles/laws/usa/rehab>
- Idaho Heritage Trust, Historic Theatre Revitalization Subgrant recipients: <https://www.idahoheritagetrust.org/idaho-heritage-trust-announces-recipients-of-historic-theatre-revitalization-subgrant-awards-821000-to-restore-theatres-in-rural-communities/>
- Idaho Heritage Trust, Kenworthy project page: <https://www.idahoheritagetrust.org/projects-grants/kenworthy-theater/>
- Kenworthy history (1999 gift, 2000 incorporation): <https://www.kenworthy.org/history/>
