# Anchor — Triage Dialogue Examples

> **In this repo:** the patient lines here are the sample chips on the check-in screen (`SAMPLE_UTTERANCES` in `src/lib/data/seed.ts`), and Anchor's Tier 3 lines are used verbatim in `src/lib/triage/responses.ts`. Every one is exercised by `tests/triage.test.ts`.

Scripted example exchanges showing how each tier in `anchor-triage-logic.md` actually gets triggered in conversation. Every patient line here is synthetic, written to naturally use that tier's trigger keywords rather than just listing them — and every example ends with what Anchor actually does next, since a triage example that stops at the patient's line and doesn't show the routing isn't a complete example.

These are calibration/test fixtures for the team, not real patient exchanges — same status as the `ideal`/`complex`/`edge` seeded scenarios already in the build plan and Recovery Plan seed data.

---

## Tier 1 — Mild (Resolve in-conversation)

**Exchange 1**

> **Anchor:** Hey, it's me. How'd today go with the plan?
> **Patient:** Pretty good, honestly. Stuck to it — nothing to report.
> **Anchor:** Good to hear. Same time tomorrow.

*Triggers Tier 1.* Nothing to classify beyond "on track" — resolves with acknowledgment alone, no reference-library content needed.

**Exchange 2**

> **Anchor:** How was today?
> **Patient:** Kind of a stressful day, honestly. Had a moment where I really wanted a drink after work, but I didn't.
> **Anchor:** That's a real moment to notice — you saw it and you didn't act on it. If it comes up again tonight, try the urge surfing thing: picture the craving as a wave, it peaks and passes even if you don't do anything about it. Usually inside twenty minutes.

*Triggers Tier 1.* Single, clearly-described situational craving, no pattern yet — surfaces `ref-coping-urge-surfing` since it's directly relevant.

**Exchange 3**

> **Anchor:** Hey. How's it going tonight?
> **Patient:** Tired, but manageable. Feeling a little on edge, nothing major.
> **Anchor:** Makes sense after a long one. Get some rest — I'll check in tomorrow.

*Triggers Tier 1.* Mild, situational, no repetition — resolves in-conversation with no citation needed.

---

## Tier 2 — Moderate (Flag pattern)

**Exchange 1**

> **Anchor:** How'd today go?
> **Patient:** Same thing again — wanted to drink after work. That's the third time this week.
> **Anchor:** I hear you, and thanks for being straight about it happening again. Let's try the same thing as before for tonight — but I'm going to make sure your care team sees that this keeps showing up after work specifically, since that's worth them knowing before your next session.

*Triggers Tier 2.* The craving itself is Tier 1 material — what makes it Tier 2 is "third time this week." `flag_pattern_for_clinician()` fires with a plain-language summary ("third mention of after-work craving this week"); the in-call coping response still happens too.

**Exchange 2**

> **Anchor:** Hey, checking in — how was your day?
> **Patient:** Fine. Honestly though, I keep missing my Tuesday counseling session. Haven't been in two weeks.
> **Anchor:** Okay — that's good to know, and I'm glad you told me directly instead of me finding out another way. I'll flag that for your care team so they can follow up on scheduling. Anything going on that's making Tuesdays hard?

*Triggers Tier 2.* "Keep missing" is the recurrence signal — a single missed session would be Tier 1 material if it were the first mention; the pattern is what elevates it.

**Exchange 3**

> **Anchor:** How are you doing today?
> **Patient:** Okay I guess. I haven't been doing the breathing thing you suggested — doesn't feel like it's working. Kind of frustrated with the whole thing, honestly.
> **Anchor:** That's useful to hear, and it's not a failure on your part — sometimes a technique just isn't the right fit for a person, and that's worth your clinician knowing so you two can find something that actually clicks. I'm noting this so it comes up at your next visit.

*Triggers Tier 2.* Not urgent, but a trend (a technique not landing, frustration building) worth surfacing to the clinician rather than letting Anchor guess at a fix.

---

## Tier 3 — At Risk (Escalate)

**Exchange 1**

> **Anchor:** Hey, it's me. How'd today go?
> **Patient:** I don't know. Doesn't really matter anymore.
> **Anchor:** That sounds like more than a rough day, and I want to make sure you're actually okay — not something I can just check a box on. I'm connecting you with your clinician right now so a real person can talk this through with you.

*Triggers Tier 3.* "Doesn't matter anymore" is exactly the kind of hopelessness-flavored, ambiguous language the tier exists for — Anchor doesn't try to interpret or reassure past it. `escalate_to_clinician()` fires immediately, no gate.

**Exchange 2**

> **Anchor:** How was today?
> **Patient:** I don't really want to talk about today.
> **Anchor:** That's okay — you don't have to walk me through it. I'm not going to guess what's going on, though, so I'm getting your clinician on this so a person can check in with you properly.

*Triggers Tier 3.* Flat, non-responsive — nothing here confirms safety, and confirming safety is not something Anchor is positioned to do. Ambiguity itself is the trigger, per the "route up, never down" rule.

**Exchange 3**

> **Anchor:** Hey, checking in. How are you doing?
> **Patient:** Honestly? I feel hopeless. I don't know what I'd do if things got worse. Kind of scared of myself right now.
> **Anchor:** Thank you for telling me that directly — that matters, and it's exactly the kind of thing a person needs to hear right now, not me. I'm escalating this immediately so your clinician can reach you.

*Triggers Tier 3.* Explicit safety-relevant disclosure. Anchor names that it's routing to a human and stops there — it does not attempt to talk the patient through the feeling itself, consistent with the tier's rule that the AI's job here is to route, not to counsel through the disclosure.
