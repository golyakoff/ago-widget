# AGO Chat widget

The script a shop embeds on its own site:

```html
<script src="https://cdn.example/ago-chat.js" data-site="shop_7f3a" async></script>
```

It has its own repository because it has its own release cadence: a shop cannot be forced to update
its script tag, so every version stays compatible with the API for a long time.

Non-negotiable constraints — style isolation via Shadow DOM, a hard bundle ceiling, no global
pollution, jittered reconnect, resume-by-sequence, and never breaking the host page — are in
`../ago-root/.claude/skills/embeddable-widget/SKILL.md`. Protocol and versioning rules are in
`../ago-root/docs/conventions/api-design.md`.

`demo/` will hold a deliberately hostile host page whose job is to prove the isolation claims.
