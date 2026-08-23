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
  config.ts         data-site / data-api parsing
  session.ts        POST /api/v1/visitor-sessions - rate-limit (429/Retry-After) handling
  attachments.ts     presign/upload/confirm/download (5-10) - courtesy validation, real
                     XHR upload progress, never a thrown exception on failure
  storage.ts         namespaced localStorage, scoped per site
  connection.ts      @microsoft/signalr wrapper: resume-by-sequence, jittered reconnect,
                     the sender's-own-echo dedup
  protocol/          pure, unit-tested: backoff.ts, dedup.ts, sequence.ts, types.ts
  ui/                Shadow DOM host, the widget's own visible surface, focus trap, styles
demo/
  index.html         a deliberately hostile host page - see its own comments
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

## Bundle size

**19.9 KB gzipped** (73.7 KB raw, minified), measured 2026-08-23 against a clean build of this
commit (`AGO_API_BASE_URL=http://localhost:5009 npm run build`) - up from `5-09`'s 18.4 KB now that
attachments (`5-10`) are included. `build.mjs` enforces a 45 KB gzipped budget on every build (CI
included) - real headroom over the measured number, not a guess made in advance (`embeddable-widget`
skill: "a hard ceiling, checked on every build").

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

Unit tests cover the protocol layer only (`protocol/*.test.ts`, `storage.test.ts`,
`attachments.test.ts`'s courtesy validation) - sequence handling, the sender's-own-echo dedup,
jittered backoff, and the client-side size/type check, matching the skill's own testing bar.
`connection.ts`, `ui/widget.ts`, and `attachments.ts`'s upload flow are exercised live against the
demo page instead of mocked: a real `HubConnection` against a real `Ago.Chat.Api`, a real presigned
upload against real MinIO, is closer to what actually ships than a mocked client would prove.

**Known gap, not this repository's bug**: an operator-authored message (real-time push, not the
widget's own send) does not reliably arrive live right now - `../ago-root/docs/backlog/5-11-fix-competing-consumer-queue-collision.md`
has the diagnosis (a shared-queue bug in `Ago.Platform.Messaging.RabbitMq`). The widget's own
rendering code is proven correct regardless (`5-10`'s own backlog file has the detail: the same
messages render correctly once caught up via the resume-by-sequence path), but a live two-party demo
against an unpatched cluster may show a delay until reconnect for the operator-authored side.
