# Potential feature — Marketplace

> **Status: tabled, 2026-08-11.** Recorded so the idea is not lost and not silently
> re-litigated. Nothing here is scheduled.
> **Decision reference:** D35.

---

## The idea

Today a customer reaches one agency directly: `chat.<domain>/a/{slug}`, from that agency's
own Instagram bio link, website embed, QR code or Google Business Profile.

The marketplace inverts that. Customer downloads the app, logs in, **browses caterers**,
selects one, and is routed into the chat with *that brand's* agent. Client and customer
live in the same app: the caterer uploads brand and catalogue data on one side, the
customer receives the agent's replies on the other.

---

## Why it is tabled rather than rejected

It may well be a better business. It is not the business `PRODUCT_SPEC.md` describes, and
three things change at once if it ships:

**1. It contradicts a locked decision.** D16 — *event agencies only, no premature
abstraction* — and the §1 positioning: *"meets small DACH event agencies inside their
actual sales conversation."* A directory is not inside their conversation. It is a
different surface with a different owner.

**2. Who owns the lead changes, and with it the price.** The current pitch to a caterer is
"your link, your customer, your brand — we just make you fast." That is worth €19–49/month
because the agency keeps the relationship. A directory makes each caterer one tile beside
their direct competitors. Some will refuse on that basis alone, and the ones who accept are
buying a lead-gen product, priced per lead, not per seat. Different product, different
model, different objections.

**3. Two-sided cold start.** No customers until there are vendors; no vendors until there
are customers. The current design has no cold-start problem at all, because the agency
brings its own traffic from Instagram. Giving that up is the single largest strategic cost
of the pivot and should be a deliberate trade, never a drift.

---

## What would have to be true first

- The single-tenant product works and has paying customers. A marketplace built on an
  unproven engine multiplies an unproven thing.
- Evidence on **open question #6** in CLAUDE.md — what share of customers engage with a
  hosted chat link at all. That number gates this idea as much as it gates WhatsApp.
- A demand-side acquisition story that does not depend on the vendors. If customers only
  ever arrive through a caterer's own link, the directory adds nothing and costs the
  positioning.
- An answer for vendors on competitive adjacency — can they opt out of the directory and
  keep the direct link?

---

## Carried over from the tabling session

The owner's own description of the customer-side flow (`[Pasted text #1]`) did not arrive
in the 11 Aug session. **It needs to be re-pasted here before this is picked up**, since it
is the only first-hand statement of the intended customer journey.

Also noted at tabling: the customer side should keep **document and screenshot upload** but
nothing beyond it. Voice recording is for the *client* (the caterer), not the customer —
it is error-prone and adds no value on the customer side. This is consistent with D5,
which puts voice notes out of MVP scope generally.
