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
- [6. The screenshot that photographed something else](#6-the-screenshot-that-photographed-something-else)
- [7. The report that only speaks when it fails](#7-the-report-that-only-speaks-when-it-fails)
- [8. The more accurate measurement that changed nothing](#8-the-more-accurate-measurement-that-changed-nothing)
- [9. The precondition the suite cannot create](#9-the-precondition-the-suite-cannot-create)
  - [9a. The precondition the environment quietly declines to provide](#9a-the-precondition-the-environment-quietly-declines-to-provide)
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
12. Does the suite assume any state it does not create — an absent credential, an empty cache, an
    ungranted permission? If it cannot create it, does the **failure message** say so and name a
    remedy you have confirmed is reachable?
