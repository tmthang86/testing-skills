# False greens — when the suite passes and proves nothing

A red test is information. A green test is information **only if it could have been red.** Most of
the ways a suite lies are invisible in its own output, because a suite that asserts nothing and a
suite that asserts everything print the same word.

Everything below was measured on a real desktop application over about a week — a Tauri app with a
WebDriver suite, a Rust test suite, and live API tests. Each case cost hours before it was
understood, and each one had been green the whole time.

## Table of contents
- [1. The test that never asserted](#1-the-test-that-never-asserted)
- [2. The vacuous wait](#2-the-vacuous-wait)
- [3. Exit status is not the result](#3-exit-status-is-not-the-result)
- [4. Fixtures that agree with the bug](#4-fixtures-that-agree-with-the-bug)
- [5. A guard nobody has seen fail](#5-a-guard-nobody-has-seen-fail)
- [The checklist](#the-checklist)

## 1. The test that never asserted

Nine `it()` blocks, no `expect()` anywhere inside them. The reporter said **8/8 spec files
passing**, and that green was read as evidence for two weeks.

An agent generating tests produces this readily: the setup steps are the interesting part to write,
the assertion is one boring line at the end, and nothing complains when it is missing.

**Fix it mechanically, not by discipline.** A dozen-line script that walks the spec files and fails
the run on any `it()` containing no `expect()` closes this permanently:

```js
// runs as part of every e2e script, before the browser starts
for (const file of specFiles) {
  for (const block of itBlocks(file)) {
    if (!/\bexpect\s*\(/.test(block.body)) {
      fail(`${file}: it("${block.title}") contains no expect()`);
    }
  }
}
```

Two details matter. It has to run **as part of the test command**, not as an optional lint nobody
invokes. And it has to be **seen failing against the empty specs before any assertion is written** —
otherwise you have added a second thing you are trusting without evidence.

## 2. The vacuous wait

A search spec typed a query and waited for the results list to be empty, asserting the
no-matches state.

It passed. It also passed when the typing delivered **nothing at all** — because an empty list is
exactly what an empty query produces. The test proved *doing nothing yields nothing*, and read as a
green search test.

This shape is everywhere once you look for it:

| Assertion | Also passes when |
|---|---|
| waits for zero results | the query was never entered |
| waits for an error toast | the app was already showing that error |
| expects an empty cart | the "add" click missed |
| expects a disabled button | the page never loaded |

**The rule: an assertion whose expected value is "nothing" must be paired with one that proves the
action happened.** Read the input back after typing into it; assert the list was non-empty *before*
filtering; check the click's own side effect. One extra round trip buys the difference between a
test and a decoration.

Concretely, after driving an input, read it back before asserting on the consequences:

```js
await typeInto(field, query);
const actual = await field.inputValue();
if (actual !== query) {
  throw new Error(`typing did not reach the field: it holds ${actual.length} chars, expected ${query.length}`);
}
```

That check later caught a completely different bug — input going to the wrong process entirely —
and named it in one line instead of a downstream timeout. It pays for itself twice.

## 3. Exit status is not the result

Six distinct instances in one project, all of the same shape: **something reported success over a
failure underneath it.**

| Reported success | Actually true |
|---|---|
| A test binary exited **0** | a worker thread had panicked; the process survived because the panic was on a detached task |
| A wrapper script exited **0** | it ended in `echo`, which overwrote the `124` from the timeout above it |
| `$?` read **0** after a pipeline | it was the exit status of `head`, not of the command under test |
| A harness printed **PASS** | its own failure path had run; the caller read the wrapper's status |
| A validator printed **FAILED** | it *did* exit 1 — but the reader had checked `$?` after a pipe again |
| A subprocess helper threw `Command failed: <argv>` | the child's stderr said *which* refusal it was, and the wrapper discarded it |

The last one is the most instructive: it was written the same afternoon by someone who had just
written the other five down.

**Two rules follow.**

**Read the output, not the status.** They are different checks. A silent no-op that exits 0 is the
worst failure shape there is, and it is common in agent-driven work — one delegated run took 35
minutes, exited 0, and produced no files at all. `git status` catches that; an exit code does not.

**Whatever you wrap, make it carry the child's output up with the status.** An error naming the
command but not the reason costs a diagnosis cycle every single time:

```js
try {
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  const detail = (err.stderr || '').trim() || (err.stdout || '').trim() || 'no output';
  throw new Error(`${bin} ${args.join(' ')} failed (exit ${err.status}): ${detail}`);
}
```

## 4. Fixtures that agree with the bug

A filename parser scored **37/37 — 100%** against a corpus of real recorded names, comfortably over
its 90% bar. In the shipped app it split five films into ten library entries.

The corpus was real data, not invented — that part was done right. What it lacked was one *shape*:
the corpus carried a certain tag only at the **end** of names, and the defect only fires when that
tag appears at the **start**. Every fixture agreed with the bug, so the score was honest and
meaningless.

This was the third time in that project that fixtures agreed with a defect and only production data
disagreed. The other two were a database column with no type affinity, and a version string with an
unexpected prefix.

**What actually helps:**

- **Record fixtures from production data**, and assert the recorded count so the corpus cannot
  silently shrink when someone re-records it.
- **A high score against a fixed corpus measures the corpus.** Treat 100% as a reason to look for
  the shape you did not collect, not as a reason to stop.
- **Exercise the real thing periodically.** Every defect in that project's final week was found by
  running the app and reading output — none by a passing suite.

## 5. A guard nobody has seen fail

A guard — an assertion protecting an invariant, a refusal in a harness, a precondition check — that
has only ever been observed passing is **not known to work.** It may be checking nothing.

The cheap discipline that fixes this: **prove it by reversal.** Break the thing it protects, watch
it go red, then restore. Examples that each caught a real hole:

- The empty-`it()` guard, run against the nine empty specs *before* filling them in.
- A keyboard spec passing with native input, run again with the previous input channel restored —
  it went red, which proved the pass came from the mechanism under test and not from something else.
- A "nothing was written to the wrong disk" assertion, re-run looking for a filename that is never
  written — it failed, proving the assertion was live rather than vacuously true.
- A harness refusal that must fire when a precondition is absent, exercised with the precondition
  deliberately removed.

When a reversal is impractical — it needs a locked machine, or revoking a system permission — say so
in the test's own documentation rather than implying the guard is proven. An honest "this one is
reviewed by reading, not by reversal" is worth more than a checkmark.

## The checklist

Before believing a green run:

1. Does every `it()` contain an assertion? Enforce it in the test command.
2. Does any assertion expect *nothing*? Pair it with proof the action happened.
3. Did you read the **output**, or only the exit status?
4. Does your wrapper carry the child's stderr up with the status?
5. Are the fixtures real recordings, and do they contain the *shapes* that break things — not just
   real values?
6. Has each guard been seen failing at least once?
7. When did anyone last exercise the actual application, rather than the suite?
