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

Unit tests cover the protocol/pure-logic layer (`protocol/*.test.ts`, `storage.test.ts`,
`attachments.test.ts`'s courtesy validation, `ui/appearance.test.ts`'s `11-03` color/position parsing)
- sequence handling, the sender's-own-echo dedup, jittered backoff, the client-side size/type check,
and the "malformed/missing config falls back to the built-in default, never throws" contract, matching
the skill's own testing bar. `connection.ts`, `ui/widget.ts`, and `attachments.ts`'s upload flow are
exercised live against the demo page instead of mocked: a real `HubConnection` against a real
`Ago.Chat.Api`, a real presigned upload against real MinIO, is closer to what actually ships than a
mocked client would prove.

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

**Known gap, not this repository's bug**: an operator-authored message (real-time push, not the
widget's own send) does not reliably arrive live right now - `../ago-root/docs/backlog/5-11-fix-competing-consumer-queue-collision.md`
has the diagnosis (a shared-queue bug in `Ago.Platform.Messaging.RabbitMq`). The widget's own
rendering code is proven correct regardless (`5-10`'s own backlog file has the detail: the same
messages render correctly once caught up via the resume-by-sequence path), but a live two-party demo
against an unpatched cluster may show a delay until reconnect for the operator-authored side.
