# Builds this repository's widget bundle and packages it, alongside 8-02's own public demo page
# (public-demo/index.html - NOT demo/index.html, the deliberately hostile isolation-test page,
# left untouched), into one minimal static-file-serving image. Built directly on the VPS and
# imported into k3s's own containerd (adr/0026's "no registry" image-delivery decision, the same
# one ago-chat's own Dockerfile follows) - not pushed anywhere, no CI wiring here.
#
# AGO_API_BASE_URL is a required build ARG, not a default baked in here - build.mjs itself already
# refuses to guess a value (CLAUDE.md: "do not invent ... endpoints"); this Dockerfile just carries
# that same requirement through to `docker build --build-arg AGO_API_BASE_URL=...`
# (k8s/build-static-images.sh, ago-deploy, sets it to https://chat.reserve-me.ru for this overlay).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG AGO_API_BASE_URL
RUN AGO_API_BASE_URL="${AGO_API_BASE_URL}" npm run build

# nginx's own "-alpine-slim" variant - the closest analogue to 8-00's Chiseled-image preference
# that actually exists for nginx (Chiseled itself is a .NET/Microsoft base-image family with no
# nginx equivalent): official image, not a bespoke build, with the dynamic modules this
# static-file-only container never uses (image filter, mail proxy, stream) stripped out.
FROM nginx:1.27-alpine-slim
COPY --from=build /app/dist/ago-chat.js /usr/share/nginx/html/ago-chat.js
COPY --from=build /app/dist/ago-chat.js.map /usr/share/nginx/html/ago-chat.js.map
COPY public-demo/index.html /usr/share/nginx/html/index.html
EXPOSE 80
