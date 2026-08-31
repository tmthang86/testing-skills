# False greens — when the suite passes and proves nothing

A red test is information. A green test is information **only if it could have been red.** Most of
the ways a suite lies are invisible in its own output, because a suite that asserts nothing and a
suite that asserts everything print the same word.

Everything below was measured, not researched. Cases 1–9 come from a real desktop application over
about a week — a Tauri app with a WebDriver suite, a Rust test suite, and live API tests. Cases
10–19, and two of the additions to §5, come from a second system with no UI at all: a FIX protocol
engine, whose end-to-end tests drive real bytes through a real socket. Each case cost hours before
it was understood, and each one had been green — or red for the wrong reason — the whole time.

**That the two sources agree is the useful part.** A wire protocol has no screenshots, no locators
and no browser, and the same shapes turn up anyway. These are not browser problems.

Cases 14–19 are the later half of that second batch, and they share a pattern worth stating before
the details: **in seven of the eight incidents behind them, the code was correct and the evidence
was broken.** Not one was found by re-reading code. Every one was found by running something and
looking at what came back. They also turn the document around — 1–13 are ways a **green** means
nothing; 14 onwards are ways a **red**, or a gate's own red half, means nothing either.

## Table of contents
- [1. The test that never asserted](#1-the-test-that-never-asserted)
- [2. The vacuous wait](#2-the-vacuous-wait)
- [3. Exit status is not the result](#3-exit-status-is-not-the-result)
- [4. Fixtures that agree with the bug](#4-fixtures-that-agree-with-the-bug)
- [5. A guard nobody has seen fail](#5-a-guard-nobody-has-seen-fail)
- [6. The screenshot that photographed something else](#6-the-screenshot-that-photographed-something-else)
- [7. The report that only speaks when it fails](#7-the-report-that-only-speaks-when-it-fails)
- [8. The more accurate measurement that changed nothing](#8-the-more-accurate-measurement-that-changed-nothing)
- [9. The precondition the suite cannot create](#9-the-precondition-the-suite-cannot-create)
  - [9a. The precondition the environment quietly declines to provide](#9a-the-precondition-the-environment-quietly-declines-to-provide)
- [10. The knob that moved with the fix and was not the cause](#10-the-knob-that-moved-with-the-fix-and-was-not-the-cause)
- [11. The check nobody ran](#11-the-check-nobody-ran)
- [12. Fifteen out of sixteen](#12-fifteen-out-of-sixteen)
- [13. Two instruments that could not see what they were aimed at](#13-two-instruments-that-could-not-see-what-they-were-aimed-at)
- [14. The negative result that was negative for the wrong reason](#14-the-negative-result-that-was-negative-for-the-wrong-reason)
  - [14a. The red half of your own gate](#14a-the-red-half-of-your-own-gate)
- [15. The configuration under test was never built](#15-the-configuration-under-test-was-never-built)
  - [15a. The harness that verified the result without verifying the selection](#15a-the-harness-that-verified-the-result-without-verifying-the-selection)
- [16. The number came from the label, not the measurement](#16-the-number-came-from-the-label-not-the-measurement)
- [17. The test that assembled the thing it was checking](#17-the-test-that-assembled-the-thing-it-was-checking)
  - [17a. The test's own comment is not evidence](#17a-the-tests-own-comment-is-not-evidence)
- [18. The identifier the test had already given back](#18-the-identifier-the-test-had-already-given-back)
- [19. Green because the runtime was masking it](#19-green-because-the-runtime-was-masking-it)
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

**The extreme form is a suite measuring a system that is no longer there.** Measured on the
protocol engine: an allocation benchmark reported *1 allocation per 1000 iterations* — close enough
to zero to look like a rounding artefact, and stable across runs, which made it look real. The
component under test had rejected the second message and torn the connection down, so from iteration
three the loop was pushing into a queue nobody read. Two hours went into looking for that one
allocation in code that never ran.

A zero means *did not happen* only when something separately proves *did run*. Every case in those
benchmarks now asserts its own path is still live at the end of the count — `the send path sends`,
`must still hold a live session` — which is the same pairing as the rule below, applied to a
component rather than to an input.

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

Seven distinct instances in one project, all of the same shape: **something reported success over a
failure underneath it.**

| Reported success | Actually true |
|---|---|
| A test binary exited **0** | a worker thread had panicked; the process survived because the panic was on a detached task |
| A wrapper script exited **0** | it ended in `echo`, which overwrote the `124` from the timeout above it |
| `$?` read **0** after a pipeline | it was the exit status of `head`, not of the command under test |
| A harness printed **PASS** | its own failure path had run; the caller read the wrapper's status |
| A validator printed **FAILED** | it *did* exit 1 — but the reader had checked `$?` after a pipe again |
| A subprocess helper threw `Command failed: <argv>` | the child's stderr said *which* refusal it was, and the wrapper discarded it |
| An **agent harness** reported a backgrounded command as **exit 0** | the command had been piped into `tail` to keep the log short, so the reported status was `tail`'s; the captured output itself said `at least one suite failed` |

Two of these are worth singling out. The subprocess one was written the same afternoon by someone
who had just written the earlier five down.

The last one is a **new vector for the old shape, and it is specific to agent-driven work.** A
harness that runs a command in the background and reports its exit code reports the status of the
whole pipeline — so any `| tail`, `| head` or `| grep` added for log-tidying purposes silently
becomes the thing whose status is reported. The convenience and the defect are the same keystroke.
Redirect to a file and read it (`cmd > out.log 2>&1`), or set `pipefail`; do not pipe a command
whose status you intend to trust.

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

**Two things about reversals that only show up once you run a lot of them.** Both were measured
while promoting a set of ratcheted style guards to blocking, which meant re-proving six at once.

*A reversal can itself be a no-op.* One of the six reported PASS. That looks exactly like a guard
that cannot fail, and the wrong conclusion is one keystroke away. The truth was that the
search-and-replace introducing the violation targeted a string that did not exist in the file, so
nothing was inserted and the guard was correctly reporting a clean tree. **Assert that the violation
exists before you judge the guard** — grep for it, or diff the file. Otherwise a reversal proves the
same nothing that a green test over an empty result set proves, which is the failure this whole
document is about, arriving one level up.

*A reversal that passes is usually a hole in the TEST, not proof of the code.* A hand-written PNG
decoder had its Paeth-filter tie-break inverted — a one-character change — and all four of its unit
tests stayed green. Ties only arise for particular byte triples, and the fifteen hand-picked pixels
in the fixtures produced none. A brute force over all 2²⁴ triples found 43,180 where the correct and
inverted versions disagree: 0.26% of the space, which on a megapixel image is thousands of wrong
pixels. The fix is a fixture that contains the case, not a shrug. **When a reversal passes, the next
question is "what input would make this matter, and is it in my fixtures?" — not "I guess it's
fine."**

**Two more ways a reversal inserts nothing, both measured on the protocol engine, both of which
reported PASS.** They matter because the search-and-replace case above suggests the fix is "check
your string" — and neither of these is a string problem.

*The compiler deleted it.* A counting allocator reported zero allocations on a hot path. The
reversal injected an allocation to prove the counter could see that path; it still reported zero.
The optimiser had removed the injected allocation, because nothing consumed its result. An
injection has to be **observed to have happened**, not merely written: use a value the optimiser
cannot prove dead, and assert the counter moved before trusting the zero.

*A formatter moved the target.* A replacement of `.max()` with `.min()` silently failed to apply,
because an auto-formatter had joined the expression onto one line since the file was last read and
the multi-line search string no longer matched. The guard reported PASS. Nothing had been injected.

Both collapse to one habit, and it is cheap: **after injecting, `grep` for the violation and assert
it is present, before you read the result.** Do it every time, including — especially — when you
are the person who just wrote the paragraph telling other people to do it. The author of this
addition was caught by the formatter case while quoting this very section in three commits.

Occasionally a passing reversal is genuinely fine, and saying so is better than manufacturing a
failure. In the same session, reverting one of two related fixes left the suite green because the
second fix made the measurement robust to what the first one prevented. That is worth one sentence
in the docs — *this fix is correctness, not what carries the check* — rather than a claim that both
were load-bearing.

## 6. The screenshot that photographed something else

Screen capture is the instrument people reach for when a check has to happen outside the page —
first-paint behaviour, a native dialog, a focus ring, a theme flash. It has three failure modes, and
all three return **exit 0 and a real PNG file**. Nothing in the artifact says which one you got.

### 6a. The display was asleep, so every pixel is black

A capture taken while the display sleeps or the session is locked succeeds and returns a uniformly
black image. Read as a screenshot of the application, it says the window painted nothing.

Measured: `screencapture -o -x out.png` → exit 0, a 3024×1964 PNG, every channel's extrema `(0, 0)`.
The application was running normally the whole time.

**The check is one line, and it belongs in the harness rather than in the reader's judgement:**

```python
extrema = Image.open(path).convert("RGB").getextrema()
if all(lo == hi for lo, hi in extrema):
    raise RuntimeError(f"uniform capture {extrema} — display asleep or locked, not evidence")
```

A uniform frame of *any* colour is the tell, not black specifically. Assert variance before you
assert content.

### 6b. The window was behind another application

A capture loop that polls for the process — rather than for the *window being visible* — starts
firing as soon as the pid exists. If anything else is frontmost, every frame is a photograph of that
other application, sampled at coordinates that used to be inside your window.

Measured: 24 frames captured during an application launch, every one returning pure white at both
sample points. The frames were of a presentation tool behind the target. The relaunched window had
also moved — `(136, 66) 1280×820` rather than where the previous run left it — so coordinates
recorded from an earlier session pointed outside it.

Two habits fix it, and the second matters more:

- Query the window's real rectangle at capture time; never reuse coordinates across launches.
- **Assert the target is frontmost, per capture, not once at the start.** Focus is lost between
  events. A driver that refuses when its target is not frontmost — naming what *is* frontmost —
  turns this from silent bad data into a failure you can read:

  ```
  driver: could not bring "myapp" to the front (frontmost is "Code") — refusing to send input
  exit=1
  ```

### 6c. The camera is slower than the event

This is the one that produces the most confident wrong conclusion, because the frames are genuine,
the window is visible, and the transient simply never appears in any of them.

Measured: 24 captures spanning 12.2 seconds — a cadence near **500 ms** — pointed at a
theme-flash lasting perhaps one frame at 60 Hz, about **16 ms**. The instrument was roughly thirty
times too slow to see what it was aimed at. "No flash observed across 24 frames" is not evidence
that no flash occurred; it is evidence that this instrument cannot answer the question.

**Do the arithmetic before running the loop.** Divide your capture cadence by the event's expected
duration. If the ratio is not comfortably below 1, the loop cannot answer, and a faster loop usually
cannot either — reach for an in-process instrument instead: a paint-timing mark, a recorded video at
a known frame rate, or an assertion made from inside the application at the moment in question.

### Why these are one case and not three

All three end with a file on disk, a zero exit status, and a human concluding something. The shared
defect is that **a capture's success says nothing about what it captured.** Every screenshot-based
check needs its own guard: variance for 6a, a window rectangle plus a frontmost assertion for 6b,
and cadence arithmetic for 6c.

## 7. The report that only speaks when it fails

Most guards, linters and conformance scripts print per-item detail **only on failure** and a single
summary line when they pass. That is good output design and a trap for the person using the tool to
verify their own work.

Measured: migrating a 313-finding style debt across five files, one file at a time. After finishing
the second file, the check was run, its output grepped for that filename, nothing came back, and the
file was reported clean. The grep proved nothing — the report is silent about every file when it is
passing, so an absent filename is silence, not evidence. The number happened to be right and the
evidence was empty.

**The fix is a measurement that speaks whichever way it goes.** Re-running the tool's own patterns
per file, before and after, turns "no news" into a number. It also turned out to be the single most
useful thing done in that migration for a different reason: it showed all 313 findings lived in five
files and every other file was already clean, which is what made an unbounded task into five bounded
ones.

Generally: **before believing a tool's silence, check whether the tool speaks when the answer is
"nothing here" or only when the answer is "something is wrong."** Many report the second only.

## 8. The more accurate measurement that changed nothing

You replace an approximation in a check with something more accurate — a properly composited colour
instead of a declared one, a real device pixel instead of a CSS pixel, the actual served response
instead of a fixture. The suite passes. The natural reading is that the system was conformant all
along under the stricter measurement.

The other reading, which is more often true: **the accurate input never reached the computation.**

Measured: a contrast check was extended to composite against a backdrop layer that the old
measurement could not see. It passed on all ten themes. A counter added out of suspicion reported
`ground reached 0 of 50 measurements` — every ratio was byte-identical with and without the new
input, because a later step in the compositing overwrote it. Fifty green assertions, none of them
about the thing the change was for. Once fixed, the same check failed three of the fifty.

**The guard is one line and belongs in the test permanently:** count the results the new input
moved, and assert that count. `expect(changed).toBe(total)` where every case should be affected, or
`expect(changed).toBeGreaterThan(0)` where only some should. An accuracy improvement that produces
identical numbers is a claim that needs evidence, not a result that needs celebrating.

## 9. The precondition the suite cannot create

A suite asserts an **absence** — no stored credential, no cached file, no granted permission, no
prior install. On a clean machine it is green. On a developer's machine, or the second time it runs,
the thing is present and the suite goes red.

The tempting fix is to make the setup delete it. Often the suite **must not**: deleting a real
credential signs a person out of the real application, revoking a permission re-triggers an OS
dialog, clearing a cache destroys work. So the precondition stays unenforceable, which is a
legitimate choice.

**The defect is not the unenforceable precondition. It is that the failure does not name it.** What
the assertion reports is a component:

```
expect(count("account-expired")).toBe(0)     Received: 1
expect(label).toBe("Sign in")                Received: "Session expired"
```

Read cold, that is a product bug, and it sends whoever reads it into the application code. The real
cause is one sentence long and lives nowhere near the assertion.

**The rule: a precondition a suite cannot enforce belongs in its failure message, not only in its
documentation.** Check it explicitly in `before`, and fail with the remedy:

```js
before(async () => {
  if (await credentialExists()) {
    throw new Error(
      'precondition: a stored session exists, and these specs assert the signed-out state. ' +
      'This suite will not delete it — sign out in the app, or remove it manually, then re-run.'
    )
  }
})
```

Two things that make this worse and are worth checking for:

- **The application may have no path to the required state.** In the case above, the app had reached
  a state whose only offered remedy was to sign in again — there was no control that discarded the
  dead credential. So the instruction "sign out and re-run" was impossible to follow, and the suite
  was unfixable from the interface. **When you write the remedy into the failure message, verify the
  remedy is reachable**; that verification is how the product defect was found at all.
- **A suite skipped for being "flaky on my machine" is deleted, just slowly.** State-dependent red
  is the most common reason a suite stops being run, and it looks identical to genuine flake from
  the outside.

### 9a. The precondition the environment quietly declines to provide

The case above is a precondition the suite *may not* create. This is its mirror: one the suite
*believes it has* created, on a platform that did not oblige — and here the failure mode is green,
not red.

The shape: a test fabricates a condition in order to assert how the code reports it. The condition
is not created by the test's own code but **granted by something underneath it** — a filesystem, a
clock, a locale, a codec, a permission model. If that layer declines, the fabrication silently
becomes something else, and the assertion may still pass for a reason that has nothing to do with
the code under test.

A worked example. A screen must report a file's *allocated* size rather than its *apparent* size —
the two diverge for sparse files, and the whole point of the feature is that a file which looks
like 21 GB may occupy 800 MB. To test it, plant a sparse file: write a little, extend the length a
lot. Then assert the screen shows the small number.

On a filesystem without sparse-file support, the extension is materialised. Apparent and allocated
are now **equal**, and the assertion "shows the small number" is satisfied by code that reports
either one. The test is green and the distinction it exists to defend is untested. Nothing reports
that the platform changed the subject.

**The rule: assert the condition, not only the outcome.** One line, before the code under test is
ever reached:

```js
const stat = statSync(planted)
expect(stat.size).toBe(APPARENT)                       // the fabrication took
expect(stat.blocks * 512).toBeLessThan(stat.size / 100) // ...and it is genuinely sparse
```

Now a platform that does not do sparse files fails **saying so**, instead of blaming — or
absolving — the application. The measured ratio on the machine where this was written was 2,543x;
asserting a loose bound rather than an exact figure keeps the check portable while still being
impossible to satisfy by accident.

Ask it of any fabricated precondition: **if the layer beneath silently refused, would this test go
red — or would it go green for the wrong reason?** Where the honest answer is the second, the
condition needs its own assertion. Related: a fabricated *input* that agrees with the bug is §4;
this is a fabricated *environment* that agrees with either answer.

## 10. The knob that moved with the fix and was not the cause

A test scored 39 out of 59 on one machine and 59 out of 59 on another. The harness decided an
exchange had settled after 200 consecutive polls that moved nothing, so that constant was the
obvious suspect. Turning it up walked the score:

| settle bound | score |
|---|---|
| 200 | **39 / 59** |
| 2 000 | **43 / 59** |
| 20 000 | **59 / 59** |

Monotonic, reproducible, and with an explanation that wrote itself: *a poll count measures the CPU,
not the network.* That went into a status page, a README, two design documents and a pull request
**within the hour, each restating it as settled.**

It was wrong. The cause was **Nagle's algorithm on the test harness's own client socket.** One
message in the corpus deliberately produces no reply, so no outbound segment carried a piggybacked
ACK, the peer's delayed ACK held for tens of milliseconds, and every subsequent small write queued
behind the unacknowledged one. Four messages arrived as a single read. **The longer timeouts were
outwaiting the delayed ACK**, which is why the score responded to them.

The experiment that settles it is a 2 × 2, one run per cell:

| | Nagle on | `TCP_NODELAY` set |
|---|---|---|
| poll count, 200 | **39 / 59** | **59 / 59** |
| wall-clock bound | **39 / 59** | **59 / 59** |

The suspect moves nothing in either direction. The real cause moves everything in both. Removing
the one-line fix returns the score to exactly 39 — which is what makes it a reversal and not a
story.

**A number that responds to a knob is evidence that something is being waited on. It is not
evidence about what.** The next move is a trace, or a single-variable table, not a third value of
the knob. That table cost four runs and would have refuted the wrong answer before any of the five
documents were written.

### And the specific trap underneath it

**The system under test was configured correctly and the harness was not.** The engine had set
`TCP_NODELAY` on every socket it accepted since the day it was written. The test client never set
it, which made the rig the only misconfigured peer in the exchange — so the suite was measuring a
network condition the product does not have in production.

Worth asking of any harness that stands in for a real peer: **which options does the real
counterparty set that this fake does not?** Socket options, timeouts, keep-alives, TLS versions,
compression, retry policy. Every difference is something the suite can measure that the product
will never experience, or miss that it will.

## 11. The check nobody ran

§3 is about reading a result rather than an exit status. This is the layer beneath it: **an
assertion that no automated thing executes at all.**

Measured: a benchmark asserting a performance ceiling had been failing on every Linux machine since
it was written, and **nothing had ever reported it.** The project's test command does not run
benchmark targets, and no CI job invoked the benchmark runner. It was found by hand, months later,
by someone running it while doing something else.

The assertion was real, well-written, and had a good failure message. It was, functionally, a
comment.

The same shape reaches targets as well as guards. Measured on a different project: a benchmark
carried `// Target: <= 80 ns` above a case that measured **565 ns**. The target was written as a
comment, so nothing read it and nothing failed when it was missed by 7x. **A target only a human can
check is not a gate**, and it is indistinguishable from one that is until someone does the
arithmetic by hand.

**The check to run is not on your code. It is on your pipeline.** Take the list of commands CI
actually invokes and the list of guards you believe you have, and cross them off against each other.
Anything in the second list that is not reachable from the first is documentation. This costs ten
minutes once and is the only way to find guards that were never wired up — no amount of reading them
will, because they look exactly like guards that run.

### The same defect one level up: the result nobody read

The other half is a check that runs, reports, and is not looked at. Measured, on the same project:
CI had been failing on the main branch for a day. The merge that broke it reported its own checks
green — **truthfully**, from a developer machine. CI disagreed within the minute and no one opened
the tab, so four documents carried the laptop's number.

A local run says the checks pass **for you**. Only CI says they pass **for the commit**. If a
project's definition of done does not require naming a specific green pipeline run, it will
eventually ship on a laptop's word.

### A red that is not yours either

The mirror image is worth naming because it burns a morning: a build that goes red **with no commit
behind it.** Measured: a lint suite pinned to "latest stable" turned a repository red when the
toolchain released a new rule. Nothing had changed in the code.

`-D warnings` — or any "fail on anything the tool disapproves of" — against an unpinned toolchain is
a scheduled outage. Pin the toolchain and upgrade deliberately, and run the newest one in a
**separate job that is allowed to fail**, so the next new rule arrives as a warning to read at the
time it appears rather than as a mystery later.

## 12. Fifteen out of sixteen

§4 is about fixtures that agree with the bug. This is its close relative and it is harder to see,
because the fixtures are fine: **the set they are drawn from is skewed, so a wrong rule satisfies
almost all of it by coincidence.**

Measured: a wire format has sixteen field pairs where one field states the length of another, and
the length must be written immediately in front. **Fifteen of the sixteen** happen to number the
length one below the data, so ordering fields by ascending number placed them correctly — by
arithmetic accident. The sixteenth does not, and it was emitted in the wrong order: unreadable by
any receiver.

Every example anyone would write by hand passes. The one broken pairing is not one a person reaches
for. And the project's own round-trip test *skipped* that entire class of field with a comment
saying it was "a different test" — and it was tested nowhere.

**When a rule is derived from a set, enumerate the set and check the rule against all of it.** That
took one script. The general form is a question to ask of any rule that looks like a pattern:

- How many members of the set does this rule cover, exactly?
- Which members satisfy it for a *different* reason than the one I am relying on?
- Is the case that breaks it in the fixtures, or does it merely exist?

A rule that holds for 15 of 16 by coincidence and 16 of 16 by design produces identical test
results. The difference only shows on the member nobody chose.

## 13. Two instruments that could not see what they were aimed at

§6 is about a screenshot that photographed the wrong thing. This is the same defect in tools that
take no picture at all: **an instrument that structurally cannot observe the property, reporting
success.**

Measured, on one rule — *this thread never blocks* — over two attempts, both of which passed:

- **The platform refused the instrument.** A syscall tracer was pointed at the process. The
  operating system's own integrity protection declined to attach, so it never ran. The wrapper
  reported no blocking calls, which was true and meaningless.
- **The instrument could not see the code.** Reading undefined symbols out of the compiled library
  showed no blocking calls — and still showed none **with a sleep added to the loop**. The code in
  question was generic and had never been instantiated into that library at all, so there was
  nothing there to find, sleep or no sleep.

Both were deleted rather than shipped. What replaced them traces a **concrete binary**, attributes
the calls to the specific thread by id — the other thread blocks on purpose and would mask
everything — and **runs the binary a second time with the blocking version deliberately switched on,
failing if that run does not trip the check.**

The general rule: **an instrument you have only ever seen agree with you is not known to work.** Ask
of any new one, before trusting it:

- Did it actually attach, run, or open the thing — or did it silently decline?
- Is the property it examines even present in what it examined? Generic code, dead-stripped code and
  inlined code are absent from artefacts that appear to contain them.
- What is the concrete change that should make it fail, and does it?

## 14. The negative result that was negative for the wrong reason

Everything in this document so far is about a **green** that means nothing. This is its mirror, and
it is worse, because a red result feels like it has already been interrogated.

A negative test — `expect(...).toThrow()`, `assertRaises`, a `compile_fail` case, an HTTP-4xx
assertion, the deliberately-broken arm of a reversal — passes when the thing under test fails **for
any reason at all.** Nothing checks that it failed for *your* reason.

Measured: a compile-time assertion was added to refuse an invalid pairing of two types, with a
`compile_fail` doctest to prove the refusal was live. The doctest passed on the first run. It was
passing because the example had a **different** mistake in it — a malformed generic argument that
failed type resolution long before reaching the assertion. The refusal under test had never been
exercised. The fix was to read the actual compiler output, confirm it named the intended message,
and then pin the error code so the test could not drift onto a different failure:

```rust
/// ```compile_fail,E0080     // the code, not just "this must not compile"
```

Most ecosystems have the equivalent and most people skip it: `pytest.raises(ValueError,
match="...")` rather than bare `raises`, `toThrow(/specific message/)` rather than `toThrow()`,
asserting the status *and* the error body rather than `res.status >= 400`.

### 14a. The red half of your own gate

The sharper version. A gate that runs the system twice — once expecting a pass, once expecting a
failure — is only as good as its ability to tell **"failed the policy"** from **"could not be
measured."** If both come back as the same non-zero, a completely broken harness reports exactly
what a working one reports.

Measured: a gate ran a server in three modes, asserting one should pass and two should fail. A typo
in the measurement code — a missing pair of braces in a shell arithmetic expansion — broke every
measurement in all three arms. The output read:

```
GREEN half:  FAIL: does not satisfy the policy      ← nothing was measured
RED half:    RED ok — trips it, as it must          ← nothing was measured
RED half:    RED ok — trips it, as it must          ← nothing was measured
```

Two of the three lines are the ones you *want* to see. Only the first suggests anything is wrong,
and it looks like an ordinary failure of the thing under test.

**The fix is two exit codes, not one.** Separate the verdict from the measurement:

```
0  the subject satisfied the policy
1  the subject did NOT satisfy the policy   ← the only thing a red half may accept
2  the measurement did not happen           ← never evidence of anything
```

Then the green half requires 0, each red half requires exactly 1, and a `2` anywhere aborts the
whole gate saying so. This is §5 arriving one level up: *a reversal can itself be a no-op*, and a
gate's built-in red half is a reversal that runs on every CI push for ever.

## 15. The configuration under test was never built

A flag, feature, profile or environment variable selects the thing you mean to test. The suite runs.
The flag never took effect, and nothing anywhere says so.

Two shapes, measured a few hours apart in the same codebase, failing in opposite directions.

**Widened scope — a neighbour switched it back on.** A CI job called *"builds with nothing optional
installed"* ran the build tool's `--no-default-features` across the whole workspace. That flag
applies to the *invocation*, and the tool then unifies features across everything in it — so a
sibling binary in the same workspace, which depends on the library with defaults on, silently
re-enabled the feature under test. The optional dependency was compiled every time. The job had been
green about a build that never happened.

It was noticed by a **test count**, not by the gate: a `cfg`-gated test file should have vanished,
so the run was expected to report four fewer tests and reported the same number. **Had the new
module carried no tests of its own — the ordinary case — the counts would have matched and nothing
would have pointed at it.**

**Narrowed scope — the condition was simply false.** In the same session, a command-line tool grew a
`--mode` flag whose branches sat behind `#[cfg(feature = "x")]`. Features are per-crate and a `cfg`
never reaches into a dependency's, so the binary's own manifest — which declared no features at all
— made the condition false, every branch took its `else`, and the tool **accepted the flag, printed
`mode: standard`, exited 0, and ran nothing.** The banner prints before the branch; the only tell
was an absent block of output further down.

The build tool had been warning on that exact line the whole time. What actually caught it was
running the tool and reading what came back.

**Three rules:**

- **Ask about the configuration, not about the test result.** "Is this dependency in the graph with
  no features on?" is a question with a direct answer; "did the tests pass?" is not that question.
  Run it **per package**, which is usually the only scope where such a flag means what it reads as.
- **When a check cannot tell, it must fail.** That gate had a third branch printing *"could not
  tell"* and exiting non-zero. It fired the moment the dependency was later added as a *dev*
  dependency and the tool's message changed — and failing was right, even though the answer was
  benign, because a check that cannot tell must never report ok.
- **Make the subject state which arm it took, and check the statement.** See §15a.

### 15a. The harness that verified the result without verifying the selection

Any A/B gate — two modes, two algorithms, two configurations — rests entirely on arm B being
different from arm A. Almost none of them check.

The gate above ran the same binary twice with different `--mode` values and compared the behaviour.
Had it existed one day earlier, it would have been **green about two runs of the identical mode**,
because the flag was inert.

The fix is cheap and belongs on both sides. The subject prints what it selected, on its own line:

```
mode: standard
```

and the harness reads it back and refuses when it disagrees with what it asked for:

```
w2w ran mode 'yield' when 'hft' was asked for      exit=1
```

Proven by reversal: ask for one mode, pass the flag for another, watch the harness refuse. Without
that, "I passed the flag" is an intention, not an observation.

## 16. The number came from the label, not the measurement

Two incidents, one shape: **a figure that was parsed out of text and never was the thing it claimed
to be.** Both passed every assertion made about them.

**A count that was the pager's.** A test suite's result was reported as *"30 test binaries"*. There
were 48. The command had ended in `| head -30`, added to keep the log readable, and the number was
arrived at by counting the surviving lines. Nothing was broken, which is exactly what made it
survive: a truncated pass looks identical to a complete one.

**A value that was part of its own label.** A gate extracted a latency percentile from a report line
that reads:

```
     p50        17664 ns
```

with `grep -oE '[0-9]+' | head -1` — which returns **50**, the digits in the label `p50`, because
that is the first run of digits on the line. The assertion compared 50 against its ceiling of
1,000,000 and passed. That assertion was the *only* one in a four-assertion gate capable of
distinguishing the failure the gate existed to catch, and it had been comparing a constant with a
constant.

**The tell was available and nearly missed: the same value appeared in all three arms.** Three
different runs of three different modes reported a p50 of exactly 50 ns. Numbers that should differ
and do not are the cheapest anomaly detector there is, and it only works if the harness *prints*
them — see §7.

**Two rules:**

- **Extract by position or by name, never by "the first number on the line."** `awk '{print $2}'`,
  a named capture group, or structured output. Regexes that scan for digits will find the ones in
  your own labels — `p50`, `http2`, `sha256`, `utf8`, `v2`.
- **Never pipe a command whose count you intend to trust.** Redirect to a file and count that. The
  same keystroke that tidies the log invents the number (see also §3, where the same pipe invents
  the exit status).

## 17. The test that assembled the thing it was checking

A test that builds its own expected state, and then asserts the state is what it built, is checking
itself.

Measured: a server had to register a listening socket in the set of things it waits on — forget it,
and new connections are accepted a whole timeout late instead of immediately. The test read:

```rust
let mut list = engine.refresh_interests().to_vec();
list.push(Interest::readable(listener));       // the test puts it in
assert!(list.contains(&Interest::readable(listener)));   // ...and finds it
```

It passed. It also passed with the *production* line that adds the listener **deleted** — because
the test never went near that code. It was named after a behaviour it did not exercise.

The fix was to expose the exact call the production path makes, and route the test through it. Then
deleting that line turns it red.

**The question to ask of any test: which line of production code, if deleted, makes this fail?** If
you cannot name one, the test is a description. This is the reason §5's reversal discipline exists,
and it is worth applying at the moment a test is *written* rather than only when a guard is
promoted.

### 17a. The test's own comment is not evidence

The same test carried a doc comment claiming it would also catch *wiring* failures — that a missing
registration would show up as the run taking minutes instead of seconds. Three timings refuted it:
baseline **3.28 s**, the wiring deliberately broken **3.30 s**, a second wiring fault **3.34 s**.
The settle criterion was shorter than the timeout, so one wait satisfied it whether it had been
woken early or not, and the harness could not tell those apart.

The test was fine. Its documentation was wrong, and documentation is the part nobody reverses.
**When a test claims to catch a class of bug, introduce that bug once and watch.** Then write down
what it actually catches, including the part it does not.

## 18. The identifier the test had already given back

A test released a resource and then asserted something about its identifier. It passed 30 times and
failed on the 31st — the first cold run.

Measured: the test closed a socket and asked the kernel about its file descriptor, expecting *"no
such descriptor."* Descriptor numbers are reused eagerly, lowest-free-first, and several other tests
in the same binary were opening sockets on other threads. When one of them was handed that number,
the descriptor was valid, live and quiet — and *quiet* is indistinguishable from *closed* at that
layer, which was precisely the distinction under test. The green depended on thread scheduling.

The failure location named the branch, which is what made it diagnosable in one read rather than one
afternoon.

**The class is bigger than descriptors:** process ids, TCP ports, temporary filenames, database row
ids, session tokens, cache keys, container names. Anything an allocator hands back and later hands
out again.

**Two rules:**

- **Do not assert about an identifier you have released.** Ask about one that can never have been
  issued — a descriptor above any plausible limit, a port in a reserved range, a UUID you invented.
  The rewritten test asked about `i32::MAX` and failed 0 times in 40 runs.
- **A flaky guard is worse than a missing one, and the fix is never a retry.** A retry converts a
  real signal into a slower green. Remove the mechanism that makes it racy.

## 19. Green because the runtime was masking it

A defect that cannot be reproduced from inside your test process, because your language runtime is
suppressing exactly the thing that would reveal it.

Measured, and found by a review bot rather than by any suite: a server handed out handles that other
threads used to wake it. When the server was dropped while a thread still held a handle, that
thread's write went to a pipe with no reader — which raises `SIGPIPE`, whose default action
**terminates the process.**

Every test passed. Rust's runtime sets `SIGPIPE` to `SIG_IGN` before `main`, so inside a test binary
the write merely returns `EPIPE`, and the return value was being deliberately ignored. **This is a
library**: loaded into a host that does not do that — a C program, or a `main` that restores the
default — it kills the process. Reproduced only after restoring the default disposition explicitly:

```
process didn't exit successfully  (signal: 13, SIGPIPE: write on a pipe with no one to read)
```

The test that proves it lives in **its own test binary**, because changing a process-global signal
disposition must not be done to the rest of the suite.

Neighbouring things a runtime hides from your tests: default signal dispositions, an allocator that
zeroes freed memory in debug builds, a panic hook that turns an abort into a caught unwind, a test
framework that swallows `stderr`, a `Drop` order that only differs under optimisation.

**And the second lesson is not about signals.** The unsafe block at fault carried a written
justification, and it was correct — it proved the pointer was live, the length right, nothing
retained. It said nothing about the **signal** contract, because that is a different kind of
soundness and nobody had asked for it. *A justification can be true, well-written, reviewed, and
about the wrong property.* When a comment exists to make an escape hatch believable, name the
property it establishes — and then ask which other properties that hatch needed.

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
8. If a check reads a screenshot: is the frame non-uniform, was the target frontmost when it was
   taken, and is the capture cadence actually faster than the event being looked for?
9. When a tool reported nothing about your file — does that tool say anything at all when the answer
   is "nothing here"?
10. When you made a measurement more accurate, how many results did it change? If none, prove the
    new input is reaching the computation.
11. When you reversed a guard: did the violation actually land in the file, and if the reversal
    passed, what input would make it matter?
12. For every condition the test fabricates rather than computes — a sparse file, a stale clock, a
    locale, a denied permission: if the layer beneath silently refused, would this go red, or green
    for the wrong reason? Assert the condition, not only the outcome.
13. Did the harness launch the artefact the build just produced, or one that something else can
    also write?
14. Does the suite assume any state it does not create — an absent credential, an empty cache, an
    ungranted permission? If it cannot create it, does the **failure message** say so and name a
    remedy you have confirmed is reachable?
15. Is every guard you believe you have reachable from a command CI actually runs? Cross the two
    lists off against each other; anything unreachable is a comment.
16. Does your definition of done name a specific green CI run, or does a local pass count? A laptop
    says the checks pass for you; only CI says they pass for the commit.
17. When a number responds to a knob, did you establish what is being waited on — or did you assume
    the knob? One single-variable table beats a third value of the knob.
18. Which options does the real counterparty set that your harness does not? Every difference is a
    condition the suite measures and production never has, or misses and production does.
19. When a rule is derived from a set, does it hold for the whole set, or for most of it by
    coincidence? Enumerate; the case that breaks it is the one nobody reaches for.
20. Does any target live in a comment? Nothing reads a comment, and a missed one looks exactly like
    a met one.
21. For any new instrument: did it actually attach and run, is the property present in what it
    examined at all, and what concrete change makes it fail?

And before believing a **red** one, or a gate that contains its own red half:

22. Does every negative assertion pin the *reason* — the error code, the message, the exit status —
    or does it accept any failure at all?
23. Can your harness tell "the subject failed the policy" from "the measurement did not happen"? If
    those share an exit code, a broken harness reports exactly what a working one reports.
24. Did the flag, feature or profile you selected actually take effect? Ask about the configuration
    directly, per package, rather than inferring it from a passing suite — and have the subject
    state which arm it ran so the harness can check the statement rather than its own intent.
25. Was every number you are reading parsed by position or by name? A regex that takes the first
    digits on a line will happily return the ones inside `p50`, `http2` or `sha256` — and a `| head`
    added to tidy the log will invent a count the same way it invents an exit status.
26. Which single line of production code, if deleted, makes this test fail? If you cannot name one,
    the test may be asserting about state it assembled itself.
27. Does the test assert about an identifier it has already released — a descriptor, a port, a pid,
    a temp filename? Those get reissued, and the reissued one is usually quiet enough to pass.
28. Is your runtime hiding the failure from the test — an ignored signal, a swallowed `stderr`, a
    caught panic? A library cannot assume its host makes the same choice its test binary does.
29. When a comment exists to make an escape hatch believable, which property does it actually
    establish, and which properties did that hatch also need?
