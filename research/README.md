# Research pipeline

A repeatable process for mining external code, robotics literature, and adjacent-game bots for techniques the bot doesn't already use. Distinct from the root [`RESEARCH.md`](../RESEARCH.md), which is a one-shot "pick the approach" doc from project start; this directory is the ongoing "what else can we steal" mill.

## Why a pipeline at all

The first-principles tear-down in [`../CRITIQUE.md`](../CRITIQUE.md) identified the structural flaws of v0.5.2 from inside. The known unknowns (CRITIQUE items 4, 6, 7 and beyond) live in code we have not read yet. A casual "let me skim j-c-m again" loses to a structured catalog with status tracking, because we keep coming back to the same handful of repos and forgetting which we evaluated when and what we concluded.

## Files

- [`sources.md`](./sources.md): the catalog. One row per source. URL, status, one-line "why look at this", next action.
- [`FINDINGS.md`](./FINDINGS.md): distilled techniques. One section per technique with mechanism, applicability, effort, expected impact, and current status (idea / prototype / landed / rejected).
- [`distill-template.md`](./distill-template.md): the questions to ask of each source so distilled findings stay comparable.

## Process

To investigate a source:

1. Add a row in `sources.md` with status `pending`.
2. Fetch the source. Options: WebFetch on a single page (README, code file, paper PDF); spawn an Explore or general-purpose agent for a multi-page repo, briefed with what nope-rope-9000 already does, the source URL, and `distill-template.md` as the deliverable shape; manual read for short-form sources.
3. Distill into `FINDINGS.md` using the template. One finding may span multiple sources; in that case cross-link.
4. Flip the source row to `done` with the date.
5. If a finding becomes a code change, link the finding to the commit / CFG knob in `FINDINGS.md`.

## Adding agents to the loop

The pipeline is friendly to parallelism. Spawning N agents on N disjoint sources is the same as doing N manual investigations, except faster and less prone to context bleed. Each agent should return a fragment that drops cleanly into `FINDINGS.md` (the template enforces this).

Brief every agent with the same three things: current bot state (link to `../CRITIQUE.md` and `../README.md` steering-algorithm section); the specific source URL it owns; the deliverable shape (template).

Don't have agents write directly to `FINDINGS.md` (race conditions on multi-agent runs). They return findings; the orchestrator synthesizes.

## Anti-patterns

- Reading a fork "for inspiration" without writing down what you saw. The catalog dies; the same repos get re-read.
- Rating a technique purely on cleverness. Slither has a fixed state model and a steering loop with O(obstacles x candidates) per-tick budget. A technique that needs data we don't have (e.g., intent labels) or compute we can't spend is rejected.
- Confusing "this technique is famous" with "this technique applies." ORCA is fundamental for multi-agent robotics but assumes reciprocity; slither enemies are uncooperative. Adapt or drop, but say which.
