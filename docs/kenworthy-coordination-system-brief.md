# Brief: Standing up a coordination system for the Kenworthy ticketing platform

**Audience:** the Claude instance working on the Kenworthy ticketing platform in
project chat — the one that drafts briefs for Claude Code.
**Author:** Claude, on Tom's instruction, from a working system on a sibling project.
**Status:** partially adopted, 2026-08-19. `docs/briefs/` and a generated
`docs/TASKS.md` are in place, along with `CLAUDE.md` and the frontmatter schema
at `docs/briefs/.frontmatter-schema.md`. **Not adopted:** `docs/work-log.md` —
the commit messages on this project already carry the reasoning a work log is
meant to preserve, and §11 says to drop what is not earning its keep.
Read this in full before drafting your next brief.

---

## 0. What this document is, and what it is not

This is a **meta-brief**. It does not describe a feature, a bug, or a task on the
Kenworthy platform. It describes the *system* you should be operating inside when
you draft anything for Claude Code.

It asserts **nothing** about Kenworthy's stack, schema, team, hosting, or history —
because the author has no visibility into any of that. Every concrete detail in the
system below is something *you* must establish by interrogating the repository and
Tom. If you find yourself carrying an assumption from this document into a brief,
you have misread it. What transfers is the shape; the content is yours to build.

The system described here is not theoretical. It was built on a sibling project
(a single-tenant event management platform) in direct response to the same failure
you are hitting now, and the failure modes catalogued in §8 are all real incidents
from that project, not hypotheticals.

---

## 1. The diagnosis: context-loss is a system failure, not a memory failure

The instinct when a project starts losing context is to write longer briefs, or to
re-explain the project at the top of every session. Both are symptom-level fixes.
They feel like progress and they decay within weeks, because they put the burden in
the place that reliably fails: someone remembering to restate things.

The structural reading is different. **Context-loss happens when the project's
knowledge lives only in transcripts.** Transcripts get compacted. Terminals get
closed. Sessions end mid-thought. Chat history is not a database, and any workflow
that treats it as one will lose coherence at exactly the rate the project moves.

The fix is to move project knowledge out of conversation and into **durable,
in-repo artifacts that every session reads at the start and writes to as it goes.**
Once that exists, a session doesn't need to remember — it needs to *read*. Context
becomes a lookup, not a recollection.

There is a second, subtler failure that compounds the first, and it is the one that
actually bites you as the brief-drafting Claude:

> **You cannot see the working tree, and you will be systematically wrong about it.**

You draft from what's in your context window: a curated file subset, a handoff doc,
Tom's description, your memory of a prior session. All three are lagging indicators
of repository state. A brief drafted on a stale premise doesn't fail loudly — it
sends Claude Code confidently down a path that was already built, already deleted,
or never existed. Every protocol in §6 exists to catch that before it costs a
session.

---

## 2. The four artifacts

Four files carry the system. Nothing else is required, and adding a fifth before
these four are load-bearing is premature.

### 2.1 `CLAUDE.md` — persistent project context (the source of truth)

Lives at the repo root. Claude Code reads it at the start of **every** session
before touching a file. This is the single highest-leverage artifact; if you build
only one thing from this brief, build this.

What belongs in it:

- **Framing.** What the product is, who it's for, the tone/quality bar. Two
  paragraphs, not a page.
- **Environments.** Every deployed surface, its URL, its branch, its hosting. With
  a status note when something is mid-migration, and an explicit expiry for that
  note ("drop this row after X lands").
- **Tech stack**, as a table. Layer → technology.
- **Repository and branch discipline.** Which branch is production, which is
  development, what may never be committed directly, how promotions work.
- **Critical vocabulary.** A table of domain terms → the DB table → the UI label.
  This one section prevents more downstream confusion than any other. If two words
  in the domain have ever been confused (in ticketing: *ticket* vs *pass* vs
  *admission* vs *order line*; *customer* vs *attendee* vs *purchaser*; *event* vs
  *performance* vs *showing*), fix the meaning here and record what the term used
  to mean and when it changed.
- **State machines.** Every status enum, every legal transition, what each state
  means for visibility and mutability. Ticketing platforms are full of these —
  order states, ticket lifecycle, refund states, seat holds. Ambiguity here
  produces bugs that look like race conditions and aren't.
- **Auth and permission model.** Roles, hierarchy/cascade semantics, what's gated
  where, which checks are canonical. Include the rules that are *not* obvious —
  e.g. if role checks cascade, say so and forbid the redundant belt-and-braces
  check that implies they don't.
- **Conventions with their rationale.** Query defaults, date handling, loading
  states, naming. Never state a rule without the "why" — a rule with a rationale
  survives a plausible-sounding argument to break it; a bare rule does not.
- **Established patterns.** Reusable component contracts, canonical-table
  consolidations, trigger patterns. When a shape has been chosen deliberately
  (e.g. "obligations go in one polymorphic table, never a parallel table per
  entity"), record the shape *and* the obligations that come with it.
- **Known-issue checklists.** For the recurring class of bug — the one that's been
  diagnosed four times — write the diagnostic checklist inline, ordered.
- **The protocols in §6 and §7 of this brief**, restated in project terms.

What does not belong: anything that will be wrong in a month and won't be noticed.
Prefer pointing at the code as the source of truth for volatile detail — "the
canonical palette is in `<file>`; if this doc conflicts with it, the code wins" —
over duplicating it.

**Maintenance rule:** `CLAUDE.md` is updated in the same commit as the change it
describes. A doc updated "later" is a doc that drifts. When it does drift, run an
explicit reconcile pass and log it.

### 2.2 `docs/work-log.md` — the session log (write-as-you-go, mandatory)

This is the artifact people skip, and skipping it is precisely what produces the
context-loss you're trying to fix.

**The rule:** Claude Code appends to the work log immediately after each meaningful
unit of work completes — not at the end of the session. A unit is a brief, a bug
fix, a diagnosis, a decision, or a deferral.

Why "immediately" is the whole rule: a session can be compacted, interrupted, or
killed at any moment. An entry written before that happens survives. An entry
written from memory afterwards is reconstructed, thin, and often subtly false —
the diagnostic detail you actually needed is exactly what compaction removed.

Format: `## YYYY-MM-DD` day headings, `### HH:MM — one-line subject` entries,
2–6 lines each, appended in chronological order. Each entry must **stand alone** —
readable six months later with no other context.

Log: diagnoses (root causes, not symptoms), decisions (A vs B, with reasoning),
files touched by path, migrations by filename, deferrals (what was attempted, what
stopped it, what's next), and verification hooks (the SQL or UI path Tom should
smoke-test).

Do not log: intent ("working on X"), speculation, or anything requiring hindsight
to write accurately. If you're reaching for "in summary…", you have already skipped
the entries you should have written.

**Honesty requirement — state this explicitly in `CLAUDE.md`.** If work is partial,
blocked, or unverified, the entry says so *in the moment*. The cost of an honest
"deferred — UI not wired" is a sentence. The cost of a confident entry that turns
out to be fiction is a future session building on a false premise, and it is much
larger.

### 2.3 `docs/briefs/*.md` — one file per unit of work

Briefs are files in the repo, not messages in a chat. A brief in a chat log is
unfindable, uncitable, and dies with the transcript. A brief in the repo can be
grepped, diffed, superseded, and pointed at from a commit message.

Each brief carries YAML frontmatter (§4) and a body (§5).

### 2.4 `docs/TASKS.md` — the catalogue (generated, never hand-edited)

A single view of every brief by track and status.

**Generate it from the briefs' frontmatter with a script.** Do not maintain it by
hand. This is the load-bearing design decision in the whole task system, and it is
worth understanding why rather than copying it:

A hand-maintained task list drifts silently, because keeping it accurate requires
remembering to edit a *second* file after finishing work in a *first* one. That
discipline fails, quietly, every time. Generating the catalogue shifts the burden
to "update the frontmatter of the brief you already have open" — a smaller ask that
happens naturally during the work and shows up in the git diff where a reviewer
sees it.

Put a `<!-- DO NOT EDIT — generated by <script> -->` header at the top of the
generated file so a future session doesn't waste effort hand-editing something
that's about to be overwritten.

Add a **loose backlog** file for ideas that need remembering but don't merit a
brief yet; concatenate it into the catalogue verbatim. Promote to a real brief when
picked up, and remove the loose entry in the same commit.

---

## 3. Operating principles

These govern how work is framed, not just how it's documented. State them in
`CLAUDE.md` in project terms.

1. **Address the cause, not the symptom.** When a fix would patch over a
   wrong-looking output without explaining why the output is wrong, resist it. Find
   the structural reason first, then choose *consciously* whether to fix upstream or
   downstream. A conscious downstream fix is fine; an unconscious one is debt.

2. **Investigate structure before designing transformations on it.** Before writing
   code that operates on data, verify what the data actually contains —
   end-to-end, with instrumentation. Cheap when the mental model is right; cheap
   insurance when it isn't.

3. **"Mechanically correct, visually wrong" is a structural problem.** If code runs
   but the output is wrong with no obvious local cause, the model of the system is
   wrong somewhere. Reach for instrumentation, not parameter tuning. Axis swaps,
   sign flips, offset constants and magic numbers are symptoms of misunderstood
   structure, not fixes.

4. **Working code in the repo is the source of truth.** When a working version of a
   call or technique already exists, that is authoritative. External docs are the
   fallback. Find the working version before guessing at conventions.

5. **Investigations need written deliverables.** Verbal insight evaporates. The
   threshold: could someone reconstruct what was learned six months later without
   re-running the investigation?

6. **Distrust early successes.** When code "just works" on the first try after
   several structural assumptions, verify the assumptions held.

7. **Default to information-gathering over progress-feeling action when the model of
   the system is uncertain.** Writing code feels like progress and is often wrong
   when the model is unclear. Reading, instrumenting and documenting feels slower
   and compounds.

8. **Ask clarifying questions when goal, constraints or context are unclear.** One
   round-trip costs less than building the wrong thing. This applies to you, when
   Tom hands you an underspecified request, as much as it applies to Claude Code.

A note on how these interact with brief-drafting: principles 2, 3 and 7 are the
reason §5's brief template has a **STOP conditions** section. A brief that cannot
be executed without resolving an unknown should surface that unknown as a hard
stop, not bury it as an assumption.

---

## 4. Brief frontmatter and the catalogue schema

Define a schema doc (`docs/briefs/.frontmatter-schema.md`) and hold to it, because
the generator parses these fields.

Minimum when drafting:

```yaml
---
brief: <filename-without-extension>
status: queued
track: <bug|feature|ux|ops|security|...>   # define the set for Kenworthy
---
```

Recommended as the brief takes shape: `severity` (P0–P3), `related: [...]`,
`supersedes:` / `superseded_by:`, `shipped_in:`, `shipped_at:`, `last_updated:`.

Lifecycle transitions, each followed by a catalogue regeneration:

- **Shipping** — set `status: shipped`, `shipped_in`, `shipped_at`, `last_updated`;
  commit the frontmatter change alongside the ship commit.
- **Superseding** — set `superseded_by` on the predecessor and `supersedes` on the
  successor. Both sides, always; a one-sided link is how a dead brief gets
  re-executed.
- **Closing a non-bug** — `status: closed-not-a-bug` plus a one-line
  `closed_reason`. Closing with the reason recorded is a *finding*, not a failure;
  it is often the most valuable thing a session produces.

---

## 5. The brief standard

This is the quality bar. A brief you hand to Claude Code should not be executable
in more than one way.

### Required anatomy

1. **Frontmatter** (§4).
2. **Title** — states the outcome, not the activity.
3. **Status / framing** — one paragraph: what prompted this, what it is and isn't.
4. **Why this needs doing** — the evidence. Paste the actual error output, the
   actual query result, the actual screenshot description. Evidence, not summary.
   A brief whose premise is "Tom mentioned the page looks wrong" is not yet a brief.
5. **Root cause / current understanding** — explicitly labelled as *understanding*,
   with its confidence level. If it's a hypothesis, say "hypothesis" — that word is
   what licenses Claude Code to disconfirm it instead of implementing around it.
6. **What to do** — numbered, in dependency order, each step concrete enough to
   execute and specific enough to verify. Name files by path where known; where not
   known, say "locate X" rather than guessing a path.
7. **What NOT to do** — the guardrails. This section prevents more damage than any
   other. Scope creep, tempting-but-wrong fixes, adjacent cleanups that belong in
   their own diff. Keep the diff narrow and reviewable.
8. **STOP conditions** — the load-bearing unknowns. Each one names the specific
   thing that, if found to be different from the brief's assumption, means **stop
   and surface, do not proceed on guesswork**. See below.
9. **Definition of done** — observable, verifiable outcomes. Not "the bug is
   fixed" — *"`git status` after `<command>` shows no changes under `<path>`"*.
10. **Verification hook** — the exact SQL, command, or click-path for Tom to
    confirm it. Written *before* the work, so it can't be retrofitted to whatever
    happened.

### On STOP conditions

A STOP condition is not a caveat. It is a named premise plus an instruction to halt
if it doesn't hold. Good ones read like:

> **STOP-1 (premise).** This brief assumes `<X>` is `<state>`. Verify with
> `<command>` before step 2. If it is not, stop and log the divergence in the work
> log — the fix in step 3 depends on this and will be wrong otherwise.

Their value has been proven repeatedly: on the sibling project, a brief prescribed
an elaborate workaround based on the premise that a database trigger was
unrecoverable. The STOP condition forced a verification. The premise was wrong — a
simpler recovery existed — and the correct two-line fix shipped instead of the
wrong architecture. **The STOP condition, not the analysis, is what caught it.**

### Template

```markdown
---
brief: <id>
status: queued
track: <track>
severity: <P0-P3>
---

# <Outcome-stating title>

## Framing
<What prompted this. One paragraph. What this is and explicitly is not.>

## Why this needs doing
<Evidence. Actual output, actual behaviour, actual cost of leaving it.>

## Current understanding
<Root cause or hypothesis — labelled as which. Confidence stated.>

## What to do
1. <Concrete, ordered, verifiable step.>
2. ...

## What NOT to do
- <Guardrail. Adjacent work that belongs in its own diff.>

## STOP conditions
- **STOP-1 (<name>).** <Premise + how to verify + halt instruction.>

## Definition of done
- <Observable outcome.>

## Verification hook
<Exact SQL / command / click-path for Tom.>
```

Two-phase briefs (§7) also carry an explicit **Phase 1 / Phase 2** split with a
decision point between them.

---

## 6. Protocols for Claude Code (put these in `CLAUDE.md`)

### 6.1 Pre-execution inventory — mandatory, every brief

Before executing anything, run a real inventory against the actual working tree and
reconcile it with what the brief assumed. **If reality diverges from the brief's
premise, stop and surface it in the work log. Do not proceed on guesswork.**

Two checks, always:

**(a) File-system inventory** — for any brief that operates on files. Run
`ls` / `find` against the tree and reconcile with the brief's enumerated list. If
files surface that the brief didn't account for, stop; log the gap; wait for
direction or an amended brief. Do not guess placement. For any tracking-status
assumption ("this file is untracked"), verify with `git ls-files --error-unmatch`
or `git log --follow` rather than assuming.

The cost asymmetry is the whole argument: a clarification round is minutes; moving
thirty files to the wrong place and reverting is a session. On the sibling project,
a brief enumerated ~12 files in a directory that actually held ~55. Claude Code
stopping and surfacing that — rather than proceeding — is the model behaviour.

**(b) "Has this already shipped?"** — for *every* brief, including ones that feel
obviously new. Run `git log --all --oneline --grep=<brief-id>` and again against
keywords from the brief's main goal. Read the closest commit messages. If the work
already shipped, fully or partially, close the brief as a no-op or amend its scope
to cover only what's actually missing.

This is not paranoia. On the sibling project three separate briefs in two days were
already-shipped work: a handoff doc carried an item as queued that had shipped two
days earlier; a heads-up described a file as untracked that had been tracked for
weeks; a brief was framed as "may or may not have been done" when a commit named
after that very brief already existed. **Handoff docs and brief drafts are not
authoritative for working-tree state. The working tree is.** The check takes
seconds; skipping it wastes a session.

### 6.2 Session work log — write as you go

Per §2.2. Non-negotiable, and the rule is stated in `CLAUDE.md` rather than left to
habit.

### 6.3 Honesty on partial work

Per §2.2. Worth restating as its own protocol because it is the one that decays
first under time pressure.

---

## 7. Two-phase explore-then-build

When a brief's visual or structural shape is **not yet decided**, split it:

- **Phase 1 — exploration.** Produce candidates as inspectable artifacts: HTML
  files for visual options, audit tables for sweep work, scoping notes for unclear
  scope. **No production code is touched.** Phase 1 ends with Tom picking a
  direction, or with an explicit "baseline is good enough" close.
- **Phase 2 — implementation.** Execute the chosen direction in a focused commit.

Rationale: writing production code before the shape is decided is parameter-tuning
before structure is understood (principle 3). Explorations are cheap; rework is
expensive. The split also gives Tom a clean intervention point *between* phases,
without forcing him to review code mid-flight.

The failure this prevents, concretely: a one-phase UI brief on the sibling project
shipped and was reverted the same day, because the visual decision got made in code
instead of in exploration. The two-phase re-do landed cleanly.

**Trigger:** if you cannot write the "Definition of done" section without inventing
a design decision that is Tom's to make, the brief is two-phase.

---

## 8. Failure modes to design against

Each of these is a real incident from the sibling project, generalised.

| Failure | What it looks like | What prevents it |
|---|---|---|
| Stale-premise brief | Brief prescribes an elaborate fix for a problem that isn't the actual problem | STOP conditions naming the premise |
| Already-shipped brief | A full session spent re-implementing existing work | `git log --grep` check (§6.1b) |
| Partial-visibility brief | Brief enumerates 12 files; the directory holds 55 | File-system inventory (§6.1a) |
| Silent catalogue drift | Task list confidently lists the wrong statuses for months | Generate the catalogue from frontmatter |
| Vocabulary drift | Two names for one entity; queries and UI diverge | Vocabulary table in `CLAUDE.md`, with the rename history |
| Shape-decided-in-code | Ship and revert in the same day | Two-phase explore-then-build |
| Fictional log entry | A confident entry describing unfinished work as shipped | Honesty requirement, stated as a rule |
| Post-compaction reconstruction | Thin, vague entries missing the diagnostic detail | Write-as-you-go, per unit not per session |
| Superseded-brief zombie | A dead brief gets executed | Two-sided `supersedes` / `superseded_by` |
| Rule without rationale | A convention gets argued away by a plausible-sounding case | Every rule in `CLAUDE.md` carries its "why" |

---

## 9. Bootstrap sequence

Do not attempt this in one pass, and do not draft `CLAUDE.md` from your current
context — your current context is exactly the unreliable source this system exists
to replace.

**Phase 0 — interview.** Before writing anything, establish with Tom:

1. What Kenworthy is, who uses it, what the quality bar is.
2. The environments: production, staging (if any), how deploys happen, what may
   never be committed directly.
3. The stack, layer by layer.
4. The domain vocabulary — and specifically **which terms have ever been confused
   or renamed**. Ticketing has a lot of near-synonyms; this is where the highest-value
   entries come from.
5. Every status enum and its legal transitions.
6. The auth/permission model and any non-obvious rules within it.
7. The recurring bug class — the one that's been diagnosed more than twice. That
   becomes a diagnostic checklist.
8. What's currently mid-flight, and what recently shipped (so §6.1b has something
   to reconcile against).
9. What documentation already exists, and whether it's trusted. Do not assume the
   answer is "none."

**Phase 1 — inventory, not authorship.** Have Claude Code produce a written audit
of what exists: current docs, their staleness, the actual directory structure, the
last N commits by track. This is an exploration phase per §7 — no authorship yet.
It exists so `CLAUDE.md` is written from the tree rather than from memory.

**Phase 2 — author the four artifacts.** In order: `CLAUDE.md` (from the Phase 0
answers + Phase 1 audit), then `docs/work-log.md` (seeded with the bootstrap
itself as its first entries), then `docs/briefs/` with the schema doc and the
template from §5, then the catalogue generator and its first run.

**Phase 3 — run one real brief through the system end-to-end** before declaring it
adopted. Draft it to the §5 standard, execute it with the §6 protocols, log it per
§2.2, ship it, regenerate the catalogue. What the system is missing will be obvious
after one full lap and invisible before it.

---

## 10. Pre-handover checklist

Before you hand any brief to Claude Code, confirm every line:

- [ ] Frontmatter present and schema-valid.
- [ ] Every factual claim about the repo is either verified or explicitly flagged
      as an assumption **with a STOP condition attached**.
- [ ] File paths are real, or the brief says "locate" instead of guessing.
- [ ] The premise most likely to be wrong is named as STOP-1.
- [ ] "What NOT to do" is populated — including at least the tempting adjacent
      cleanup that belongs in its own diff.
- [ ] "Definition of done" is observable by someone who wasn't in the conversation.
- [ ] The verification hook is a command or click-path, not "check it works."
- [ ] If the shape isn't decided, the brief is two-phase (§7).
- [ ] The brief does not mix a fix and a feature. If it does, split it — the fix
      ships now, the feature waits.
- [ ] The brief instructs the `git log --grep` already-shipped check by name.

---

## 11. What NOT to copy from the sibling project

- **Its stack, schema, vocabulary, roles, or conventions.** None of it applies.
  Anything concrete in this document is illustrative.
- **Its exact tracks and severity ladder.** Define Kenworthy's own; too many tracks
  is worse than too few.
- **Its tooling choices** for the catalogue generator. Use whatever Kenworthy
  already has in its toolchain — matching the repo beats matching this document.
- **Ceremony that isn't earning its keep.** Every artifact here exists because a
  specific failure kept recurring. If a piece of this isn't preventing a failure
  you actually have, drop it and note why. A system maintained out of obligation
  rather than utility is the next thing to drift.

---

## 12. The one-sentence version

Move the project's knowledge out of the transcript and into four files the repo
owns; then make every brief state its premises loudly enough that being wrong about
them stops the work instead of misdirecting it.
