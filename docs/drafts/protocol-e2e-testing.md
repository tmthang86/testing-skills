# End-to-end against a protocol, not a screen

> **Draft, and deliberately not wired into any skill.** This is content for
> [ROADMAP](../ROADMAP.md) open item 7 — the proposed `protocol-e2e-testing` sibling skill. It lives
> in `docs/drafts/` rather than under `plugins/e2e-testing/.../references/` because item 7's own
> design decision is **"one skill owns one medium"**: adding it as a sixth row to the `e2e-testing`
> router would settle that question by accident. Nothing triggers on this file and nothing links to
> it from a `SKILL.md`. It is here so the material is reviewable while the placement is decided.
>
> It reads as though it were already a reference of that skill — "everything else in this skill" —
> because that is what it is written to become.

Everything else in this skill drives a user interface. This is the same loop with the screen taken
away: the system under test speaks a wire protocol, and the test is a peer that connects to it,
sends bytes, and reads what comes back.

Server, daemon, broker, gateway, game backend, message bus, database wire front end, anything whose
customer is another program. If it has no UI, this is the file.

**The loop is unchanged. Four things change**, and each of them is where the false green comes from:

| | UI | Protocol |
|---|---|---|
| Ground the locator | snapshot the live page, never guess a selector | frame the bytes, never assume one read is one message |
| Know when to assert | wait for an element / network idle | **settle** — and settling is a hard problem, see below |
| Know the right answer | a human decided what the screen should say | often a **corpus** exists that already decided |
| The one thing you fake | ideally nothing | usually the **clock**, and ideally only the clock |

## 1. Framing: one read is not one message

The single most common defect in a hand-written protocol test. TCP is a byte stream: a `read` can
return half a message, two messages, or a message and a half. On loopback, at low volume, it will
usually return exactly one — which is why the bug ships.

**Write the framer first, and feed it deliberately awkward chunkings before you trust it.** One
system's codec was accepted only after 533 real messages went through it under five chunking
patterns *and* byte-at-a-time, with nothing missed and nothing duplicated. That is a cheap test to
write and it retires a whole class of intermittent failure.

```
for chunk_size in [1, 3, 7, 64, 4096, whole]:
    feed the same recorded stream in chunks of that size
    assert the same message boundaries come out, in the same order
```

If your test asserts on `socket.recv(4096)` directly, it is asserting about your kernel's buffering.

## 2. Settling: the hardest part, and where the timing lies live

A UI test waits for an element. A protocol test has no such landmark — it has to decide *the peer
has finished talking*, and the only honest signal is **silence for long enough**.

Three ways to get this wrong, all measured:

**Counting iterations instead of time.** A settle loop that spins "200 turns with nothing received"
is asking how fast this CPU spins, not whether anything was delivered. Move the machine and the
answer changes. **Bound it in wall time.**

**Tuning the bound until the score improves.** A conformance score that walked 39 → 43 → 59 as its
settle timeout was raised looked like a bound that needed tuning. It was not. The real cause was
Nagle's algorithm on the *test client's* socket delaying small writes by up to 40 ms; raising the
timeout was outwaiting a delay, not settling. **A score that climbs with its own timeout is telling
you something is being waited on and nothing about what.** One `TCP_NODELAY` on the client fixed it,
and afterwards the score was flat — 59/59 at both 1 ms and 20 ms, a 20× span in which only the
runtime changed.

> **The general rule, and it is the most useful sentence in this file: a result that is flat across
> its own bound is measuring the system. A result that climbs with the bound is measuring the
> bound.** Always run your gate at two widely-separated values of its timeout. If the answer moves,
> you do not yet have a result — you have a race, and the next question is which one.

**Assuming the settle can distinguish "woken by data" from "woken by the clock."** If your settle
criterion is shorter than the peer's own internal timeout, one wait satisfies it either way. See
[false-greens](../../plugins/e2e-testing/skills/e2e-testing/references/false-greens.md) for the measurement — the case where a wiring fault that made a server 100 ms
slower per message changed a 3.28 s suite to 3.34 s, which is not a difference.

## 3. Use the corpus as the oracle, and prove the oracle can fail

Many protocols ship a public conformance suite: recorded exchanges, one file per scenario, with the
expected replies written out. If yours does, **that is your oracle and it is far better than
anything you would invent** — it encodes the cases somebody hit in production years ago.

Two disciplines make it trustworthy:

**Build the runner before the thing it tests.** A runner written after the implementation gets
shaped, unconsciously, by what the implementation already does.

**Prove the runner can tell right from wrong, in both directions.** A runner that runs nothing
reports the same score as a system that implements nothing — both print `0 / 59`. So:

- drive it with a **do-nothing** subject and require the floor (`0 / 59`);
- drive it with a **replay** subject that simply echoes each file's own expected output, and require
  a perfect score (`59 / 59`).

Only after the second does the real score mean anything. This is [false-greens](../../plugins/e2e-testing/skills/e2e-testing/references/false-greens.md) §5
applied to the harness rather than to a guard.

**And check what the corpus cannot see.** Grouping the files by what they exercise is worth an hour.
In one case it showed that no file in the whole corpus opened a *second* protocol gap, so three
distinct behaviours were invisible to a perfect score and needed hand-written tests named in the
docs. A corpus is a floor, not a ceiling — see [false-greens](../../plugins/e2e-testing/skills/e2e-testing/references/false-greens.md) §4.

## 4. Inject the clock, and ideally nothing else

Protocol servers are full of time: keepalives, retransmits, idle timeouts, staleness checks on
timestamps in the messages themselves. A test that sleeps to exercise those is slow **and** flaky.

**Make time an input.** The cleanest shape found is a state machine that takes `Tick(now)` as an
event alongside `Received(bytes)`, and reads the clock never. Then the harness advances time
explicitly and the suite runs in milliseconds with no sleeps at all.

Two things this buys that are easy to miss:

- **Recorded exchanges carry fixed timestamps.** If your server validates message freshness against
  the wall clock, a recorded corpus from last year fails every case for the wrong reason. With an
  injected clock you set the clock to the corpus's own instant. Conversely: **if your test builds a
  message by hand, build its timestamp from the same constant the harness uses.** One test invented
  a plausible-looking timestamp, the server rejected it for clock skew, dropped the connection, and
  the visible symptom was an *empty* result list — which reads exactly like "the list was never
  built."
- **Ordering can be a correctness property.** In one engine the clock had to advance *before* the
  read in each turn, because the state machine judges a message's timestamp against the last tick it
  was given, and a connection that has never ticked holds zero — so the first message on every
  connection was judged against year zero and refused. Worth stating in the design, not discovering.

Keep the injected clock the **only** double. Real sockets, real framing, real parsing, real state
machine. Every double you add is a question the suite stops asking.

## 5. Drive turns by hand where you can

If the server exposes a "do one non-blocking pass" operation, the test can call it in a loop rather
than starting a background thread. That removes the timing window entirely and makes the suite as
deterministic as a unit test while still going through real sockets.

Where the production loop is `loop { if !turn() { idle() } }`, a test can own the loop. The whole
conformance corpus of one engine runs this way and is deterministic; only the tests that
*specifically* exercise the idle strategy let it actually block.

## 6. Asserting on things a protocol test uniquely can

A UI test asserts about pixels and text. Here you can assert about the process itself, and these
turn out to be the assertions that catch the bugs nobody else finds.

**Allocation counts on the hot path.** A counting global allocator plus a benchmark that asserts
zero. Two details make the difference between a real check and a decoration: each case must assert
its own path actually ran (a path that is not exercised also allocates nothing), and the benchmark
must be *invoked by CI* — one project's allocation gate was named in its documentation for weeks
while nothing ran it, because the test command does not run benchmark targets.

**Syscalls, attributed by thread.** `strace -f` and a filter on the worker's thread id — not the
process, because a test client on the main thread blocks on purpose and would mask everything. This
is how "this thread never blocks" stops being a comment and becomes a check.

**CPU over a wall-clock window, and the scheduler state.** For the opposite claim — "this thread
*does* block when idle" — read the worker's own CPU time from `/proc/<pid>/task/<tid>/stat` across a
few seconds. And sample the thread's scheduler state while you do: `S` (sleeping) versus `R`
(running) distinguishes *blocked* from *dead*, and a dead thread also uses no CPU.

**One assertion is never enough for a claim like that**, which is the general lesson: near-zero CPU
is equally consistent with a thread that died, a run that never reached the mode you asked for, and
a server woken by its own timeout rather than by your data. The gate that finally held asserted four
things at once, and the measurement that justified it is worth quoting: with the server deliberately
broken so it ignored readiness entirely, it reported **0% CPU**, was found sleeping in **20 of 20
samples** — two of the four assertions green — and had a round-trip median of **99,046,599 ns**,
exactly one internal timeout. Only the fourth assertion saw it.

## 7. The checklist for a protocol e2e suite

1. Does the framer survive byte-at-a-time and multi-message reads, against recorded traffic?
2. Is the settle bound in **wall time**, and is the result flat across two widely-separated values
   of it?
3. Does a do-nothing subject score the floor, and a replay subject score perfect?
4. What does the corpus *not* cover? Which behaviours are held only by hand-written tests?
5. Is the clock injected — and is it the only double?
6. Do hand-built messages take their timestamps from the harness's own constant?
7. If you assert "no allocation", "never blocks", or "gives the CPU back": is anything actually
   running that check, and would it fail if the property were violated?
8. For any claim about a thread, can your evidence distinguish *doing the right thing* from *dead*,
   from *never started*, from *the flag you passed did nothing*?

## Where this came from, and what it is not

Drawn from building one FIX-protocol acceptor in Rust — a TCP server with an injected clock, a
public conformance corpus of 59 recorded exchanges, and gates that trace syscalls and count
allocations. Every figure quoted above was observed on the machine that ran it.

**It is one system, and that is the honest limit.** The shapes here should transfer to any
byte-stream protocol with a request/response character; a datagram protocol, a protocol with
server-initiated streaming, or one over a message broker will have settling problems this file has
not met. Corrections from a second system are worth more than anything written here.
