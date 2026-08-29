# AGO Chat widget

The script a shop embeds on its own site:

```html
<script src="https://cdn.example/ago-chat.js" data-site="shop_7f3a" async></script>
```

It has its own repository because it has its own release cadence: a shop cannot be forced to update
its script tag, so every version stays compatible with the API for a long time
(`../ago-root/docs/architecture/repositories.md`).

Non-negotiable constraints - style isolation via Shadow DOM, a hard bundle ceiling, no global
pollution, jittered reconnect, resume-by-sequence, and never breaking the host page - are in
`../ago-root/.claude/skills/embeddable-widget/SKILL.md`. Protocol and versioning rules are in
`../ago-root/docs/conventions/api-design.md`.

## What's here

```
src/
  index.ts         bootstrap: reads the <script> tag, mounts once, wrapped so a failure
                    degrades to "no widget" - never a broken host page
  config.ts         data-site / data-api / data-public-demo parsing
  session.ts        VisitorSessionManager: mints the visitor identity, renews the token
                     before it expires (17-07), rate-limit (429/Retry-After) handling
  tokenExpiry.ts     reads nbf/exp out of the visitor JWT - never verifies it, and is only
                     ever a decision about *when to renew*, never an authorization one
  attachments.ts     presign/upload/confirm/download (5-10) - courtesy validation, real
                     XHR upload progress, never a thrown exception on failure
  storage.ts         namespaced localStorage, scoped per site
  connection.ts      @microsoft/signalr wrapper: resume-by-sequence, jittered reconnect,
                     the sender's-own-echo dedup
  protocol/          pure, unit-tested: backoff.ts, dedup.ts, sequence.ts, types.ts (20-07:
                     MessageDto gained contentKind/content/actions, adr/0065's closed
                     primitive vocabulary on the wire)
  testing/           a hand-written @microsoft/signalr fake for the behaviour tests - never
                     imported by index.ts, so it never reaches the bundle
  ui/                Shadow DOM host, the widget's own visible surface, focus trap, styles,
                     appearance.ts (11-03: parses the per-site color/position the handshake
                     returns, never trusting the wire value blindly)
    primitives/      20-07: the closed primitive vocabulary, rendered - a labelled button
                     list for choice_list/confirmation_card/date_time_picker, a labelled
                     text input for form. Generic, permanent, base-bundle code: it has never
                     heard of Calendar and never will (adr/0065 §4)
    moduleLoader.ts  20-07: the generic "fetch a lazily-built module bundle" mechanism -
                     a runtime-computed URL, never a literal import(), which is what keeps
                     a module directory out of the base bundle's own inputs
modules/
  booking/           20-07: what is left of 20-06's src/booking/ once booking runs through
                     the conversation instead of beside it - just the chip's own copy and
                     trigger phrase (build.mjs's third, lazily-loaded esbuild entry point).
                     calendarClient.ts/flow.ts/panel.ts/steps.ts are deleted outright, not
                     moved here: there is no direct HTTP call to AGO Calendar left anywhere
demo/
  index.html         a deliberately hostile host page - see its own comments
public-demo/
  index.html         `8-02`'s own friendly, presentable demo page for a stranger with only a URL -
                     not demo/'s isolation test, a different page for a different purpose
Dockerfile           builds this bundle + public-demo/index.html into one minimal nginx image
                     (`8-02`, `../ago-root/docs/adr/0026-*`'s "no registry, build on the VPS"
                     image-delivery mechanism) - `../ago-deploy/k8s/build-static-images.sh` builds
                     it, `../ago-deploy/k8s/overlays/demo/demo-shop1-static.yaml` runs it
```

## Building

```bash
cd ago-widget
npm ci
AGO_API_BASE_URL=http://localhost:5009 npm run build
```

`AGO_API_BASE_URL` is required, on purpose: there is no real hosted deployment for this portfolio
project to default to, and `build.mjs` refuses to guess one (`CLAUDE.md`: "do not invent numbers,
benchmarks, or 'typical' production figures"). Point it at whatever `Ago.Chat.Api` origin this
build should talk to - `http://localhost:5009` for the local cluster
(`../ago-root/docs/runbooks/local-dev.md`). A per-embed override is also available as the script
tag's own `data-api` attribute, for exactly the case this repository's own demo page needs: one
built bundle, pointed at a different API origin without a second build.

`AGO_COMMIT` is optional and defaults to `unknown`. It is the commit the bundle was built from, and
it ends up on `window.AgoChat.commit` in the browser - `15-07`/`adr/0051`. The .NET hosts answer the
same question at `GET /healthz/version`; a bundle has no process to ask, and a bundle embedded on a
tenant's page cannot see the `version.json` its own container serves, so the only place the answer
survives is inside the bundle. Unlike `AGO_API_BASE_URL` it does not change what the widget *does*,
which is why an unset value is `unknown` rather than a refusal: a build that says "unknown" out loud
is fine, and one that claims a commit it was not built from is not.

A third attribute, `data-public-demo="true"`, renders one fixed line inside the panel telling the
visitor that anyone with the published operator login can read what they type (`8-06`). It is set on
this repository's own two public demo pages and nowhere else; the default is off, and only the exact
string `"true"` turns it on, so no real shop's embed can acquire it by accident. It is a flag and not
a free-text notice deliberately - a tenant-configurable processing notice is `16-04`'s server-driven
mechanism, and this must not pre-empt its shape.

## Publishing

CI publishes two images to GHCR on every push to `main` -
`ghcr.io/golyakoff/ago-demo-shop{1,2}:<40-char commit SHA>` - both from this repository's
`Dockerfile`, differing only in which demo page is embedded (`DEMO_PAGE_DIR`). Publishing needs no
secret beyond the workflow's own `GITHUB_TOKEN` (`adr/0047`).

The `Dockerfile` deliberately takes **no environment input from its build command**: it carries the
demo deployment's own API origin as a committed default, so `ago-demo-shop1:<sha>` is a function of
the commit and nothing else, and the tag keeps meaning one thing (`adr/0051`). `build.mjs`'s refusal
to guess an API origin is untouched - that guards the *product* build, which has no deployment; the
`Dockerfile` is the *demo packaging*, which has exactly one.

Each image also serves `/version.json` (`{"app":"ago-widget","page":…,"commit":…}`), so
`curl https://demo-shop1.reserve-me.ru/version.json` names the deployed commit without a browser -
and the bundle itself carries the same commit on `window.AgoChat.commit`, which is the copy that
survives being embedded on somebody else's origin.

## Bundle size

**26.5 KB gzipped** (99.3 KB raw, minified), measured 2026-08-29 against a clean build of this commit
- the first measurement taken after `16-04`'s processing-notice mechanism and `20-07`'s
module-contract rework landed on the same branch together (`AGO_API_BASE_URL=http://localhost:5009
AGO_COMMIT=$(git rev-parse HEAD) npm run build`). Neither number in the two paragraphs immediately
below, each taken in isolation against its own base commit, reflects what actually ships - this one
does. Leaves 18.5 KB of the 45 KB budget unused. `dist/ago-chat-module-booking.js` stays 0.23 KB
gzipped, unaffected by `16-04` (a different file, not counted against this budget).

**28.7 KB gzipped** (110.0 KB raw, minified), `16-04` measured 2026-08-29 against a clean build of
that commit (`AGO_API_BASE_URL=http://localhost:5009 npm run build`) — **+0.6 KB gzipped** over the
same commit's pre-`16-04` baseline (28.1 KB, measured the same way against `git stash`), from the
processing-notice mechanism (`ui/appearance.ts`'s `parseNoticeText`/`parseNoticeUrl`, the notice
element and its two-line render/apply path in `ui/widget.ts`, one new i18n string).

**The 28.1 KB pre-`16-04` baseline does not match the 24.9 KB this section last recorded on
2026-08-26**, and that gap predates this item - found while measuring, not caused by it. Several
items landed on `main` between that measurement and this one (at minimum the widget's own i18n
system, `11-10`'s locale support and its `ru`/`en` string tables, and the notice-locale fix these
commits build on) without anyone re-running this section's own build-and-record step. Stated here
rather than silently overwritten with a number that would misattribute roughly 3.2 KB of somebody
else's work to this item.

**25.8 KB gzipped** (96.7 KB raw, minified), `20-07` measured 2026-08-29 against a clean build of
that commit (`AGO_API_BASE_URL=http://localhost:5009 AGO_COMMIT=$(git rev-parse HEAD) npm run build`,
taken from a base that did not yet include `16-04`) - up from `20-06`'s 24.9 KB, and **not** a
straightforward decrease despite `20-07` deleting `src/booking/`'s whole direct-HTTP flow
(`calendarClient.ts`, `flow.ts`, `panel.ts`, `steps.ts` - roughly 830 lines, including a full step
state machine and an HTTP client) outright. What replaced it - `ui/primitives/render.ts`'s four
generic, permanent renderers plus the reply-wiring in `ui/widget.ts` - is genuinely new, permanent
widget functionality (it is what makes ADR-0065 §4's claim true: "the widget is written once and does
not grow per module"), and it costs more than the single-purpose booking flow it replaces saved.

**`20-07`'s own lazy module bundle, `dist/ago-chat-module-booking.js`, is 0.23 KB gzipped** - not
counted against the widget budget above (fetched, if at all, only by a site with booking enabled,
the same accounting `demo-boot.js` already gets). This is the honest answer to "how much of
`src/booking/` turned out to be genuinely module-specific once the generic renderers existed":
almost nothing - a chip's label, aria-label and trigger phrase, in two locales. `bundleInputs.test.ts`
is what makes "zero inputs from `src/modules/` in the base bundle" a checked property rather than an
assertion - the same technique `8-11` used for `src/demo/`, now actually in code for the first time
(see `20-07`'s own backlog item: no automated version of this guard existed before it).

The paragraphs below are the history that produced the previous numbers, kept because each step of
it is a measurement rather than a claim.

**24.9 KB gzipped** (91.3 KB raw, minified), measured 2026-08-26 against a clean build of that
commit — up from 22.2 KB by `20-06`'s booking module (`src/booking/`: the step model, the flow, the
calendar client and the panel), which was **+2.7 KB gzipped**. That number was the answer to the
question `20-06` was told to ask out loud: the first feature that could plausibly have threatened
the budget did not, so no lazy-loaded module was built at the time - `20-07` is the item that later
found a real reason to split one out (the closed-primitive-vocabulary guard, not the byte count).

**22.1 KB gzipped** (80.7 KB raw, minified), measured 2026-08-25 against a clean build of that
commit (`AGO_API_BASE_URL=http://localhost:5009 AGO_COMMIT=$(git rev-parse HEAD) npm run build`) -
up from `5-17`'s 21.0 KB by `17-07`'s renewal path (`tokenExpiry.ts`, `VisitorSessionManager`'s
renew/throttle/expiry branches and the two strings the panel shows a visitor whose session did not
survive), and then by **49 bytes gzipped** (22,546 → 22,595; 82,587 → 82,637 raw) for `15-07`'s
`window.AgoChat.commit`, which is a 40-character string plus one property name and compresses
about as badly as a hex string can. All three numbers come from the same command on the same
machine. `build.mjs` enforces
a 45 KB gzipped budget on every build (CI included) - real headroom over the measured number, not a
guess made in advance (`embeddable-widget` skill: "a hard ceiling, checked on every build").

**`8-09` adds a second bundle and spends none of that budget.** `dist/demo-boot.js` (**2.3 KB
gzipped**) is the two public demo pages' own boot script - it resolves `?site=`, injects the widget's
`<script data-site>` tag with the answer, and wires the "get your own tenant" button. It is a separate
esbuild entry point on purpose (`ago-root/docs/adr/0058`): the query parameter belongs to the demo
page and must never be read by the widget, because a widget that read its host page's URL could be
repointed at another tenant by any page embedding it. Only the demo pages load it; **no tenant
embedding the widget downloads a byte of it**, which the build's own metafile confirms - `dist/ago-chat.js`
has zero inputs from `src/demo/`. The widget bundle is byte-for-byte unaffected by that item.

**`20-07` adds a third bundle, and it is not loaded by a `<script>` tag at all.**
`dist/ago-chat-module-booking.js` is an ES module, fetched at runtime by `ui/moduleLoader.ts`'s
`loadModule` via a genuine, browser-native dynamic `import()` of a URL computed relative to the
widget's own `<script src>` - never a literal `import()` esbuild could resolve and quietly inline
back into `dist/ago-chat.js`, which is what a hand-rolled code-splitting scheme this small has to get
right for the split to mean anything. Only a site with `data-booking="true"` ever fetches it, and it
fetches once, at boot, not on the visitor's first click.

`@microsoft/signalr` is the only dependency and the large majority of this size. The `Open
questions` section of `../ago-root/docs/backlog/5-09-widget-bootstrap-and-messaging.md` called for
measuring before deciding between the real SignalR client and a hand-rolled one - at under 20 KB
gzipped for the whole widget (this widget's own code, once tree-shaken alongside SignalR, is a
small fraction of that), the real client's own protocol correctness (version negotiation, the
WebSocket/long-polling fallback the skill requires for corporate proxies, the reconnect state
machine) is worth far more than the bytes a hand-rolled client would save.

## Running the demo

The demo site (`ago-deploy/seed/create-demo-tenant.sh`) only allows the origin
`http://localhost:8080` - serve `demo/` from exactly that port so the CORS check
(`../ago-root/docs/adr/*` per-site CORS, `5-01`) is real, not disabled for the test:

```bash
cd ago-widget
AGO_API_BASE_URL=http://localhost:5009 npm run build
npx serve -l 8080 .
```

The whole repository, not just `demo/` - `demo/index.html` references `../dist/ago-chat.js`, and a
static server rooted at `demo/` alone cannot serve a path outside its own root (found live: `serve -l
8080 demo` 404s on the bundle). With the local cluster up
(`../ago-root/docs/runbooks/local-dev.md`) and the demo tenant seeded, open
`http://localhost:8080/demo/` - the chat bubble in the corner is the widget, running next to a page
built specifically to break it (colliding CSS, a colliding `$` global, the same embed snippet
included twice).

## Testing

```bash
npm run typecheck
npm run lint
npm test
```

All three run in CI on every push and pull request (`.github/workflows/ci.yml`), along with the build
and its bundle-size check. The levels are `../ago-root/docs/conventions/testing.md`'s frontend
section. What this repository actually has:

**Tested**

- **Pure logic** (`protocol/*.test.ts`, `storage.test.ts`, `config.test.ts`, `attachments.test.ts`'s
  courtesy validation, `ui/appearance.test.ts`'s `11-03` color/position parsing): sequence handling,
  the sender's-own-echo dedup, jittered backoff, per-site storage scoping, the client-side size/type
  check, and the "malformed/missing config falls back to the built-in default, never throws" contract.
- **Reconnect and resume as behaviour** (`connection.test.ts`, `11-08`): the connection drops, the
  client resumes from the sequence it really saw, what arrived during the gap is delivered exactly
  once even when the resume delta overlaps a live push, a page reload resumes from the persisted
  cursor, and a send meeting a connection that is not there is refused rather than lost. Testing
  `backoff` is not testing this - `5-16` in `ago-console` is the standing proof that every piece can
  be correct while the object owning them goes deaf.
- **What the visitor sees around that** (`ui/widget.test.ts`): the composer is disabled while the
  socket is gone and usable again after the resume, resumed messages render once each, a send that
  did not go says so instead of vanishing, and the panel's own Enter/Shift+Enter contract.
- **Which optimistic bubble an echo belongs to** (`ui/reconciliation.test.ts`, `5-17`): a failed send
  leaves its notice on screen and does not desynchronise the messages after it, two echoes arriving
  out of send order each resolve their own bubble, a visitor message this panel did not send renders
  as a new message, and an *unconfirmed* send's warning is cleared by the server's own copy of that
  message and by nothing else. Its own header says why it is a separate file from `widget.test.ts`.
- **The visitor's identity outliving its own token** (`session.test.ts` and
  `ui/sessionRenewal.test.ts`, `17-07`): a token close to expiry is exchanged for a fresh one under
  the *same* `VisitorId`, a token that runs out under an open page is not what the next negotiate
  carries, a renewal that fails transiently leaves the visitor on the token they still have, a
  renewal the server refuses ends the session visibly instead of silently becoming a second visitor,
  and a visitor returning after expiry gets a working widget, a sentence saying the old conversation
  is gone, and no stale cursor into it. Time is an injected clock (`session.test.ts`) or
  `vi.setSystemTime` (`ui/sessionRenewal.test.ts`) moved in whole days - nothing here passes because
  the test ran quickly, which for this behaviour would be no test at all.
- **Isolation on a hostile page** (`isolation.test.ts`): the jsdom twin of `demo/index.html` - the
  widget's surface is unreachable from the host document's own queries, its stylesheet stays inside
  the shadow root, it adds exactly one global and never touches the page's own, every storage key is
  namespaced, a malformed embed degrades to no widget instead of throwing into the page, a page whose
  `localStorage` throws still gets a widget, and the snippet pasted twice mounts once.
- **`20-07`'s closed primitive vocabulary** (`ui/primitives/render.test.ts`, pure): each of the four
  kinds renders its labelled buttons or text input, an unrecognised kind returns `null` rather than
  throwing, malformed `content` on a *known* kind degrades field-by-field instead of throwing, and a
  reply calls back with exactly `(contentKind, value, displayText)` - never a field name invented by
  this file.
- **The module chip and the wire contract, as behaviour** (`ui/modules.test.ts`): the chip is absent
  and the lazy module bundle is never fetched unless the embed asked for booking; clicking the chip
  sends the trigger phrase through the *same* function a typed-and-Entered message uses, not a second
  code path; a step arriving as an ordinary operator/system message renders richly and a reply to it
  carries `contentKind`/`content: { value }`/no `actions` byte-for-byte; a numeric-looking `form`
  answer still submits as free text, never reinterpreted as an action's value; and no request this
  widget makes ever names `calendar` in its URL, because there is no HTTP client left that could.
- **The base bundle's own inputs** (`bundleInputs.test.ts`): builds the real bundle and reads
  esbuild's own metafile - `dist/ago-chat.js` contains zero files from `src/modules/`. The first
  automated version of `adr/0065`'s bundle-input guard in this repository; see "Bundle size" above.

**Deliberately not tested, and why**

- **The CSS cascade half of the isolation claim.** Measured rather than assumed (2026-08-25): jsdom
  matches selectors against the flattened document and implements no shadow-boundary scoping in
  `getComputedStyle`, so the host page's `button { ... !important }` *does* apply to a button inside
  an open shadow root there, and the shadow root's own `<style>` does not apply at all. An assertion
  either way would be wrong. What the automated test proves is the DOM boundary that makes the
  cascade rule hold in a real browser; the browser's half is `demo/index.html` and live verification.
  `isolation.test.ts`'s own header carries the measurement.
- **Appearance, and coverage as a number.** Nothing behavioural to assert about a colour; no
  snapshots, which fail on every restyle and pass through every real defect. No coverage target.
- **`attachments.ts`'s upload flow end to end.** Still exercised live: a real presigned PUT against
  real MinIO is closer to what ships than a mocked `XMLHttpRequest` would prove.

New behaviour joins one of those two lists rather than neither.

**`11-03`**: bootstrap now resolves the visitor's identity (`session.ts`'s `VisitorSessionManager`)
eagerly, right after mounting - not lazily on first open, the way `5-09` originally built it. Position
has to be known before the closed launcher renders (it decides which corner the toggle button itself
sits in), so the fetch could no longer wait for a click; `connect()` (built on first open) reuses the
same promise rather than calling the endpoint a second time. The heavier part - the actual SignalR
connection, joining a conversation, loading history - is exactly as lazy as before. See
`session.ts`'s own doc comment for the reasoning and `storage.ts`'s `VisitorSession` doc comment for a
real, named limitation this surfaces: a *returning* visitor's cached color/position is not refreshed
on a fresh page load either, since re-requesting through this same endpoint would mint a second
visitor identity to get it - fixing that needs a session endpoint that can return current config
without minting a new visitor, out of this item's own scope.

**`5-17`**: an echo is paired with its optimistic bubble by `clientMessageId`, not by queue position.
The old positional pairing assumed every entry would eventually be matched by exactly one echo, so a
single failed send offset it for the life of the panel: the next message's echo removed the
*"Not sent - reconnecting"* bubble instead of its own, and the message that did send rendered twice.
Found by `11-08`'s tests and fixed here.

The decision that came with it, since both answers were defensible: **what a failed send leaves
behind depends on whether the server could have seen it.** A send that never left - `NotConnectedError`,
or a rejection that came back over a socket that stayed up - drops its entry, because no delivery can
ever carry that id and the notice should stay until the visitor does something about it. A send that
failed with `SendOutcomeUnknownError` **keeps** its entry: the invoke was in flight when the socket
went, the message may well have landed, and if it did, the server's own copy carries the same id and
resolves the bubble into the real message rather than rendering it a second time. That warning is
never cleared by anything except that arrival - not by a later message, not by the reconnect itself -
so "we are not sure" is only ever replaced by evidence. It mirrors the rule `ago-console` applies from
the other end (retry an unknown-outcome send with the *same* `clientMessageId`, a fresh one when
nothing was sent). Automatic retry remains deliberately out of scope here.

**`17-07`**: the visitor's token now **renews**, which is what lets its lifetime come down.

Before this, `getOrCreateVisitorSession` stored the first token it was ever handed and reused it
forever - it never inspected `exp` and never re-minted - so the token's lifetime *was* "how long a
returning visitor still sees their own conversation", and shortening it would have moved the day this
widget silently stops working from day 31 to day 8. That is exactly why `../ago-root/docs/adr/0034-*`
could not lower the number on its own.

How it works, and the three decisions worth stating:

- **Renewal happens at use, not on a timer.** The token is only ever presented at the hub's negotiate
  and on the attachment calls, and every one of those goes through `VisitorSessionManager.token()`,
  which exchanges the token first if less than a third of its own lifetime is left. No `setInterval`
  runs on the host page, a laptop that slept through the moment a timer would have fired renews on
  the next use rather than never, and the widget never renews a token it was not about to use.
- **The threshold comes from the token, never from a constant.** `tokenExpiry.ts` reads `nbf`/`exp`,
  so the same code is correct against whatever lifetime the server is configured with. It verifies
  nothing: the server re-validates on every presentation, and the worst a lying `exp` can do is cost
  one extra rate-limited request.
- **Re-identification only ever happens at a page load.** A visitor returning after their token could
  no longer be renewed gets a new identity, a cleared conversation cursor, and a sentence in the panel
  saying the previous conversation is not coming back - `adr/0034` called the old behaviour "silence",
  and this is that path made observable rather than moved. A token the server refuses to renew *while
  the page is open* ends the session visibly instead: a new `VisitorId` there would open a different
  conversation underneath a transcript that belongs to the first one, and the visitor would go on
  typing to an operator who cannot see it.

The same change removed the defect `5-17` flagged next door: `accessTokenFactory` used to close over
a captured token, which was harmless only because the token never rotated. It takes a provider now,
so a connection opened days ago and dropped negotiates with a token that is valid *now*.

**Known gap, not this repository's bug**: an operator-authored message (real-time push, not the
widget's own send) does not reliably arrive live right now - `../ago-root/docs/backlog/5-11-fix-competing-consumer-queue-collision.md`
has the diagnosis (a shared-queue bug in `Ago.Platform.Messaging.RabbitMq`). The widget's own
rendering code is proven correct regardless (`5-10`'s own backlog file has the detail: the same
messages render correctly once caught up via the resume-by-sequence path), but a live two-party demo
against an unpatched cluster may show a delay until reconnect for the operator-authored side.
