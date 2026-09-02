# Builds this repository's widget bundle and packages it, alongside a public demo page, into one
# minimal static-file-serving image.
#
# `15-07`/`adr/0051`: CI publishes this to GHCR as ghcr.io/golyakoff/ago-demo-shop1 and
# ago-demo-shop2, tagged with the full 40-character commit SHA - the same shape adr/0047 gave the
# three Ago.Chat.* hosts. It supersedes adr/0026's "build it on the VPS and import it into
# containerd", which is now the fallback rather than the mechanism.
#
# **This Dockerfile takes no environment input from its build command, and that is the whole point**
# (adr/0051). A build arg that varies per invocation would make ago-demo-shop1:<sha> mean "the demo
# at that commit, pointed at whichever API the builder happened to name" - two different artifacts
# able to collide on one tag, which is exactly the property 15-06 bought and this item must not
# spend. Both args below therefore carry the deployment's own value as a committed default, and CI
# passes neither.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API origin the *demo* bundle talks to. build.mjs itself still refuses to guess one
# (CLAUDE.md: "do not invent ... endpoints") and that guard is untouched - it guards the general
# product build, which has no deployment. This file is not that build: it exists solely to package
# the two public demo pages for demo-shop{1,2}.reserve-me.ru, and it already hardcodes which page
# goes in (DEMO_PAGE_DIR, below), which is exactly as deployment-specific as the API origin. Naming
# the origin here rather than in build.mjs keeps the product build honest and makes this image a
# function of the commit alone. Still an ARG, so a fork or a local experiment can override it - but
# nothing in CI does, so nothing that is ever pushed under a SHA tag does either.
# Moved from `chat.` to `chat-api.` on 2026-09-02. The naming scheme settled that day gives the bare
# product name to the human-facing console and the `-api` suffix to the API, so `chat.` becomes the
# chat console and this bundle must stop pointing at it.
#
# **This value is the reason that rename had to be staged rather than simply done.** It is baked into
# the bundle at build time, so a visitor's cached copy keeps calling whatever origin it was built
# with - there is no way to re-point an already-served widget. `ago-deploy` therefore serves the API
# on *both* names first; only once every consumer is on `chat-api.` and verified does `chat.` change
# meaning. Merging this ahead of that is safe: nothing is deployed by merging, and `ago-deploy` pins
# images by SHA rather than following a tag.
ARG AGO_API_BASE_URL=https://chat-api.reserve-me.ru
# The commit this image is built from (15-07). Defaults to "unknown" rather than failing: a local
# `docker build` to try something is legitimate, and it should say "unknown" out loud instead of
# lying or refusing. build.mjs bakes it into the bundle as window.AgoChat.commit.
ARG GIT_COMMIT=unknown
RUN AGO_API_BASE_URL="${AGO_API_BASE_URL}" AGO_COMMIT="${GIT_COMMIT}" npm run build

# nginx's own "-alpine-slim" variant - the closest analogue to 8-00's Chiseled-image preference
# that actually exists for nginx (Chiseled itself is a .NET/Microsoft base-image family with no
# nginx equivalent): official image, not a bespoke build, with the dynamic modules this
# static-file-only container never uses (image filter, mail proxy, stream) stripped out.
FROM nginx:1.31-alpine-slim
# `17-04`: the base tag names the image nginx's own maintainers published, not the Alpine packages
# inside it *today* - Alpine ships security fixes into its package repositories continuously,
# independent of when a base image was last rebuilt from them. `apk upgrade` reaches into the live
# package repository at build time and pulls whatever is patched *now*, so this image stays current
# between nginx's own rebuilds instead of only at the moment this Dockerfile happens to be edited -
# `ago-console`'s companion fix found this the hard way, against the same base image this repository
# shares. `--no-cache` skips the local index without leaving `/var/cache/apk` behind.
RUN apk update && apk upgrade --no-cache
ARG GIT_COMMIT=unknown
# `15-07`: the OCI annotations a registry and `docker inspect`/`crane config` read. `.source` is not
# only documentation - GHCR uses it to link the published package back to this repository, which is
# what makes the package inherit the repository's own visibility instead of arriving orphaned.
LABEL org.opencontainers.image.source="https://github.com/golyakoff/ago-widget" \
      org.opencontainers.image.description="AGO Chat public demo page + widget bundle" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_COMMIT}"
# `15-08`: without this, nginx's own stock config sends no Cache-Control at all - see nginx.conf's own
# header comment for the incident that found it and why `no-cache` (revalidate-always) is the correct
# policy for every file this image serves, not `no-store` or a long max-age.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ago-chat.js /usr/share/nginx/html/ago-chat.js
COPY --from=build /app/dist/ago-chat.js.map /usr/share/nginx/html/ago-chat.js.map
# `8-09`: the demo pages' own boot script - resolves `?site=`, injects the widget tag, wires the
# "get your own tenant" button. A separate bundle from the widget on purpose (build.mjs, adr/0058):
# only these demo pages ever load it, and no tenant embedding the widget downloads a byte of it.
COPY --from=build /app/dist/demo-boot.js /usr/share/nginx/html/demo-boot.js
COPY --from=build /app/dist/demo-boot.js.map /usr/share/nginx/html/demo-boot.js.map
# `20-07`: the booking module's own lazily-loaded chunk (build.mjs's third entry point). Served as a
# sibling of ago-chat.js because ui/moduleLoader.ts resolves it relative to the widget's own <script
# src> - the same directory a real deployment already serves ago-chat.js from, which this static-file
# image happens to be nginx's document root.
COPY --from=build /app/dist/ago-chat-module-booking.js /usr/share/nginx/html/ago-chat-module-booking.js
COPY --from=build /app/dist/ago-chat-module-booking.js.map /usr/share/nginx/html/ago-chat-module-booking.js.map
# DEMO_PAGE_DIR selects which demo page this image embeds - `public-demo` (demo-shop1, the
# original 8-02 page, `data-site="demo_site"`) by default, or `public-demo-2` (demo-shop2, a
# second, independent tenant seeded specifically to demonstrate tenant isolation live: a different
# operator, a different site row, a visibly different page - `data-site="demo_site2"`). Both share
# this one widget bundle unmodified; only the HTML embedded alongside it differs.
#
# This one *is* passed on the command line, by CI and by ago-deploy's build-static-images.sh alike,
# and adr/0051's "no environment input" rule is not being broken by it: it does not select an
# environment, it selects which of two images is being built - and that choice is already in the
# image's own name (ago-demo-shop1 vs ago-demo-shop2), so the tag is not being asked to carry it.
ARG DEMO_PAGE_DIR=public-demo
COPY ${DEMO_PAGE_DIR}/index.html /usr/share/nginx/html/index.html
# `15-07`: the same commit again, as a file the running container serves. Uniform across all four
# frontend images (ago-console, ago-landing, both of these) so smoke.sh and deploy.sh have one
# question to ask and one answer shape to parse - `curl https://demo-shop1.reserve-me.ru/version.json`
# names the commit without a browser, a shell in the container, or cluster access. Deliberately no
# build timestamp: two builds of one commit should be the same artifact, and a clock is the easiest
# way to make them differ for no reason.
RUN printf '{"app":"ago-widget","page":"%s","commit":"%s"}\n' "${DEMO_PAGE_DIR}" "${GIT_COMMIT}" \
      > /usr/share/nginx/html/version.json
EXPOSE 80
