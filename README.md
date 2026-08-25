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
  session.ts        POST /api/v1/visitor-sessions - rate-limit (429/Retry-After) handling
  attachments.ts     presign/upload/confirm/download (5-10) - courtesy validation, real
                     XHR upload progress, never a thrown exception on failure
  storage.ts         namespaced localStorage, scoped per site
  connection.ts      @microsoft/signalr wrapper: resume-by-sequence, jittered reconnect,
                     the sender's-own-echo dedup
  protocol/          pure, unit-tested: backoff.ts, dedup.ts, sequence.ts, types.ts
  testing/           a hand-written @microsoft/signalr fake for the behaviour tests - never
                     imported by index.ts, so it never reaches the bundle
  ui/                Shadow DOM host, the widget's own visible surface, focus trap, styles,
                     appearance.ts (11-03: parses the per-site color/position the handshake
                     returns, never trusting the wire value blindly)
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

A third attribute, `data-public-demo="true"`, renders one fixed line inside the panel telling the
visitor that anyone with the published operator login can read what they type (`8-06`). It is set on
this repository's own two public demo pages and nowhere else; the default is off, and only the exact
string `"true"` turns it on, so no real shop's embed can acquire it by accident. It is a flag and not
a free-text notice deliberately - a tenant-configurable processing notice is `16-04`'s server-driven
mechanism, and this must not pre-empt its shape.

## Bundle size

**21.0 KB gzipped** (76.8 KB raw, minified), measured 2026-08-25 against a clean build of this
commit (`AGO_API_BASE_URL=http://localhost:5009 npm run build`) - up from `11-03`'s 20.5 KB by
`8-06`'s public-demo notice (its fixed sentence and the strip's CSS). Both numbers come from the same
command on the same machine, the second with `8-06`'s changes stashed. `build.mjs` enforces
a 45 KB gzipped budget on every build (CI included) - real headroom over the measured number, not a
guess made in advance (`embeddable-widget` skill: "a hard ceiling, checked on every build").

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
- **Isolation on a hostile page** (`isolation.test.ts`): the jsdom twin of `demo/index.html` - the
  widget's surface is unreachable from the host document's own queries, its stylesheet stays inside
  the shadow root, it adds exactly one global and never touches the page's own, every storage key is
  namespaced, a malformed embed degrades to no widget instead of throwing into the page, a page whose
  `localStorage` throws still gets a widget, and the snippet pasted twice mounts once.

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

**`11-03`**: bootstrap now resolves the visitor's identity (`session.ts`'s `getOrCreateVisitorSession`)
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

**Known gap, not this repository's bug**: an operator-authored message (real-time push, not the
widget's own send) does not reliably arrive live right now - `../ago-root/docs/backlog/5-11-fix-competing-consumer-queue-collision.md`
has the diagnosis (a shared-queue bug in `Ago.Platform.Messaging.RabbitMq`). The widget's own
rendering code is proven correct regardless (`5-10`'s own backlog file has the detail: the same
messages render correctly once caught up via the resume-by-sequence path), but a live two-party demo
against an unpatched cluster may show a delay until reconnect for the operator-authored side.
