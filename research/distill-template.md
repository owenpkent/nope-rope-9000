# Distillation template

Use this checklist for every source. Skipping a field is fine if it doesn't apply (e.g., effort estimate for an RL paper); leaving it implicit and forgetting later is not. Each finding in [`FINDINGS.md`](./FINDINGS.md) should be answerable by walking down this list.

## Per-finding fields

- **Title**: short noun phrase. e.g., "Side-circle food exclusion".
- **Source**: link to the file, paper, or section.
- **Mechanism**: 2-4 sentences. What does this technique compute and what does it produce? Be specific enough that someone who hasn't read the source can implement it from this summary.
- **Failure mode addressed**: which death mode or known weakness in the bot does this target? Map to a line in `../CRITIQUE.md` if one fits.
- **Applicability to nope-rope-9000**: does our state model expose the inputs this needs? If not, what would we have to derive or estimate? If something is missing entirely (e.g., per-enemy intent labels), say so.
- **Estimated effort**: rough lines-of-code and whether it needs new tunables, new TTC math, or just a CFG knob.
- **Expected impact**: low / medium / high on median peakLength or median duration. Justify in one sentence. Speculative is fine; blank is not.
- **Risks**: how could this make things worse? Common risks are obstacle-wall effect (too-conservative ghosts), false safety (technique trusts data we don't actually have), and compute budget at 60 Hz.
- **Status**: idea / prototype / landed / rejected. Date on flip.
- **References within the codebase**: file:line links if any code has been written or earmarked. Leave blank for pure-idea entries.

## Questions to ask of each source

1. What does this do that we don't?
2. What evidence does the source give that it works? (Anecdote? n=15 batch? Theorem?)
3. What state does it read? Is that state available to us?
4. Does it assume something slither violates (cooperative agents, bounded crowd density, holonomic motion)?
5. If we copied it verbatim, what would break? If we adapted it, which assumption would we have to substitute?
6. Smallest possible prototype? (One CFG knob, one new picker branch, one preprocessing pass?)

## Anti-patterns

- "Looks cool". Not a reason. Discard or move to a separate `nice-ideas.md`.
- "Famous algorithm". Cite the assumption it violates in slither. Then either adapt or reject.
- Restating mechanism without applicability. The applicability field is the load-bearing one; "mechanism" alone is a Wikipedia summary.
