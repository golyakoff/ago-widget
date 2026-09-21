import type { MessageDto, ChannelLinkDto } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage, type VisitorSession } from "../storage.js";
import { VisitorSessionExpiredError, VisitorSessionManager } from "../session.js";
import { sendBeacon } from "../beacon.js";
import { NotConnectedError, SendOutcomeUnknownError, VisitorConnection, type ConnectionState } from "../connection.js";
import { newClientMessageId } from "../protocol/dedup.js";
import {
  courtesyValidate,
  createAttachment,
  confirmAttachment,
  getAttachmentDownload,
  uploadToPresignedUrl,
  AttachmentRejectedError,
} from "../attachments.js";
import { recordContactDetail } from "../contactDetails.js";
import { getUnreadCount } from "../unreadCount.js";
import { getConsentRequirement, recordConsent, type ConsentRequirement } from "../consent.js";
import { createShadowHost } from "./shadow-root.js";
import { FocusTrap } from "./focus-trap.js";
import { logWidgetError, guardAsync } from "../errors.js";
import {
  parseAttractAttention,
  parseAutoOpenDelaySeconds,
  parseAutoOpenEnabled,
  parseAutoOpenGreetingText,
  parseChannelSwitcherIconSize,
  parseChannelSwitcherPlacement,
  parseContactCaptureConfirmationText,
  parseNoticeText,
  parseNoticeUrl,
  parseWidgetColor,
  parseWidgetPosition,
} from "./appearance.js";
import { renderPrimitiveContent } from "./primitives/render.js";
import { renderContactCaptureControl, type ContactCaptureResult } from "./contactCapture.js";
import { loadModule } from "./moduleLoader.js";
import { en } from "../i18n/en.js";
import { getStrings, parseWidgetLocale, type SupportedLocale } from "../i18n/resolve.js";
import type { WidgetStrings } from "../i18n/strings.js";
// `20-07`: type-only, so it never adds an input to the base bundle (`isolatedModules`/esbuild strip
// `import type` before the bundler's own module graph sees it) - the one place in this file allowed
// to say "booking" is `loadBookingModuleChip` below, which names the lazy chunk's file name and
// nothing else about it.
import type { ModuleChipSpec } from "../modules/booking/chip.js";
// `23-62`: the same type-only import shape as `ModuleChipSpec` above, for the same reason - this
// never adds a runtime input to the base bundle (`bundleInputs.test.ts` covers this module directory
// exactly as it already covers `modules/booking/`), and the one place in this file allowed to know
// the save archive builder's own shape is `saveConversation` below, which names the lazy chunk's file
// name and nothing else about how it is built.
import type {
  AttachmentLocation,
  AttachmentLookupFailure,
  BuildConversationArchiveInput,
} from "../modules/saveConversation/archive.js";

/**
 * `23-63`: the bound the backlog item's own "Where this is likely to go wrong" section asked to be
 * stated in code - "a small number of attempts, then silence, is the shape to beat." Three pulses,
 * not "until the visitor opens it": a launcher that keeps moving for as long as somebody reads the
 * page is not an invitation, it is the harassment pattern this feature exists to avoid without
 * becoming. Three is enough that a visitor who glances away and back at least once still has a
 * chance to notice it, and few enough that a visitor who is reading the page - not ignoring the
 * widget - is not interrupted repeatedly by the same motion. `scheduleAttractAttention` is the only
 * place this number is read; nothing elsewhere loops on the launcher's own account.
 */
export const MAX_ATTRACT_ATTEMPTS = 3;

/** `23-63`: how long the widget waits, after the site's config resolves, before the first pulse -
 * long enough that the launcher does not visibly move the instant a page paints (which would read
 * as a layout glitch, not an invitation), short enough that a visitor who never scrolls or clicks
 * still sees it within a few seconds of arriving. */
export const ATTRACT_INITIAL_DELAY_MS = 2_000;

/** `23-63`: the quiet gap between one pulse ending and the next one starting - long enough that two
 * pulses read as two distinct attempts, not one continuous shake. */
export const ATTRACT_PULSE_INTERVAL_MS = 4_000;

/** `23-63`: how long one pulse's `ago-toggle--attract` class stays on the launcher - matches (and
 * must keep matching) the `ago-attract` keyframe's own duration in `ui/styles.css`, since this is what
 * tells the JS side of the animation when the CSS side has finished rather than duplicating that
 * number as a CSS `animation-iteration-count` a `setTimeout` could drift out of step with. */
export const ATTRACT_PULSE_DURATION_MS = 700;

/**
 * `25-203`: how long `isHoverRegionActive` stays `true` after the pointer leaves both `this.toggle`
 * and `this.channelSwitcherLauncherRow`, before `updateChannelSwitcherLauncherVisibility` actually
 * hides the row. Confirmed live, against a real local build, before adding this: with no grace period
 * at all (the ticket's own literally-worded fix - the row's own `pointerenter`/`pointerleave` writing
 * the identical flag the toggle's pair already writes, nothing else), a real desktop pointer path
 * moving from inside the toggle toward an icon still lost the row mid-crossing every time a sample
 * landed in the real, physical gap between the two boxes (`ui/styles.css`'s own `--acsl-gap`) - the
 * toggle's own `pointerleave` fires the instant the pointer leaves its box, `hidden` is written
 * synchronously, and the row (now `display: none`) cannot receive the `pointerenter` that would have
 * un-hidden it once the pointer actually arrives, because a `display: none` element takes no part in
 * hit-testing at all. Two elements each independently reacting to their own hover, with no shared
 * memory of "still in transit between them" bridging the gap, is not actually one hoverable region -
 * this grace period is what makes it one: a `pointerleave` on either element only *schedules* the
 * hide, and the matching `pointerenter` on either element (scheduled or not) cancels it outright, so a
 * crossing that takes less than this many milliseconds - true of any realistic pointer speed over a
 * gap measured in single-digit rem - never actually reaches the hidden state map to see it, `open()`
 * always wins immediately regardless of this delay (`updateChannelSwitcherLauncherVisibility`'s own
 * `isOpen` term is never debounced) - only the "still closed, hover genuinely gone" transition waits.
 */
export const HOVER_REGION_LEAVE_GRACE_MS = 150;

/**
 * `25-61`: the literal prefix `VisitorHub.SendAsync` (`ago-chat`, `Ago.Chat.Api/Hubs/VisitorHub.cs`)
 * puts ahead of its own free-text message on exactly one rejection - a visitor's send failing because
 * the conversation they are sending into has already closed. Hardcoded here rather than referencing
 * that repository's own `VisitorHub.ConversationClosedHubErrorPrefix`: a different language, a
 * different repository, and not visible to this one anyway (`internal`, scoped to `ago-chat`'s own
 * integration tests). `completeSend`'s check below is a plain `startsWith` against this exact literal
 * (trailing space included) - never `.includes()`, and never anything after the prefix, since the
 * English sentence that follows it is `Conversation.AddVisitorMessage`'s own wording for a human
 * reading logs, not a stable contract, and may be reworded or localised in `ago-chat` without this
 * widget knowing.
 */
const CONVERSATION_CLOSED_HUB_ERROR_PREFIX = "Conversation.InvalidState: ";

/**
 * `8-06`/`8-11`: the two fixed demo sentences a stranger on `demo-shop1` (public) or a
 * tenant minted by `8-07`'s button (private) must have read before typing - three short statements of
 * fact for the public case, a precise reassurance plus the tenant's own disposability for the private
 * one. Full reasoning for both sentences' wording stays where it always has: `i18n/en.ts`'s own
 * `publicDemoNotice`/`privateDemoNotice` doc comments.
 *
 * `11-10`: the two sentences moved out of this file and into `i18n/en.ts`/`ru.ts` as the first two
 * entries in the widget's new string table - they were always fixed text owned by the widget rather
 * than passed in from the host page (`config.ts` explains why the script tag carries an enum and not
 * a string), which is exactly what belongs in the string table alongside every other widget-owned
 * sentence, translated the same way.
 */
function createDemoNotice(text: string): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "ago-notice";
  // `role="note"`, not a live region: it is present before the visitor interacts at all, so there is
  // nothing to announce - it is read in document order like the rest of the panel.
  notice.setAttribute("role", "note");
  notice.textContent = text;
  return notice;
}

/**
 * `16-04`: the tenant's own processing notice - who processes what a visitor is about to write, and
 * a link to read more. Built empty and `hidden` in the constructor (this widget's config is not known
 * synchronously the way `config.demoNotice` is - it arrives on the handshake response `bootstrapSession`
 * awaits), then populated and revealed by `applyProcessingNotice` once that response resolves. Kept as
 * its own element, positioned identically to `createDemoNotice`'s own result (directly under the
 * header, outside `.ago-messages`) rather than folded into it: the demo notice is this widget's own
 * fixed sentence about *our* pages, always in `this.strings`; this one is per-tenant data from
 * `WidgetConfig`, never translated (`i18n/strings.ts`'s own remarks on `processingNoticeLinkText`), and
 * a site can show either, both, or neither.
 */
function createProcessingNotice(): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "ago-processing-notice";
  notice.setAttribute("role", "note");
  notice.hidden = true;
  return notice;
}

/**
 * Renders one Material Symbols Outlined glyph as an inline SVG - the icon's own `d` path, verbatim
 * from Google's own `material-design-icons` source (the `-960 0 960 960` viewBox that font family
 * ships with, not the older Material Icons' `0 0 24 24` convention - the two are not interchangeable
 * path data). `fill: currentColor` and no stroke, matching how that source renders it: the outline
 * look comes from the path data itself, not from a stroke drawn around a filled shape.
 */
function createSvgIcon(d: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("fill", "currentColor");
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "text-bottom";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.appendChild(path);

  return svg;
}

/**
 * `25-172`: a generic node in a small structured-data tree that `buildIconTree` below walks into real
 * `SVGElement`s, one `createElementNS`/`setAttribute` call per node/attribute - the same construction
 * discipline `createSvgIcon` above already uses, extended to cover a node that is not just one
 * `<path>` in a fixed viewBox. This file has no `.innerHTML` anywhere (a raw-embedded, third-party-site
 * widget is exactly the context where that discipline earns its keep - a hosting page's own CSP may
 * forbid it), and a real brand mark with multiple paths, or nested `<defs>`/gradients (MAX), cannot be
 * expressed as one `d` string the way `createSvgIcon` wants it - hence a second, parallel builder
 * instead of stretching `createSvgIcon` itself to cover a shape it was never designed for.
 */
interface IconNode {
  tag: string;
  attrs?: Record<string, string>;
  children?: IconNode[];
}

/**
 * `25-199`: one higher than the last call, so two icon trees built into the same shadow root -
 * `loadChannelSwitcherCard`'s `AboveComposer` card and `openTouchRoutingSheet`'s own sheet are the
 * real case this exists for, both able to hold a `Max` row at once - never mint the same suffix
 * twice. Module-scope rather than passed in from a caller: every `buildBrandIcon` call anywhere in
 * this file needs the identical guarantee, and a counter is the plain, deterministic way to get it
 * without reaching for `crypto.randomUUID` for what is, underneath, just "a number nobody has used
 * yet" - the same reasoning `sequence`-based ordering elsewhere in this project already applies
 * instead of a clock.
 */
let nextIconInstanceId = 0;

/** `25-199`: every `id` an icon tree declares, gathered up front so `buildIconTree` below knows
 * which fragment references (`href="#a"`, `fill="url(#c)"`) are *internal* to this one tree - and
 * therefore need the identical per-instance suffix its own `id` gets - as opposed to some unrelated
 * `#`-containing string a future tree might carry (a URL fragment in an unrelated attribute, say)
 * that must be left alone. */
function collectDeclaredIds(node: IconNode, into: Set<string> = new Set()): Set<string> {
  if (node.attrs?.id !== undefined) {
    into.add(node.attrs.id);
  }
  for (const child of node.children ?? []) {
    collectDeclaredIds(child, into);
  }
  return into;
}

/** `25-199`: rewrites every `#<id>` occurrence inside `value` whose `<id>` is one this tree declares
 * itself (`declaredIds`) to carry `suffix` too - covers both `href="#a"` (the whole value is the
 * reference) and `fill="url(#c)"` (the reference sits inside a larger string) with one regex, since
 * both are exactly `#` followed by the id and nothing about this widget's own icon trees needs a
 * broader `url()` grammar than that. A value with no matching id (every attribute on `Telegram`/
 * `WhatsApp`/`Vk`, and any non-reference attribute on `Max` itself) comes back unchanged. */
function withUniqueIdReferences(value: string, declaredIds: ReadonlySet<string>, suffix: string): string {
  return value.replace(/#([\w-]+)/g, (whole, id: string) => (declaredIds.has(id) ? `#${id}-${suffix}` : whole));
}

/**
 * `25-199`: `id`/reference rewriting lives here, in the one place every node of a tree already
 * passes through, rather than as a post-build DOM pass over the finished `SVGElement` - walking the
 * source `IconNode` tree once, with a `Set` already telling it which strings are this tree's own
 * ids, is simpler than re-deriving the same fact by walking the built SVG's attributes afterward.
 * `Telegram`/`WhatsApp`/`Vk` declare no `id` anywhere in their own trees, so `declaredIds` is empty
 * for them and every `setAttribute` call below is byte-for-byte what it always was - this only ever
 * changes output for a tree that actually declares an `id`, `Max` today and whichever brand needs
 * one next.
 */
function buildIconTree(node: IconNode, declaredIds: ReadonlySet<string>, suffix: string): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", node.tag);
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (key === "id" && declaredIds.has(value)) {
      el.setAttribute("id", `${value}-${suffix}`);
      continue;
    }
    el.setAttribute(key, withUniqueIdReferences(value, declaredIds, suffix));
  }
  for (const child of node.children ?? []) {
    el.appendChild(buildIconTree(child, declaredIds, suffix));
  }
  return el;
}

/**
 * `25-172`: real, multi-colour brand marks for the only four `ChannelKind` values
 * `AuthEndpoints.ChannelLinkResponse.Kind` (`ago-chat`)'s own `ChannelLinkUrlBuilder` can ever actually
 * emit (`25-147`'s own scope - Avito is never among them). These replace `25-149`'s own admittedly
 * invented placeholder glyphs (MAX/VK/WhatsApp) and the too-blue `#40B3E0` the Telegram asset first
 * carried; every one of the four was sourced by the author and confirmed live against an HTML review
 * artifact before this item was filed - this map is the transcription of that approved result, not a
 * fresh design pass.
 *
 * Each icon keeps its own native viewBox (unlike `createSvgIcon`'s shared `0 -960 960 960`) since these
 * are real vector traces, not glyphs drawn to a common grid. `width`/`height: 1em` and the
 * `display`/`vertical-align` pair on the outer `<svg>` match `createSvgIcon`'s own inline sizing so a
 * brand icon sits in the row exactly like the fallback glyph would. MAX alone gets a `clip-path` in its
 * own inline `style`: its native art is a rounded square (`rect ry="249.681"` on a `1000x1000` box), and
 * every other channel's badge already renders as a circle from its own path data, so MAX needs the one
 * per-icon crop the others don't (confirmed live against the approved review - keeping the rounded
 * square was explicitly rejected).
 *
 * WhatsApp's two paths share one identical `d` on purpose: the source asset's cutout was originally an
 * unfilled `evenodd` hole alone, showing whatever the host page's own background was behind it -
 * invisible on a dark ground. Layering an opaque white `nonzero` copy of the same shape underneath fixes
 * that: the green `evenodd` layer punches its handset-shaped hole through to white now, never through to
 * the page.
 */
const CHANNEL_ICON_TREES: Record<string, IconNode> = {
  Telegram: {
    tag: "svg",
    attrs: {
      viewBox: "0 0 256 256",
      width: "1em",
      height: "1em",
      style: "display:inline-block;vertical-align:text-bottom",
    },
    children: [
      {
        tag: "path",
        attrs: {
          d: "M128,0 C57.307,0 0,57.307 0,128 L0,128 C0,198.693 57.307,256 128,256 L128,256 C198.693,256 256,198.693 256,128 L256,128 C256,57.307 198.693,0 128,0 L128,0 Z",
          fill: "#0088CC",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M190.2826,73.6308 L167.4206,188.8978 C167.4206,188.8978 164.2236,196.8918 155.4306,193.0548 L102.6726,152.6068 L83.4886,143.3348 L51.1946,132.4628 C51.1946,132.4628 46.2386,130.7048 45.7586,126.8678 C45.2796,123.0308 51.3546,120.9528 51.3546,120.9528 L179.7306,70.5928 C179.7306,70.5928 190.2826,65.9568 190.2826,73.6308",
          fill: "#FFFFFF",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M98.6178,187.6035 C98.6178,187.6035 97.0778,187.4595 95.1588,181.3835 C93.2408,175.3085 83.4888,143.3345 83.4888,143.3345 L161.0258,94.0945 C161.0258,94.0945 165.5028,91.3765 165.3428,94.0945 C165.3428,94.0945 166.1418,94.5735 163.7438,96.8115 C161.3458,99.0505 102.8328,151.6475 102.8328,151.6475",
          fill: "#D2E5F1",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M122.9015,168.1154 L102.0335,187.1414 C102.0335,187.1414 100.4025,188.3794 98.6175,187.6034 L102.6135,152.2624",
          fill: "#B5CFE4",
        },
      },
    ],
  },
  WhatsApp: {
    tag: "svg",
    attrs: {
      viewBox: "0 0 48 48",
      width: "1em",
      height: "1em",
      style: "display:inline-block;vertical-align:text-bottom",
    },
    children: [
      {
        tag: "g",
        attrs: { transform: "translate(-700, -360)" },
        children: [
          {
            tag: "path",
            attrs: {
              fill: "#ffffff",
              "fill-rule": "nonzero",
              d: "M723.993033,360 C710.762252,360 700,370.765287 700,383.999801 C700,389.248451 701.692661,394.116025 704.570026,398.066947 L701.579605,406.983798 L710.804449,404.035539 C714.598605,406.546975 719.126434,408 724.006967,408 C737.237748,408 748,397.234315 748,384.000199 C748,370.765685 737.237748,360.000398 724.006967,360.000398 L723.993033,360.000398 L723.993033,360 Z M717.29285,372.190836 C716.827488,371.07628 716.474784,371.034071 715.769774,371.005401 C715.529728,370.991464 715.262214,370.977527 714.96564,370.977527 C714.04845,370.977527 713.089462,371.245514 712.511043,371.838033 C711.806033,372.557577 710.056843,374.23638 710.056843,377.679202 C710.056843,381.122023 712.567571,384.451756 712.905944,384.917648 C713.258648,385.382743 717.800808,392.55031 724.853297,395.471492 C730.368379,397.757149 732.00491,397.545307 733.260074,397.27732 C735.093658,396.882308 737.393002,395.527239 737.971421,393.891043 C738.54984,392.25405 738.54984,390.857171 738.380255,390.560912 C738.211068,390.264652 737.745308,390.095816 737.040298,389.742615 C736.335288,389.389811 732.90737,387.696673 732.25849,387.470894 C731.623543,387.231179 731.017259,387.315995 730.537963,387.99333 C729.860819,388.938653 729.198006,389.89831 728.661785,390.476494 C728.238619,390.928051 727.547144,390.984595 726.969123,390.744481 C726.193254,390.420348 724.021298,389.657798 721.340985,387.273388 C719.267356,385.42535 717.856938,383.125756 717.448104,382.434484 C717.038871,381.729275 717.405907,381.319529 717.729948,380.938852 C718.082653,380.501232 718.421026,380.191036 718.77373,379.781688 C719.126434,379.372738 719.323884,379.160897 719.549599,378.681068 C719.789645,378.215575 719.62006,377.735746 719.450874,377.382942 C719.281687,377.030139 717.871269,373.587317 717.29285,372.190836 Z",
            },
          },
          {
            tag: "path",
            attrs: {
              fill: "#2AB540",
              "fill-rule": "evenodd",
              d: "M723.993033,360 C710.762252,360 700,370.765287 700,383.999801 C700,389.248451 701.692661,394.116025 704.570026,398.066947 L701.579605,406.983798 L710.804449,404.035539 C714.598605,406.546975 719.126434,408 724.006967,408 C737.237748,408 748,397.234315 748,384.000199 C748,370.765685 737.237748,360.000398 724.006967,360.000398 L723.993033,360.000398 L723.993033,360 Z M717.29285,372.190836 C716.827488,371.07628 716.474784,371.034071 715.769774,371.005401 C715.529728,370.991464 715.262214,370.977527 714.96564,370.977527 C714.04845,370.977527 713.089462,371.245514 712.511043,371.838033 C711.806033,372.557577 710.056843,374.23638 710.056843,377.679202 C710.056843,381.122023 712.567571,384.451756 712.905944,384.917648 C713.258648,385.382743 717.800808,392.55031 724.853297,395.471492 C730.368379,397.757149 732.00491,397.545307 733.260074,397.27732 C735.093658,396.882308 737.393002,395.527239 737.971421,393.891043 C738.54984,392.25405 738.54984,390.857171 738.380255,390.560912 C738.211068,390.264652 737.745308,390.095816 737.040298,389.742615 C736.335288,389.389811 732.90737,387.696673 732.25849,387.470894 C731.623543,387.231179 731.017259,387.315995 730.537963,387.99333 C729.860819,388.938653 729.198006,389.89831 728.661785,390.476494 C728.238619,390.928051 727.547144,390.984595 726.969123,390.744481 C726.193254,390.420348 724.021298,389.657798 721.340985,387.273388 C719.267356,385.42535 717.856938,383.125756 717.448104,382.434484 C717.038871,381.729275 717.405907,381.319529 717.729948,380.938852 C718.082653,380.501232 718.421026,380.191036 718.77373,379.781688 C719.126434,379.372738 719.323884,379.160897 719.549599,378.681068 C719.789645,378.215575 719.62006,377.735746 719.450874,377.382942 C719.281687,377.030139 717.871269,373.587317 717.29285,372.190836 Z",
            },
          },
        ],
      },
    ],
  },
  Vk: {
    tag: "svg",
    attrs: {
      viewBox: "0 0 97.75 97.75",
      width: "1em",
      height: "1em",
      style: "display:inline-block;vertical-align:text-bottom",
    },
    children: [
      {
        tag: "path",
        attrs: {
          d: "M48.875,0C21.883,0,0,21.882,0,48.875S21.883,97.75,48.875,97.75S97.75,75.868,97.75,48.875S75.867,0,48.875,0z",
          fill: "#345E90",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M73.667,54.161c2.278,2.225,4.688,4.319,6.733,6.774c0.906,1.086,1.76,2.209,2.41,3.472c0.928,1.801,0.09,3.776-1.522,3.883l-10.013-0.002c-2.586,0.214-4.644-0.829-6.379-2.597c-1.385-1.409-2.67-2.914-4.004-4.371c-0.545-0.598-1.119-1.161-1.803-1.604c-1.365-0.888-2.551-0.616-3.333,0.81c-0.797,1.451-0.979,3.059-1.055,4.674c-0.109,2.361-0.821,2.978-3.19,3.089c-5.062,0.237-9.865-0.531-14.329-3.083c-3.938-2.251-6.986-5.428-9.642-9.025c-5.172-7.012-9.133-14.708-12.692-22.625c-0.801-1.783-0.215-2.737,1.752-2.774c3.268-0.063,6.536-0.055,9.804-0.003c1.33,0.021,2.21,0.782,2.721,2.037c1.766,4.345,3.931,8.479,6.644,12.313c0.723,1.021,1.461,2.039,2.512,2.76c1.16,0.796,2.044,0.533,2.591-0.762c0.35-0.823,0.501-1.703,0.577-2.585c0.26-3.021,0.291-6.041-0.159-9.05c-0.28-1.883-1.339-3.099-3.216-3.455c-0.956-0.181-0.816-0.535-0.351-1.081c0.807-0.944,1.563-1.528,3.074-1.528l11.313-0.002c1.783,0.35,2.183,1.15,2.425,2.946l0.01,12.572c-0.021,0.695,0.349,2.755,1.597,3.21c1,0.33,1.66-0.472,2.258-1.105c2.713-2.879,4.646-6.277,6.377-9.794c0.764-1.551,1.423-3.156,2.063-4.764c0.476-1.189,1.216-1.774,2.558-1.754l10.894,0.013c0.321,0,0.647,0.003,0.965,0.058c1.836,0.314,2.339,1.104,1.771,2.895c-0.894,2.814-2.631,5.158-4.329,7.508c-1.82,2.516-3.761,4.944-5.563,7.471C71.48,50.992,71.611,52.155,73.667,54.161z",
          fill: "#ffffff",
        },
      },
    ],
  },
  Max: {
    tag: "svg",
    attrs: {
      viewBox: "0 0 1000 1000",
      width: "1em",
      height: "1em",
      style: "display:inline-block;vertical-align:text-bottom;clip-path:circle(50% at 50% 50%)",
    },
    children: [
      {
        tag: "defs",
        children: [
          {
            tag: "linearGradient",
            attrs: { id: "b" },
            children: [
              { tag: "stop", attrs: { offset: "0", "stop-color": "#00f" } },
              { tag: "stop", attrs: { offset: "1", "stop-opacity": "0" } },
              { tag: "stop", attrs: { offset: "1", "stop-opacity": "0" } },
            ],
          },
          {
            tag: "linearGradient",
            attrs: { id: "a" },
            children: [
              { tag: "stop", attrs: { offset: "0", "stop-color": "#4cf" } },
              { tag: "stop", attrs: { offset: ".662", "stop-color": "#53e" } },
              { tag: "stop", attrs: { offset: "1", "stop-color": "#93d" } },
            ],
          },
          {
            tag: "linearGradient",
            attrs: {
              id: "c",
              x1: "117.847",
              x2: "1000",
              y1: "760.536",
              y2: "500",
              gradientUnits: "userSpaceOnUse",
              href: "#a",
            },
          },
          {
            tag: "radialGradient",
            attrs: {
              id: "d",
              cx: "-87.392",
              cy: "1166.116",
              r: "500",
              fx: "-87.392",
              fy: "1166.116",
              gradientTransform: "rotate(51.356 1551.478 559.3)scale(2.42703433 1)",
              gradientUnits: "userSpaceOnUse",
              href: "#b",
            },
          },
        ],
      },
      { tag: "rect", attrs: { width: "1000", height: "1000", fill: "url(#c)", ry: "249.681" } },
      { tag: "rect", attrs: { width: "1000", height: "1000", fill: "url(#d)", ry: "249.681" } },
      {
        tag: "path",
        attrs: {
          fill: "#fff",
          "fill-rule": "evenodd",
          d: "M508.211 878.328c-75.007 0-109.864-10.95-170.453-54.75-38.325 49.275-159.686 87.783-164.979 21.9 0-49.456-10.95-91.248-23.36-136.873-14.782-56.21-31.572-118.807-31.572-209.508 0-216.626 177.754-379.597 388.357-379.597 210.785 0 375.947 171.001 375.947 381.604.707 207.346-166.595 376.118-373.94 377.224m3.103-571.585c-102.564-5.292-182.499 65.7-200.201 177.024-14.6 92.162 11.315 204.398 33.397 210.238 10.585 2.555 37.23-18.98 53.837-35.587a189.8 189.8 0 0 0 92.71 33.032c106.273 5.112 197.08-75.794 204.215-181.95 4.154-106.382-77.67-196.486-183.958-202.574Z",
          "clip-rule": "evenodd",
        },
      },
    ],
  },
};

/**
 * `25-172`: looks up a real brand mark for the four recognised `ChannelKind`s above and builds it via
 * `buildIconTree`; `undefined` for anything else (including a future, unrecognised `kind`) so the one
 * caller below can fall through to exactly `createSvgIcon(CHANNEL_FALLBACK_ICON_PATH)` - `createSvgIcon`
 * itself, and its every other caller, stay untouched by this item.
 */
function buildBrandIcon(kind: string): SVGSVGElement | undefined {
  const tree = CHANNEL_ICON_TREES[kind];
  if (tree === undefined) {
    return undefined;
  }
  return buildIconTree(tree, collectDeclaredIds(tree), `icon${nextIconInstanceId++}`) as SVGSVGElement;
}

/** `25-149`: an unrecognised `kind` on the wire (a future channel this build has not shipped an icon
 * for yet) still gets a real, working row - never dropped, never a crash. The plain outer circle
 * `sentiment_satisfied`'s own glyph above already draws for its face, reused here as a neutral "channel
 * exists, no icon yet" mark rather than a second, invented shape. */
const CHANNEL_FALLBACK_ICON_PATH =
  "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z";

/** `25-197`: the identical Material Symbols Outlined `chat_bubble` glyph the closed launcher's own
 * icon already uses (`this.toggle`'s own construction, below) - named here once this item gives it
 * a second call site (the touch routing sheet's own "Онлайн чат" row) so the two never drift. */
const CHAT_BUBBLE_ICON_PATH =
  "M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z";

/**
 * `25-149`: every colour here is a small, widget-local constant, deliberately independent of
 * `--ago-accent` - the identical "must read against whatever a tenant configured" reasoning
 * `--ago-unread-badge-bg` already states for itself (`ui/styles.css`). `25-172` narrowed this map's job:
 * since the four real brand icons above carry their own explicit fills (never `currentColor`), this
 * `row.style.color` value now only tints the row's *label text* (via `.ago-channel-switcher-row { color:
 * inherit }` in `ui/styles.css`) - it no longer doubles as an icon colour. `Telegram`/`WhatsApp`/`Vk`
 * were updated to the same authoritative brand hex the icons themselves now use (`#0088CC`/`#2AB540`/
 * `#345E90`), so the label text and the badge read as one colour again despite the two now being
 * independent mechanisms. `Max` is left at its pre-existing placeholder purple: MAX's real mark is a
 * gradient with no single flat hex to promote to text-tint duty, and inventing one is out of scope here.
 *
 * VK ships in this first version despite `25-147`'s own note that its whole integration has never
 * been exercised against a real token - the author's own explicit decision, 2026-09-18: a wrong URL
 * there is `25-147`'s own bug to fix, not a reason to withhold VK's row here.
 */
const CHANNEL_BRAND_COLORS: Record<string, string> = {
  Telegram: "#0088CC",
  WhatsApp: "#2AB540",
  Vk: "#345E90",
  Max: "#6E56CF",
};

/** `25-149`: the neutral fallback colour, for the identical unrecognised-`kind` case
 * `CHANNEL_FALLBACK_ICON_PATH` covers - `#6b7280`, the same grey `.ago-status`/`.ago-message--system`
 * already use in `ui/styles.css`, not a new literal invented for this one case. */
const CHANNEL_FALLBACK_COLOR = "#6b7280";

/**
 * `25-149`: the proper noun a visitor actually reads - never run through `WidgetStrings`, never
 * translated, the same "the widget owns the frame, not the content" split this file's own remarks on
 * `channelSwitcherGroupLabel` already draw for a brand name rather than a tenant's own words. An
 * unrecognised `kind` falls back to the raw wire string itself, verbatim - never a generic "channel"
 * placeholder that would be a worse label than the one the server already sent, and never a dropped
 * row (`25-149`'s own explicit Done-when).
 */
const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
  Telegram: "Telegram",
  WhatsApp: "WhatsApp",
  Vk: "VK",
  Max: "MAX",
};

/**
 * `25-136`: enables or disables every interactive control a rendered primitive holds - the buttons
 * `appendActionButtons` builds for the three choice-shaped kinds, or the input/submit pair `form`
 * builds (`ui/primitives/render.ts`). This is the module-step gate's own lock, distinct from
 * `render.ts`'s own `disableAll` (which freezes a primitive permanently once a visitor has already
 * replied) - this one is reversible, flipped back on the moment the gating contact-capture form is
 * submitted successfully.
 */
function setPrimitiveControlsDisabled(container: HTMLElement, disabled: boolean): void {
  container.querySelectorAll("button, input").forEach((element) => {
    (element as HTMLButtonElement | HTMLInputElement).disabled = disabled;
  });
}

/**
 * `25-146`: the one additional place besides `ui/primitives/render.ts` that ever looks inside a
 * message's own `content` before checking `contentKind` first (`MessageDto.content`'s own doc
 * comment) - narrowly, for exactly the one field `appendMessageBubble`'s own phone-collection gate
 * needs, never a second, independent assumption about a `form` step's whole shape. Malformed or
 * missing `content` degrades to `null` rather than throwing, the identical posture `render.ts`'s own
 * `asRecord`/optional-chaining reads already take for the same reason: Chat itself never opens this
 * payload (`adr/0065` §1), so nothing downstream of the wire can assume a module got its own shape
 * right.
 */
function readFormFieldId(content: unknown): string | null {
  if (typeof content !== "object" || content === null) {
    return null;
  }

  const fieldId = (content as { fieldId?: unknown }).fieldId;
  return typeof fieldId === "string" ? fieldId : null;
}

/**
 * `25-120`: the fixed, curated 40-emoji set the backlog item names, verbatim and in that exact
 * order - a flat, static list, never a search index or a category tree (`docs/backlog/
 * 25-120-*.md`'s own Scope: "no search, no categories, no recently-used tracking, no skin-tone
 * variants"). Forty literal characters cost nothing meaningful against the gzip budget - the
 * alternative this item explicitly rules out is an npm emoji-picker package, which would drag in
 * thousands of entries, a keyword index and skin-tone variants this fixed-40 scope has no use for.
 */
const EMOJI_PICKER_GLYPHS: readonly string[] = [
  "😀", "😊", "🙂", "😉", "😂", "😍", "🤔", "😮", "😢", "😡", "😴", "🥳",
  "👍", "👎", "🙏", "👏", "🤝", "💪", "✋", "👋",
  "❤️", "💔", "⭐", "🔥", "✅", "❌", "⚠️", "❓",
  "🎉", "🎁", "📅", "📞", "📧", "🕒", "💰", "🛒", "📦", "🚀", "💡", "📎",
];

/** 40 divides evenly by this, so every column has exactly the same number of rows and `ArrowUp`/
 * `ArrowDown` in `handleEmojiPickerKeydown` never has to special-case a short last row. */
const EMOJI_PICKER_COLUMNS = 8;

/**
 * Assembles the widget's whole visible surface inside one Shadow DOM root. This is intentionally
 * one class rather than a component framework: the panel has a fixed, small set of views (closed,
 * connecting, open) and pulling in a UI framework's runtime for that would blow the bundle budget
 * a hand-rolled ~200 lines of DOM code does not (embeddable-widget skill's Bundle budget rule).
 */
export class ChatWidget {
  private readonly storage: WidgetStorage;
  private readonly sessionManager: VisitorSessionManager;
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly container: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  /** `11-10`: null exactly when `config.demoNotice === "none"` (a real shop's embed) - the same
   * three-state read `applyStrings` re-does to keep this element's text in the site's real language,
   * see that method's own remarks for the bug this field exists to close. */
  private readonly notice: HTMLDivElement | null;
  /** `16-04`: never `null` - unlike `notice` above, this element always exists (so its position in the
   * DOM is stable from the constructor onward) and is simply `hidden` until `applyProcessingNotice`
   * has something to show. See that method for why "exists but hidden" beats "created on demand" here. */
  private readonly processingNotice: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  /** `25-141`: the closed launcher's own unread-count badge - a child of `toggle` itself (not a
   * sibling positioned over it) so it moves, scales and disappears with the button for free, and so
   * a click anywhere on the launcher - including on the badge's own circle - still reaches `toggle`'s
   * click handler. `renderUnreadBadge` is the only writer. */
  private readonly unreadBadge: HTMLSpanElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly messages: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly attachButton: HTMLButtonElement;
  /** `25-120`: the real button that fills the place `23-61` reserved and explicitly deferred ("An
   * emoji picker. This reserves its place; choosing and building one is a separate item.") - icon-
   * only, the same "accessible name from `aria-label` alone" shape every other composer-row button
   * already uses. `25-127`: the glyph itself is a real `sentiment_satisfied` Material Symbols Outlined
   * SVG now, via `createSvgIcon`, matching `attachAFile`/`saveConversation`'s own convention exactly -
   * it used to render a literal 🙂 character on the theory that no honest "emoji" glyph existed in that
   * source, which was true only until this item went and found the actual "satisfied face" one.
   * Gated on the identical `isConnected || autoOpenedWithoutConnecting` signal `updateSendButtonEnabled`
   * already uses, not `attachButton`'s stricter `isConnected`-only one - inserting an emoji is a local
   * textarea edit, not a call to the server the way an upload or an archive build is, so it should be
   * exactly as available as typing itself already is. */
  private readonly emojiButton: HTMLButtonElement;
  /** `25-120`: the picker's own popover, hidden by default and toggled by `emojiButton` - a
   * `role="grid"` of `role="gridcell"` buttons (`emojiCells` below), the ARIA Authoring Practices'
   * own pattern for "a 2-D grid of simple, equally-weighted choices" (its own worked example is an
   * emoji picker). Chosen over `role="listbox"`/`role="menu"` because arrow-key movement here is
   * genuinely two-dimensional (`ArrowUp`/`ArrowDown` cross rows, `ArrowLeft`/`ArrowRight` cross
   * columns) - a listbox's own one-dimensional model would have to fake the vertical axis, which a
   * grid already names correctly. Anchored to `.ago-composer-controls` (`position: relative` there,
   * `ui/styles.css`) rather than a second, differently-styled overlay mechanism - reuses this row's
   * own sizing/spacing rather than inventing a new surface. */
  private readonly emojiPicker: HTMLDivElement;
  /** `25-120`: every cell button in `emojiPicker`, in the same row-major order as
   * `EMOJI_PICKER_GLYPHS` - what `handleEmojiPickerKeydown`'s roving-tabindex arithmetic walks.
   * Kept alongside the picker itself rather than re-queried from the DOM on every keypress. */
  private readonly emojiCells: readonly HTMLButtonElement[];
  /** `23-62`: the real button that fills the second reserved place `23-61` left - a down-arrow icon
   * (the author's own decision, recorded in the backlog item), disabled/enabled on the identical
   * `isConnected` signal `attachButton` already uses, since building the archive needs the same live
   * connection an attach does (`saveConversation`'s own `fetchOlderPage`/`fetchAttachmentLocation`
   * calls). */
  private readonly saveButton: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly focusTrap: FocusTrap;
  /** `20-07`: `null` unless the site's own handshake response grants booking. Nullable is what
   * makes "a shop without booking pays nothing" a property of the object graph rather than a
   * promise - and even once non-null, its label stays empty and it stays `hidden` until
   * `loadBookingModuleChip` below has the lazy module's own copy, so no calendar-flavored copy
   * exists anywhere before that bundle is actually fetched. Clicking it does not open a second view
   * - it inserts and sends a trigger phrase exactly as if the visitor had typed it (`invokeModule`),
   * so nothing else in this class's own state changes because of it.
   *
   * `23-105`: used to be decided synchronously in the constructor, off `config.bookingModuleEnabled`
   * - itself read from the tenant's own `data-booking` attribute, the fact `config.ts`'s own remarks
   * explain is no longer the tenant's page to assert. The decision moved to `loadBookingModuleChip`,
   * which awaits the handshake response and only then creates and inserts this element - so
   * `moduleChip` is still `null` for the entire synchronous part of construction, and this field
   * stays `readonly` in spirit (`loadBookingModuleChip` is the one place that ever assigns it, at
   * most once, mirroring how the constructor used to be the one place that did). */
  private moduleChip: HTMLButtonElement | null = null;
  /** `25-149`: `null` until `loadChannelSwitcherCard` has decided the card should exist at all
   * (`session.channelLinks` non-empty and not already dismissed for this visitor identity) - a site
   * with nothing connected, or a returning visitor who already dismissed it, builds no element here,
   * the identical "pays nothing" property `moduleChip` above already gives its own feature. Once built
   * it is never removed, only ever hidden (`dismissChannelSwitcher`) - `open()`/`openForAutoGreeting()`
   * need no reveal logic of their own for it, since it is an ordinary child of `this.panel` on the
   * identical footing `this.messages`/`composer` already are. */
  private channelSwitcherCard: HTMLDivElement | null = null;
  /** `25-191`/`25-192`: `null` until `buildChannelSwitcherLauncherRow` decides the row should exist
   * at all - the identical "pays nothing" property `channelSwitcherCard` above already gives its own
   * placement. Unlike that card, this element's own visibility is not fixed at build time and is not
   * a plain function of `this.panel.hidden` either: it is a sibling of `this.toggle`, not a child of
   * `this.panel`, so nothing about the panel's own state hides it for free, and `25-192`'s own
   * correction made the real rule "visible on hover while closed, always hidden while open" rather
   * than "visible exactly while open" - see `updateChannelSwitcherLauncherVisibility`. */
  private channelSwitcherLauncherRow: HTMLDivElement | null = null;
  /** `25-192`: the live half of that same rule - whether the pointer is currently over `this.toggle`.
   * Tracked explicitly rather than read from `:hover` at the moment it matters, because the row's
   * own visibility also has to react to `open()`/`close()` themselves (a chat that closes while the
   * pointer never moved must reveal the row immediately, with no fresh `pointerenter` to trigger
   * it) - a single source of truth `updateChannelSwitcherLauncherVisibility` reads alongside
   * `this.isOpen` covers both triggers with one function.
   *
   * `25-203`: renamed from `isToggleHovered` and widened to cover a second element. The toggle and
   * `channelSwitcherLauncherRow` sit side by side as one hoverable region (`ui/styles.css`'s own
   * `.ago-channel-switcher-launcher` grows outward from `.ago-toggle`, with a real gap between the
   * two boxes) - tracking only the toggle meant the pointer crossing that gap on its way to an icon
   * read as "hover lost" the instant it left the toggle's own box, hiding the row before it could
   * ever be reached (a classic "hover island": two adjacent elements where only one notices the
   * pointer). Both elements now write this same flag, so hovering *either* one keeps the row
   * visible - the two `pointerenter`/`pointerleave` listeners on the row below are the toggle's own
   * pair's exact counterpart.
   *
   * Writing `true` happens immediately, on either element's own `pointerenter` - only the write back
   * to `false` is ever delayed, and only by `hoverLeaveTimer` below (`HOVER_REGION_LEAVE_GRACE_MS`'s
   * own doc comment has the reasoning: two elements each reacting to their own hover is not yet one
   * region unless something bridges the real gap between them, and that something is time, not
   * geometry). */
  private isHoverRegionActive = false;
  /** `25-203`: the in-flight grace-period timer scheduled by a `pointerleave` on either the toggle or
   * the launcher row, or `null` when none is pending - the identical `ReturnType<typeof setTimeout> |
   * null` shape `attentionTimer`/`autoOpenTimer` above already use. A fresh `pointerenter` on either
   * element (`cancelHoverRegionLeaveTimer`) clears it before it ever fires, which is the whole
   * mechanism: a crossing that completes within the grace period never reaches the timer callback that
   * would have written `isHoverRegionActive = false`. */
  private hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** `25-197`: the session's own connected channels, captured once in `loadChannelSwitcher`
   * regardless of which placement renderer runs - `toggleOpen` needs to know whether there is
   * anything to route to *synchronously*, at the moment of a click, which neither
   * `channelSwitcherCard`/`channelSwitcherLauncherRow` (placement-specific, built lazily, and
   * `null` for a site on the other placement) can answer on their own. Empty until the handshake
   * resolves - a click before then falls through to opening the chat directly, the same honest
   * degradation this widget already accepts for `loadBookingModuleChip`'s own chip. */
  private channelLinks: ChannelLinkDto[] = [];
  /** `25-197`: `null` until first needed - built lazily on the first click this item's own gate
   * actually fires for, not eagerly alongside the two existing switcher renderers, since most
   * visitors (anyone with a hover-capable pointer) never trigger it at all. */
  private touchRoutingSheet: HTMLDivElement | null = null;
  private readonly composer: HTMLFormElement;
  /** `11-10`: the widget's own built-in language until `bootstrapSession` resolves the site's real
   * one (`applyStrings`'s own doc comment). Every piece of DOM this class builds is constructed
   * against whatever `this.strings` holds at the time - initially this English default, so "no
   * `WidgetLocale` set" renders identically to before this item existed. */
  private strings: WidgetStrings = en;
  /** `20-07`: mirrors `this.strings` one level down - `applyStrings` sets both from the same
   * resolved value. A lazily-loaded module owns its own tiny string table keyed by this same
   * `SupportedLocale` (`modules/booking/chip.ts`) rather than reading `WidgetStrings`, so the base
   * bundle's own string table never grows a module's copy - this is the one piece of resolved
   * locale state a module needs and the base bundle already has. */
  private locale: SupportedLocale = "en";

  private connection: VisitorConnection | null = null;
  private connectPromise: Promise<void> | null = null;
  /** `11-03`: kicked off eagerly from the constructor (not lazily on first open) - see
   * `bootstrapSession`'s own doc comment for why. `connect()` awaits this same promise rather than
   * calling `getOrCreateVisitorSession` a second time. */
  private readonly sessionPromise: Promise<VisitorSession>;
  private session: VisitorSession | null = null;
  private conversationId: string | null = null;
  private isOpen = false;
  private isConnected = false;
  /**
   * `25-141`: how many messages from "the other side of the conversation" (`appendMessageBubble`'s
   * own `authorKind !== "Visitor"` test, reused rather than narrowed to `Operator` alone - a `System`
   * module prompt or a materialised `AutoGreeting` arriving while the panel is closed is just as
   * unread) have arrived since the panel was last opened. `25-141`'s own scope kept this in-memory
   * only, for one page load, deferring "survives a reload" to `25-143` as a materially different
   * mechanism - `bootstrapSession` now seeds this field from `GET .../unread-count` (a plain HTTP
   * read against the last position `WidgetStorage.getLastReadSequence` remembers) before this widget
   * ever renders a bubble, so a reload no longer starts back at zero regardless of what arrived while
   * the tab was closed. Live increments while the panel stays closed this same page load
   * (`handleIncoming` below) still add to whatever the seed produced, rather than replacing it - the
   * two mechanisms answer the same question for two non-overlapping windows (before this page load
   * existed, and during it) and are simply summed. Reset to zero by `open()` and `openForAutoGreeting()`
   * alike, since both put the transcript in front of the visitor - never read directly outside
   * `renderUnreadBadge`, which is the one place that turns this number into what the visitor (and a
   * screen reader) sees.
   */
  private unreadCount = 0;
  /** `23-07`: at most one `open` beacon per session (this widget instance's own lifetime), never one
   * per click - see `open()`'s own doc comment. */
  private openBeaconSent = false;
  /** `17-07`: set once the server has refused to renew this visitor's token mid-session. Terminal
   * for this page load - see `handleSessionExpired` for why the widget stops rather than quietly
   * minting a second identity underneath a transcript that belongs to the first. */
  private isSessionExpired = false;
  /**
   * The optimistic bubble for each message this panel has sent and not yet seen come back, keyed by
   * the `clientMessageId` it was sent under.
   *
   * `5-17`: a `Map` keyed by that id, not the array-and-`shift()` this used to be. The array paired
   * an echo with a bubble by *queue position*, which is only correct while every entry is eventually
   * matched by exactly one echo - one failed send offset the pairing permanently, so every later
   * echo removed the bubble before the one it belonged to: the failure notice vanished and the
   * message that did send rendered twice. The id was already on the wire in both directions
   * (`5-12`); nothing compared it to anything.
   *
   * Entries are removed by exactly two things: the echo that matches them (`handleIncoming`), and a
   * send failing in a way that means the server never saw it (`dispatchSend`). An unconfirmed send
   * is deliberately neither - see `dispatchSend`'s `SendOutcomeUnknownError` branch.
   */
  private readonly pendingSends = new Map<string, HTMLDivElement>();

  /**
   * `23-62`: every `MessageDto` this panel has ever rendered, keyed by id - populated in the one
   * place every message this widget shows already passes through (`appendMessageBubble`), so it
   * needs no separate wiring for the initial history page, a live arrival or a reconnect's own delta
   * replay. This is the seed set `saveConversation` walks *backward* from (`VisitorConnection.
   * loadOlderHistory`) to reach whatever the visitor never scrolled to - "the conversation" means
   * everything the visitor could see, not only whatever page happened to be loaded when they clicked
   * save (the backlog item's own words). A `Map`, not an array, for the same reason `pendingSends`
   * above is one: a message can arrive more than once on the wire (a resumed connection's delta can
   * overlap history already rendered) and this must not double-count it.
   */
  private readonly renderedMessages = new Map<string, MessageDto>();
  /** Guards against a second click starting a second archive build while the first is still walking
   * history and fetching attachments - `saveConversation`'s own `finally` is what clears it. */
  private isSavingConversation = false;

  /**
   * `23-09`/`23-58`: `true` once the contact form has actually been rendered by *either* of its two
   * entry points - the out-of-hours auto-reply (`14-04`'s `System` message, unchanged since `23-09`)
   * or `23-58`'s online link under the visitor's own first message - so that at most one is ever
   * active in a conversation. `SendOfflineAutoReplyHandler`'s own loop guard makes a second `System`
   * message unreachable, so the out-of-hours side of this only ever needs "once, not per-message";
   * `23-58` is what makes "once per open panel" load-bearing across *two* triggers rather than one.
   * `appendVisitorIntroControl` deliberately does *not* set this the moment the link appears - only a
   * click (or the out-of-hours path pre-empting it, see the `System` branch in `appendMessageBubble`)
   * does, because the link on its own has not yet shown the form it is named for.
   */
  private contactCaptureShown = false;

  /**
   * `23-58`: guards the online entry point's own trigger separately from `contactCaptureShown` above -
   * "has a link already been offered under *a* visitor message" is a different question from "has the
   * form been shown," precisely because showing the link does not set `contactCaptureShown`. Without
   * this flag, every subsequent visitor message would grow its own link.
   */
  private visitorIntroControlOffered = false;

  /**
   * `23-58`: the link's own container, kept so the out-of-hours branch in `appendMessageBubble` can
   * remove it the moment a `System` auto-reply supersedes it - an unclicked link left in the DOM next
   * to the real form would be a second, dead entry point into the same control.
   */
  private visitorIntroControlEl: HTMLElement | null = null;

  /**
   * `23-63`: the in-flight `setTimeout` for the next scheduled pulse or the end of the current one,
   * or `null` when nothing is scheduled. Cleared and re-`null`ed by `stopAttractAttention` - the one
   * thing that makes "stops the moment it's opened" an immediate, synchronous fact rather than
   * something that merely stops scheduling *future* pulses while a pulse already in flight finishes.
   */
  private attentionTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `23-63`: `true` once the launcher must never animate again for the rest of this page view - the
   * bound in `MAX_ATTRACT_ATTEMPTS` reached, the panel opened at least once, or `prefers-reduced-motion`
   * ruled it out at the moment scheduling was attempted. There is deliberately no path that clears
   * this back to `false`: every one of those three is a one-way door for a single page view, matching
   * "somebody who closed it has answered" from the backlog item's own scope - a visitor who reopens
   * and re-closes the panel does not get a second round of pulses either.
   */
  private attentionExhausted = false;

  /**
   * `23-64`/`adr/0148`: the in-flight `setTimeout` for the scheduled auto-open, or `null` when
   * nothing is scheduled - the identical shape `attentionTimer` already has, for the identical
   * reason (`open()` needs to cancel it synchronously the moment a visitor opens the panel
   * themselves, before the timer would otherwise fire).
   */
  private autoOpenTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `23-64`: the drawn greeting's own bubble, or `null` once nothing is showing that has not yet
   * been materialised - tracked so `handleIncoming`'s own `AutoGreeting` branch can remove it the
   * moment the real message arrives, in place, rather than leaving a duplicate or letting the real
   * copy land at the bottom of the transcript out of order (this field's own remarks on
   * `handleIncoming` have the full reasoning).
   */
  private drawnGreetingBubble: HTMLDivElement | null = null;

  /**
   * `23-64`/`adr/0148`: `true` from the moment `openForAutoGreeting` reveals the panel until the
   * visitor's first send resolves (or the panel is closed and reopened through the ordinary
   * `open()`, which connects immediately and makes this moot) - the signal that lets the composer
   * accept input, and a send succeed, on a panel this widget deliberately never connected the hub
   * for (`adr/0148`'s "nothing reaches the server until the visitor writes"). `isConnected` alone
   * cannot mean this: it only ever becomes `true` once a real hub connection exists, which is
   * exactly what auto-open must not create before the visitor writes.
   */
  private autoOpenedWithoutConnecting = false;

  constructor(private readonly config: WidgetConfig) {
    this.storage = new WidgetStorage(config.siteKey);
    this.sessionManager = new VisitorSessionManager(config, this.storage);
    const { host, root } = createShadowHost();
    this.host = host;
    this.root = root;

    const container = document.createElement("div");
    container.className = "ago-root";
    this.container = container;

    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "ago-toggle";
    this.toggle.setAttribute("aria-haspopup", "dialog");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", this.strings.openChat);
    // Material Symbols Outlined: chat_bubble
    this.toggle.appendChild(
      createSvgIcon(
        CHAT_BUBBLE_ICON_PATH,
      ),
    );
    // `25-141`: a child of `toggle`, hidden by default - `renderUnreadBadge` is the only thing that
    // ever shows it, never this constructor. `aria-hidden`: the accessible name for "unread" lives
    // entirely on `toggle`'s own `aria-label` (`renderUnreadBadge` again), so a screen reader must not
    // also announce this span's bare digit as a second, redundant fact.
    this.unreadBadge = document.createElement("span");
    this.unreadBadge.className = "ago-unread-badge";
    this.unreadBadge.setAttribute("aria-hidden", "true");
    this.unreadBadge.hidden = true;
    this.toggle.appendChild(this.unreadBadge);
    this.toggle.addEventListener("click", () => this.toggleOpen());
    // `25-192`: pointerenter/pointerleave, not mouseenter/mouseleave - this project's own target
    // browser matrix includes touch devices, and pointer events are what fire consistently for a
    // Shadow DOM host across both input types without a second, mouse-specific listener pair.
    // Nothing here assumes a pointer type: touch's own synthetic hover (a tap-and-hold in some
    // browsers) is out of this item's scope, not specifically excluded.
    this.toggle.addEventListener("pointerenter", () => this.enterHoverRegion());
    this.toggle.addEventListener("pointerleave", () => this.scheduleHoverRegionLeave());

    this.panel = document.createElement("div");
    this.panel.className = "ago-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "false");
    this.panel.setAttribute("aria-label", this.strings.chatLabel);
    this.panel.hidden = true;
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });

    const header = document.createElement("div");
    header.className = "ago-header";
    this.title = document.createElement("h1");
    this.title.textContent = this.strings.chatWithUs;
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "ago-close";
    this.closeButton.setAttribute("aria-label", this.strings.closeChat);
    // Material Symbols Outlined: close
    this.closeButton.appendChild(
      createSvgIcon(
        "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
      ),
    );
    this.closeButton.addEventListener("click", () => this.close());

    // `20-07`: **one script tag, one launcher, one panel, one transcript.** Booking is no longer a
    // second view swapped in over the conversation (`20-06`'s `BookingPanel`) - it is the
    // conversation, carried by ordinary chat messages (`ui/primitives/render.ts`). This chip is
    // purely an invocation shortcut: clicking it sends the module's trigger phrase, exactly as if
    // the visitor had typed it themselves (`invokeModule`), and everything that follows renders
    // inline in `.ago-messages` like any other message.
    //
    // `23-105`: nothing built here any more - `moduleChip` stays `null` until
    // `loadBookingModuleChip` learns the site actually has a grant, so a shop with no booking still
    // pays for exactly nothing here, the same "absent entirely" property this element always had.
    header.append(this.title, this.closeButton);

    // `8-06`: directly under the header and outside `.ago-messages`, so it is the first thing read
    // when the panel opens and cannot be scrolled away by the conversation underneath it. Not
    // dismissible: the thing it warns about (typing something real) is available on every keystroke,
    // not once at open time, so a close button would only ever remove the warning from the exact
    // moment it applies. Not a `.ago-message--system` bubble either - a bubble reads as chat history
    // and scrolls off with it.
    // `8-11`: three states, and the default is silence. A real shop's embed asks for neither
    // sentence and gets neither.
    const noticeText =
      config.demoNotice === "public" ? this.strings.publicDemoNotice
      : config.demoNotice === "private" ? this.strings.privateDemoNotice
      : null;
    this.notice = noticeText === null ? null : createDemoNotice(noticeText);

    // `16-04`: directly under the demo notice (if any) and outside `.ago-messages`, for the identical
    // reason `8-06`'s own comment states - the first thing read when the panel opens, never scrollable
    // away, present before the visitor can type anything (the composer below stays disabled until
    // connected regardless, so there is no race to win here, only a DOM position to get right).
    this.processingNotice = createProcessingNotice();

    this.messages = document.createElement("div");
    this.messages.className = "ago-messages";
    // aria-live for incoming messages (embeddable-widget skill's accessibility baseline) -
    // "polite" so a message does not interrupt whatever the visitor is doing right now.
    this.messages.setAttribute("aria-live", "polite");
    this.messages.setAttribute("role", "log");

    this.status = document.createElement("div");
    this.status.className = "ago-status";
    this.status.textContent = this.strings.connecting;

    const composer = document.createElement("form");
    composer.className = "ago-composer";
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendCurrentMessage();
    });

    this.input = document.createElement("textarea");
    this.input.className = "ago-input";
    this.input.rows = 1;
    this.input.setAttribute("aria-label", this.strings.messageAriaLabel);
    this.input.placeholder = this.strings.typeAMessage;
    this.input.disabled = true;
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendCurrentMessage();
      }
    });
    this.input.addEventListener("input", () => this.updateSendButtonEnabled());

    // `23-61`: icon-only now (no visible label), so the accessible name has to come from
    // `aria-label` alone - textContent carries only the glyph. `aria-label` wins the accessible-name
    // computation over text content regardless, the same rule `attachButton` below already relies on
    // for its own emoji-plus-label shape; this is that same pattern applied to `send`, not a new one.
    this.sendButton = document.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "ago-send";
    this.sendButton.setAttribute("aria-label", this.strings.send);
    // Material Symbols Outlined: send
    this.sendButton.appendChild(
      createSvgIcon(
        "M120-160v-640l760 320-760 320Zm80-120 474-200-474-200v140l240 60-240 60v140Zm0 0v-400 400Z",
      ),
    );
    this.sendButton.disabled = true;

    // A native file picker, not a drag-and-drop zone or a custom widget - the skill's
    // accessibility baseline (keyboard reachable) is free with `<input type="file">` and would
    // need to be rebuilt by hand for anything fancier, for a feature this item does not ask for.
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.className = "ago-file-input";
    this.fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = ""; // same file picked twice in a row still fires `change`
      if (file) {
        this.handleFileSelected(file);
      }
    });

    this.attachButton = document.createElement("button");
    this.attachButton.type = "button";
    this.attachButton.className = "ago-attach";
    this.attachButton.setAttribute("aria-label", this.strings.attachAFile);
    // Material Symbols Outlined: attach_file
    this.attachButton.appendChild(
      createSvgIcon(
        "M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-370h80v370q0 13 8.5 21.5T470-320q13 0 21.5-8.5T500-350v-350q-1-42-29.5-71T400-800q-42 0-71 29t-29 71v370q-1 71 49 120.5T470-160q70 0 119-49.5T640-330v-390h80v390Z",
      ),
    );
    this.attachButton.disabled = true;
    // `23-78`: hidden until `connect()` learns this conversation actually carries a grant - the
    // `moduleChip` precedent right below this file's own remarks on it ("`hidden` guards this too...
    // `disabled` only matters once revealed"), applied here from construction time rather than a
    // later reveal, since there is no lazy bundle to await first. "The widget shows no upload control
    // until then" (the backlog item's own Done-when) means hidden, not merely disabled - a disabled-
    // but-visible control still advertises that uploads exist as a feature of this site's widget.
    this.attachButton.hidden = true;
    this.attachButton.addEventListener("click", () => this.fileInput.click());

    this.emojiButton = document.createElement("button");
    this.emojiButton.type = "button";
    this.emojiButton.className = "ago-emoji";
    this.emojiButton.setAttribute("aria-label", this.strings.insertEmoji);
    this.emojiButton.setAttribute("aria-haspopup", "grid");
    this.emojiButton.setAttribute("aria-expanded", "false");
    // `25-127`: a real Material Symbols Outlined icon now (`sentiment_satisfied`), matching every
    // other composer-row control's own `createSvgIcon(d)` convention - the literal 🙂 character this
    // used to render was the one control in this row that did not, found live off a screenshot. Path
    // data verbatim from Google's own `material-design-icons` source, `-960 0 960 960` viewBox family
    // (`symbols/web/sentiment_satisfied/materialsymbolsoutlined/sentiment_satisfied_24px.svg`).
    this.emojiButton.appendChild(
      createSvgIcon(
        "M620-520q25 0 42.5-17.5T680-580q0-25-17.5-42.5T620-640q-25 0-42.5 17.5T560-580q0 25 17.5 42.5T620-520Zm-280 0q25 0 42.5-17.5T400-580q0-25-17.5-42.5T340-640q-25 0-42.5 17.5T280-580q0 25 17.5 42.5T340-520Zm140 260q68 0 123.5-38.5T684-400h-66q-22 37-58.5 58.5T480-320q-43 0-79.5-21.5T342-400h-66q25 63 80.5 101.5T480-260Zm0 180q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 320q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Z",
      ),
    );
    this.emojiButton.disabled = true;
    this.emojiButton.addEventListener("click", () => this.toggleEmojiPicker());

    const { picker, cells } = this.buildEmojiPicker();
    this.emojiPicker = picker;
    this.emojiCells = cells;

    // `23-62`: a real button now, in the place `23-61` reserved for it - a down-arrow icon, the
    // author's own decision (backlog item's own "Decision" line). Sized and laid out identically to
    // `attachButton` (`.ago-save` mirrors `.ago-attach` in `ui/styles.css`) so the row keeps reading as
    // one aligned icon strip; `aria-label` carries the whole accessible name, the same icon-only shape
    // `sendButton` above already uses, since the glyph itself says nothing a screen reader can use.
    this.saveButton = document.createElement("button");
    this.saveButton.type = "button";
    this.saveButton.className = "ago-save";
    this.saveButton.setAttribute("aria-label", this.strings.saveConversation);
    this.saveButton.title = this.strings.saveConversation;
    // Material Symbols Outlined: download
    this.saveButton.appendChild(
      createSvgIcon(
        "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z",
      ),
    );
    this.saveButton.disabled = true;
    this.saveButton.addEventListener("click", () => guardAsync(() => this.saveConversation()));

    // `23-61`: the field's own full-width row, alone - the composer's whole reason for existing is
    // this field, and `.ago-composer-row` styling (`ui/styles.css`) is what actually widens it, this
    // is only what stops the send button from sharing the row `attachButton` used to narrow it from.
    // Send stays beside the field rather than moving to the row below with `attachButton`: it is "the
    // one control that must never become hard to hit" (the backlog item's own words), so it stays
    // where a visitor's eye already is the moment they finish typing, not one row further down.
    const composerRow = document.createElement("div");
    composerRow.className = "ago-composer-row";
    composerRow.append(this.input, this.sendButton);

    // `23-61`/`23-62`: the second row - attach, the still-reserved emoji place, then save, in the
    // backlog item's own order.
    const composerControls = document.createElement("div");
    composerControls.className = "ago-composer-controls";
    composerControls.append(
      this.attachButton,
      this.fileInput,
      this.emojiButton,
      this.emojiPicker,
      this.saveButton,
    );

    composer.append(composerRow, composerControls);
    this.panel.append(header);
    if (this.notice) {
      this.panel.append(this.notice);
    }
    this.panel.append(this.processingNotice);

    this.composer = composer;
    this.panel.append(this.messages, this.status, composer);

    container.append(this.panel, this.toggle);
    this.root.appendChild(container);

    this.focusTrap = new FocusTrap(this.panel);

    // `11-03`: fired here, not on first open - see `bootstrapSession`'s own doc comment. Stored so
    // `connect()` can await the same in-flight (or already-resolved) request instead of calling
    // `getOrCreateVisitorSession` a second time; wrapped in `guardAsync` so a failure here (visitor
    // never opens the widget at all, so `connect()` never gets a chance to observe or report it)
    // cannot surface as an `unhandledrejection` on the host page.
    this.sessionPromise = this.bootstrapSession();
    guardAsync(async () => {
      await this.sessionPromise;
    });

    // `20-07`: kicked off here, not on first open and not on chip click - "when the widget's config
    // says a module chip should render" (the item's own words). `23-105`: that fact moved from the
    // script tag to the handshake response, so it is no longer knowable at this point in the
    // constructor - called unconditionally now, and `loadBookingModuleChip` itself awaits
    // `sessionPromise` before deciding whether to build the chip at all. Never touches
    // `src/modules/` statically - that method's own doc comment explains why the base bundle stays
    // unaffected either way, whether or not the lazy chunk is ever actually fetched.
    guardAsync(() => this.loadBookingModuleChip());

    // `25-149`/`25-173`: the identical "kicked off here, not on first open" shape `loadBookingModuleChip`
    // just above already has, for the identical reason - the fact that decides whether either
    // channel-switcher renderer exists at all (`session.channelLinks`, `session.widgetChannelSwitcherPlacement`)
    // is not knowable until the handshake resolves, and `loadChannelSwitcher`'s own `await
    // this.sessionPromise` is what lets an auto-opened panel get it too.
    guardAsync(() => this.loadChannelSwitcher());
  }

  /**
   * `23-07`: the load beacon fires here, before and independently of `bootstrapSession`
   * (`this.sessionPromise`, kicked off from the constructor rather than here) - a mount whose session
   * bootstrap goes on to fail (a rejected mint, a network error) still honestly counts as a load: this
   * method's own job is "attach the widget's DOM to the host page", which by definition already
   * happened by the time this call is reached. `sendBeacon` is fire-and-forget (that function's own
   * doc comment), so this method's own signature and behaviour are otherwise unchanged.
   */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.host);
    sendBeacon(this.config, fetch, "load");
  }

  /**
   * `11-03`: resolves the visitor's identity and applies the site's widget config (color, launcher
   * position) to the closed, not-yet-opened launcher - this has to happen before any interaction,
   * since the position affects where the toggle button itself renders, not just the panel a click
   * would reveal. Reuses `VisitorSessionManager.start`'s storage short-circuit for a returning
   * visitor (that method's own doc comment states the three paths it can take).
   *
   * The brief window between mount and this promise resolving renders with the widget's own built-in
   * appearance (this class's own CSS defaults) - for a first-time visitor this is a real network
   * round trip, typically well under the time it takes a person to notice or react, and for a
   * returning visitor with a token nowhere near expiry it resolves synchronously-fast from storage
   * with no request at all.
   *
   * `17-07`: this is also where the widget says something when a returning visitor's identity could
   * not be carried over. `restarted` means the stored token was past renewing, so a *new*
   * `VisitorId` was minted and the previous conversation is not reachable from this browser any
   * more. The note is written into the message list here rather than at open time so it sits above
   * whatever the (new, empty) conversation goes on to contain, and it is written only for a visitor
   * who actually lost something - never for a first-ever arrival.
   *
   * `11-10`: also where the widget's own language resolves, in the same place and at the same time as
   * color and position - `applyStrings` is called *first*, before the `restarted` note, so that note
   * itself already renders in the resolved language rather than this widget's built-in default. There
   * is no reason to delay it: `session.widgetLocale` is already in hand at this point, the same way
   * `session.widgetPosition`/`widgetPrimaryColorHex` are already in hand for the two lines below it.
   *
   * `25-143`: also where the closed launcher's own unread badge (`25-141`) is seeded for a reload -
   * before `applyStrings` right below, which already reads `unreadCount` to set the closed toggle's
   * own accessible name, so the very first render must not still be looking at the in-memory default
   * of zero. A brand-new visitor - `WidgetStorage.getConversationId()` returns `null` here, including
   * right after a `restarted` identity replacement above, since `VisitorSessionManager.start` clears
   * the stored conversation before minting the new identity - makes no call at all: this item's own
   * Done-when ("a brand-new visitor... makes no extra call and shows no badge"), and there is no
   * conversation for the server to answer about regardless.
   */
  private async bootstrapSession(): Promise<VisitorSession> {
    const { session, restarted } = await this.sessionManager.start();
    this.session = session;

    const storedConversationId = this.storage.getConversationId();
    if (storedConversationId !== null) {
      const afterSequence = this.storage.getLastReadSequence(storedConversationId);
      this.unreadCount = await getUnreadCount(this.config, session.token, storedConversationId, afterSequence);
      this.renderUnreadBadge();
    }

    const locale = parseWidgetLocale(session.widgetLocale);
    this.locale = locale;
    this.applyStrings(locale);

    if (restarted) {
      this.renderSystemNote(this.strings.previousChatExpired);
    }

    this.container.classList.toggle("ago-position-left", parseWidgetPosition(session.widgetPosition) === "bottom-left");
    const color = parseWidgetColor(session.widgetPrimaryColorHex);
    if (color) {
      this.host.style.setProperty("--ago-accent", color);
    }

    this.applyProcessingNotice(session.widgetNoticeText, session.widgetNoticeUrl);

    // `23-63`: last, and gated on the resolved config rather than started unconditionally - a tenant
    // who never turned «Привлекать внимание» on gets a launcher that has never once considered
    // animating. `scheduleAttractAttention` itself re-checks `isOpen`/`attentionExhausted`, which
    // matters here specifically because a visitor can click the (already-rendered) launcher before
    // this handshake resolves - see that method's own doc comment.
    if (parseAttractAttention(session.widgetAttractAttention)) {
      this.scheduleAttractAttention();
    }

    // `23-64`/`adr/0148`: also last, and gated the identical way - a tenant who never turned
    // «Раскрывать виджет автоматически» on gets a panel that has never once considered opening
    // itself. `parseAutoOpenEnabled` requires *both* the flag and a usable greeting
    // (`parseAutoOpenGreetingText`) before this schedules anything - an enabled flag with nothing to
    // say has nothing this method could draw.
    const autoOpenGreetingText = parseAutoOpenGreetingText(session.widgetAutoOpenGreetingText);
    if (parseAutoOpenEnabled(session.widgetAutoOpenEnabled, autoOpenGreetingText)) {
      this.scheduleAutoOpen(autoOpenGreetingText!, parseAutoOpenDelaySeconds(session.widgetAutoOpenDelaySeconds));
    }

    return session;
  }

  /**
   * `16-04`: populates and reveals `this.processingNotice` from the resolved handshake, or leaves it
   * hidden - the widget's own default, matching "a default notice written by AGO would be AGO
   * asserting a legal position on the tenant's behalf" (the backlog item's own Scope). Both values are
   * independent and optional: a tenant may set text with no link, a link with no text, or neither.
   *
   * <b>Text is text, never markup.</b> `textContent`, the identical rule every other piece of
   * server-supplied or user-supplied content in this file already follows (`renderBubble`'s own
   * remarks) - a tenant's notice string is exactly as untrusted as a visitor's message body, and
   * nothing here ever touches `innerHTML`.
   *
   * <b>The link opens in a new context.</b> `target="_blank"` plus `rel="noopener noreferrer"`,
   * identical to `renderAttachmentInto`'s own attachment-download link - the tenant's policy page is a
   * different origin from this host page, and the visitor should be able to read it without losing
   * their place in the conversation or handing the new tab a `window.opener` back into this one.
   *
   * <b>Never throws.</b> `parseNoticeUrl` already rejects anything that is not an absolute `https://`
   * URL before it ever reaches `href` - a malformed value degrades to "no link", never a broken host
   * page, the same posture `parseWidgetColor`/`parseWidgetPosition` already take for their own fields.
   */
  private applyProcessingNotice(rawText: string | null, rawUrl: string | null): void {
    const text = parseNoticeText(rawText);
    const url = parseNoticeUrl(rawUrl);

    this.processingNotice.textContent = "";

    if (text === undefined && url === undefined) {
      this.processingNotice.hidden = true;
      return;
    }

    if (text !== undefined) {
      const textSpan = document.createElement("span");
      textSpan.className = "ago-processing-notice__text";
      textSpan.textContent = text;
      this.processingNotice.append(textSpan);
    }

    if (url !== undefined) {
      const link = document.createElement("a");
      link.className = "ago-processing-notice__link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = this.strings.processingNoticeLinkText;
      this.processingNotice.append(link);
    }

    this.processingNotice.hidden = false;
  }

  /**
   * `11-10`: resolves `this.strings` to the site's real language and re-applies every static piece of
   * text this class built with the English default in its constructor - the DOM-building code and
   * this method deliberately read the same `this.strings.*` fields rather than each owning its own
   * copy, so a new translatable string only ever needs adding once.
   *
   * Deliberately does **not** touch `this.status` - `renderConnectionState`/`handleSessionExpired`
   * are the only writers of that element and both already read `this.strings` at the time they run,
   * which by construction (`connect()` awaits the same `sessionPromise` this method is part of) is
   * always after this method has already resolved it. Re-writing it here on top of a state those
   * methods may already have set would be the bug, not the fix.
   */
  private applyStrings(locale: SupportedLocale): void {
    this.strings = getStrings(locale);
    const strings = this.strings;

    // `25-141`: the closed branch is unread-count-aware, matching `renderUnreadBadge`'s own choice -
    // a locale that resolves (or re-resolves) while the launcher is already carrying a count must not
    // silently drop back to the plain `openChat` sentence.
    this.toggle.setAttribute(
      "aria-label",
      this.isOpen ? strings.closeChat
      : this.unreadCount > 0 ? strings.openChatWithUnreadCount(this.unreadCount)
      : strings.openChat,
    );
    this.panel.setAttribute("aria-label", strings.chatLabel);
    this.title.textContent = strings.chatWithUs;
    this.closeButton.setAttribute("aria-label", strings.closeChat);
    // Found live: `this.notice`'s text was set once in the constructor from that moment's
    // `this.strings` (the English default) and never revisited - unlike every other element here, it
    // has no line of its own until this one, so a Russian-locale site's demo notice stayed in English
    // forever. Re-derives the same `config.demoNotice` three-way read the constructor made, against
    // the now-resolved `strings`.
    if (this.notice) {
      this.notice.textContent =
        this.config.demoNotice === "public" ? strings.publicDemoNotice : strings.privateDemoNotice;
    }
    this.input.setAttribute("aria-label", strings.messageAriaLabel);
    this.input.placeholder = strings.typeAMessage;
    this.sendButton.setAttribute("aria-label", strings.send);
    this.attachButton.setAttribute("aria-label", strings.attachAFile);
    this.emojiButton.setAttribute("aria-label", strings.insertEmoji);
    this.emojiPicker.setAttribute("aria-label", strings.emojiPickerLabel);
    this.saveButton.setAttribute("aria-label", strings.saveConversation);
    this.saveButton.title = strings.saveConversation;
  }

  /**
   * `25-197`: on a device with no hover at all (`(hover: none)` - true for essentially every
   * touchscreen phone, false for a mouse or trackpad even on a touchscreen laptop), the closed
   * toggle no longer opens the chat directly when there is somewhere else the visitor could go:
   * it opens the routing sheet instead, and only that sheet's own "Онлайн чат" row calls `open()`.
   * A site with nothing connected (`this.channelLinks.length === 0`) is unaffected - taps
   * straight into chat, exactly as before this item. Checked fresh on every click rather than
   * cached at construction, the identical "read the live fact, do not snapshot it" instinct every
   * other hover/open check in this file already follows - cheap, and a session that outlives a
   * device's own input-method change (a docked tablet gaining a mouse) is not a case worth
   * optimising away the correctness of.
   *
   * `window.matchMedia?.(...)?.matches ?? false` - the identical feature-detection shape
   * `scheduleAttractAttention`'s own remarks already establish for `prefers-reduced-motion`/
   * `pointer: coarse`, doubled here (both the call *and* the property read are optional) because
   * this path, unlike those two, is reachable on nearly every test that clicks the toggle at all -
   * `jsdom` implements no `matchMedia` by default, so `false` (behave exactly as before this item)
   * is what an environment that cannot answer the question gets, never a thrown exception.
   */
  private toggleOpen(): void {
    if (this.isOpen) {
      this.close();
      return;
    }

    if (this.isTouchRoutingDevice()) {
      this.openTouchRoutingSheet();
      return;
    }

    this.open();
  }

  /**
   * `25-197`'s own gate for routing a tap to the sheet instead of straight into chat - factored out
   * here (`25-198`) so `loadChannelSwitcher` can ask the identical question before building either
   * placement-specific renderer, rather than restating the expression and risking the two drifting
   * apart. `this.channelLinks` is read rather than a freshly-passed session, because both callers -
   * `toggleOpen` at click time, `loadChannelSwitcher` at handshake time - already have it as the one
   * source of truth `this.channelLinks`'s own doc comment describes.
   */
  private isTouchRoutingDevice(): boolean {
    return this.channelLinks.length > 0 && (window.matchMedia?.("(hover: none)")?.matches ?? false);
  }

  /** `25-197`: reveals the touch routing sheet, building it on first use - most visitors (anyone
   * with a hover-capable pointer) never trigger `toggleOpen`'s own gate for it at all, so building
   * it eagerly alongside the two placement-specific switcher renderers would be pure waste for
   * them, the identical "pays nothing" instinct this widget already applies to `moduleChip`/
   * `channelSwitcherCard`. */
  private openTouchRoutingSheet(): void {
    if (this.touchRoutingSheet === null) {
      this.touchRoutingSheet = this.buildTouchRoutingSheet();
    }

    this.touchRoutingSheet.hidden = false;
  }

  /** `25-197`: the sheet's own three ways to leave it - a channel row's own click, the "Отмена"
   * row, and the "Онлайн чат" row (after that row's own `open()` call) - all converge here. No
   * dismissed-forever memory, unlike `dismissChannelSwitcher`: this sheet is a routing step, not
   * an offer a visitor accepts or declines once - it reappears on the very next tap, by design. */
  private closeTouchRoutingSheet(): void {
    if (this.touchRoutingSheet !== null) {
      this.touchRoutingSheet.hidden = true;
    }
  }

  /**
   * `25-197`: the routing sheet itself - a question, one real row per connected channel (reusing
   * `buildChannelSwitcherRow` wholesale: the identical real `<a target="_blank"
   * rel="noopener noreferrer">` the above-composer card already builds, so a channel row here
   * opens exactly the way every other channel row in this codebase already does, plus one extra
   * listener that closes the sheet without touching the anchor's own navigation), an "Онлайн чат"
   * row that is the only row calling `open()`, and a "Отмена" row that closes the sheet with no
   * other effect. A sibling of `this.toggle` inside `this.container`, not a child of `this.panel` -
   * it has to be reachable while the panel is still closed, which is the whole point of it.
   */
  private buildTouchRoutingSheet(): HTMLDivElement {
    const sheet = document.createElement("div");
    sheet.className = "ago-touch-routing-sheet";
    sheet.hidden = true;
    // The backdrop is this element itself - clicking it (anywhere outside the panel below) closes
    // the sheet the same way "Отмена" does. A click that lands on the panel never reaches this
    // listener at all (it does not bubble past the panel's own click - every real control inside
    // it stops the event by virtue of not being this element).
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) {
        this.closeTouchRoutingSheet();
      }
    });

    const panel = document.createElement("div");
    panel.className = "ago-touch-routing-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", this.strings.channelSwitcherRoutingQuestion);
    sheet.append(panel);

    const question = document.createElement("div");
    question.className = "ago-touch-routing-question";
    question.textContent = this.strings.channelSwitcherRoutingQuestion;
    panel.append(question);

    for (const link of this.channelLinks) {
      const row = this.buildChannelSwitcherRow(link);
      row.classList.add("ago-touch-routing-row");
      row.addEventListener("click", () => this.closeTouchRoutingSheet());
      panel.append(row);
    }

    const onlineChatRow = document.createElement("button");
    onlineChatRow.type = "button";
    onlineChatRow.className = "ago-channel-switcher-row ago-touch-routing-row ago-touch-routing-row--chat";
    const chatIcon = createSvgIcon(CHAT_BUBBLE_ICON_PATH);
    chatIcon.setAttribute("aria-hidden", "true");
    onlineChatRow.append(chatIcon);
    const chatLabel = document.createElement("span");
    chatLabel.textContent = this.strings.channelSwitcherOnlineChat;
    onlineChatRow.append(chatLabel);
    onlineChatRow.addEventListener("click", () => {
      this.closeTouchRoutingSheet();
      this.open();
    });
    panel.append(onlineChatRow);

    const cancelRow = document.createElement("button");
    cancelRow.type = "button";
    cancelRow.className = "ago-channel-switcher-row ago-touch-routing-row ago-touch-routing-row--cancel";
    cancelRow.textContent = this.strings.channelSwitcherCancel;
    cancelRow.addEventListener("click", () => this.closeTouchRoutingSheet());
    panel.append(cancelRow);

    this.container.append(sheet);
    return sheet;
  }

  /**
   * `23-07`: fires the `open` beacon at most once per session - the item's own Done-when, "opening
   * the panel twice in one session counts one open". `toggleOpen()` only calls this method on the
   * closed -&gt; open transition (never on close -&gt; open... -&gt; close -&gt; open again without the
   * flag already being set), so `openBeaconSent` alone is enough; no reason to also gate it on
   * `isOpen`'s own value.
   */
  private open(): void {
    // `23-63`: first, synchronously, before anything else in this method - "nothing moves once the
    // panel is open" and "stops the moment it's opened" both mean this cannot wait for a render pass
    // or a later check. Also the one-way door: see `attentionExhausted`'s own doc comment for why a
    // later close-and-reopen does not schedule a second round.
    this.stopAttractAttention();
    // `23-64`: the identical cancellation, for the auto-open timer - a visitor who opens the panel
    // themselves needs no self-opening a moment later. `stopAutoOpen`'s own remarks explain why this
    // does not also mark the greeting "shown": it was never drawn, so a future page view within the
    // same identity remains eligible.
    this.stopAutoOpen();

    this.isOpen = true;
    this.panel.hidden = false;
    // `25-192`: re-evaluates to hidden regardless of hover - opening always wins.
    this.updateChannelSwitcherLauncherVisibility();
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.setAttribute("aria-label", this.strings.closeChat);
    // `25-141`: "read" happens here, not on a later render pass - the transcript is in front of the
    // visitor from this line onward, which is the same fact `openForAutoGreeting` marks "read" for its
    // own reveal.
    this.unreadCount = 0;
    this.renderUnreadBadge();
    // `25-143`: advances the on-disk read watermark on the identical event - see
    // `seedLastReadSequence`'s own remarks for why this is a storage-to-storage copy, not a live
    // connection read.
    this.seedLastReadSequence();
    this.focusTrap.activate();
    this.closeButton.focus();

    if (!this.openBeaconSent) {
      this.openBeaconSent = true;
      sendBeacon(this.config, fetch, "open");
    }

    if (this.connectPromise === null) {
      this.connectPromise = this.connect();
    }
  }

  private close(): void {
    this.isOpen = false;
    this.panel.hidden = true;
    // `25-192`: closing while the pointer is still over the toggle must reveal the row right away -
    // this call re-reads `this.isHoverRegionActive` fresh rather than assuming the pointer moved,
    // which is exactly the case a `pointerleave`-only design would miss.
    this.updateChannelSwitcherLauncherVisibility();
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", this.strings.openChat);
    this.focusTrap.deactivate();
    this.toggle.focus();
  }

  /** `25-191`/`25-192`: the one place this row's own `hidden` is written - `open()`/`close()`/
   * `openForAutoGreeting()` each call it exactly where they already set `this.panel.hidden`, and
   * the toggle's own `pointerenter`/`pointerleave` listeners above (and, since `25-203`, the row's
   * own matching pair in `buildChannelSwitcherLauncherRow`) call it on every hover change. The rule
   * itself, restated by `25-192`: visible only while the chat is closed *and* the hover region is
   * currently hovered - open always wins over hover, and neither fact alone is enough. A no-op when
   * the row was never built - a site with nothing connected, or one left on the card placement
   * instead. */
  private updateChannelSwitcherLauncherVisibility(): void {
    if (this.channelSwitcherLauncherRow) {
      this.channelSwitcherLauncherRow.hidden = this.isOpen || !this.isHoverRegionActive;
    }
  }

  /** `25-203`: the one place `isHoverRegionActive` is ever set `true` - called from a `pointerenter`
   * on either `this.toggle` or `this.channelSwitcherLauncherRow`. Cancels any pending
   * `hoverLeaveTimer` first: a fresh hover on either element, however it arrived, always wins over a
   * leave that has not yet actually taken effect. */
  private enterHoverRegion(): void {
    this.cancelHoverRegionLeaveTimer();
    this.isHoverRegionActive = true;
    this.updateChannelSwitcherLauncherVisibility();
  }

  /** `25-203`: the one place a `hoverLeaveTimer` is ever started - called from a `pointerleave` on
   * either `this.toggle` or `this.channelSwitcherLauncherRow`. Does not write `isHoverRegionActive`
   * itself; it schedules the write, `HOVER_REGION_LEAVE_GRACE_MS` later, and only if nothing cancels
   * it first. `enterHoverRegion` above is that cancellation - a pointer that reaches the *other*
   * element (or returns to this one) within the grace period never lets this timer fire at all, which
   * is what turns two elements with a real gap between them into one continuously hoverable region.
   * `open()`/`close()` do not touch this timer: `updateChannelSwitcherLauncherVisibility`'s own
   * `isOpen` term already wins unconditionally and immediately, whatever this timer is doing. */
  private scheduleHoverRegionLeave(): void {
    this.cancelHoverRegionLeaveTimer();
    this.hoverLeaveTimer = setTimeout(() => {
      this.hoverLeaveTimer = null;
      this.isHoverRegionActive = false;
      this.updateChannelSwitcherLauncherVisibility();
    }, HOVER_REGION_LEAVE_GRACE_MS);
  }

  /** `25-203`: shared by `enterHoverRegion` (a fresh hover always cancels a pending leave) and
   * `scheduleHoverRegionLeave` itself (a second `pointerleave` - e.g. the toggle's, then the row's,
   * while the pointer never actually re-entered either - restarts the same grace period rather than
   * stacking a second timer). Safe to call whether or not one is actually pending. */
  private cancelHoverRegionLeaveTimer(): void {
    if (this.hoverLeaveTimer !== null) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  /**
   * `25-141`: the only writer of `unreadBadge` and of `toggle`'s `aria-label` while the panel is
   * closed. Never shows a visible "0" - `hidden` whenever `unreadCount` is zero, the same "absent,
   * not a visible zero" rule this widget already applies to `notice`/`processingNotice` for their own
   * "nothing to say" state, rather than a badge with empty or zeroed text sitting in the DOM.
   *
   * Deliberately leaves `aria-label` alone while `isOpen` is `true`: `open()`/`close()` already own
   * that attribute for the panel's own open/close state (`strings.closeChat`/`strings.openChat`), and
   * this method runs *after* either has set it - overwriting it here on every incoming message while
   * the panel is open (`unreadCount` itself never rises then, but this method is still reachable from
   * `applyStrings`' own re-localisation pass) would fight that assignment for no visitor-facing gain.
   */
  private renderUnreadBadge(): void {
    if (this.unreadCount > 0) {
      this.unreadBadge.textContent = String(this.unreadCount);
      this.unreadBadge.hidden = false;
    } else {
      this.unreadBadge.textContent = "";
      this.unreadBadge.hidden = true;
    }

    if (!this.isOpen) {
      this.toggle.setAttribute(
        "aria-label",
        this.unreadCount > 0 ? this.strings.openChatWithUnreadCount(this.unreadCount) : this.strings.openChat,
      );
    }
  }

  /**
   * `25-143`: advances `WidgetStorage`'s own read watermark to "the latest sequence this browser has
   * actually seen" - `getLastKnownSequence`, not a live connection read: see that storage method's own
   * remarks for why the persisted `last-sequence:<conversationId>` key is already current at every
   * point this could possibly run, including before this page load's own hub connection exists yet,
   * unlike a value read off `VisitorConnection` itself. No-op for a conversation that has never been
   * minted (`WidgetStorage.getConversationId()` returns `null`) or has never received a single message
   * (`getLastKnownSequence` returns `null`) - there is nothing to attribute a read position to yet.
   */
  private seedLastReadSequence(): void {
    const conversationId = this.storage.getConversationId();
    if (conversationId === null) {
      return;
    }

    const sequence = this.storage.getLastKnownSequence(conversationId);
    if (sequence !== null) {
      this.storage.setLastReadSequence(conversationId, sequence);
    }
  }

  /**
   * `23-63`: pulses the closed launcher `MAX_ATTRACT_ATTEMPTS` times, `ATTRACT_PULSE_INTERVAL_MS`
   * apart, then gives up for the rest of this page view - the bound the backlog item's own scope
   * asked to be stated in code, stated once, here, and nowhere else. Orchestrated from `setTimeout`
   * rather than a CSS `animation-iteration-count`: a fixed iteration count can only ever *run to
   * completion*, it cannot be told to stop mid-course the instant the panel opens, which is exactly
   * the guarantee this item's scope asks for ("nothing moves once the panel is open"). The motion
   * itself is still pure CSS (`ui/styles.css`'s `.ago-toggle--attract`/`@keyframes ago-attract`) - this
   * method only ever adds and removes one class name, never touches a style property directly, so the
   * bundle pays nothing beyond that toggle logic for what stays a CSS animation.
   *
   * <b>`prefers-reduced-motion` wins over the tenant's own setting, unconditionally.</b> Checked here,
   * not only left to the CSS media query `ui/styles.css` also gates the keyframe behind: a tenant
   * cannot consent to repeated motion on a visitor's behalf (this item's own scope), so the widget
   * must not even *attempt* to animate for a visitor who has told their browser they don't want that -
   * asserted at the JS level is what makes that a fact a test can observe, rather than trusting that
   * a keyframe with no visible effect is somehow equivalent to never having tried.
   *
   * <b>Re-entrant by construction, not by a guard flag alone.</b> Called exactly once, from
   * `bootstrapSession`, but `isOpen`/`attentionExhausted` are re-checked both here and inside every
   * scheduled step - a visitor can click the launcher (running `open()`, which sets
   * `attentionExhausted`) at any point between this method being called and any later step running,
   * since the handshake this method waits on is a real network round trip.
   */
  private scheduleAttractAttention(): void {
    if (this.attentionExhausted || this.isOpen) {
      return;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.attentionExhausted = true;
      return;
    }

    let attemptsRemaining = MAX_ATTRACT_ATTEMPTS;

    const endPulse = (): void => {
      this.toggle.classList.remove("ago-toggle--attract");
      attemptsRemaining -= 1;

      if (attemptsRemaining <= 0 || this.isOpen) {
        this.attentionExhausted = true;
        this.attentionTimer = null;
        return;
      }

      this.attentionTimer = setTimeout(startPulse, ATTRACT_PULSE_INTERVAL_MS);
    };

    const startPulse = (): void => {
      if (this.isOpen) {
        // `open()` already called `stopAttractAttention` when this happened - nothing left to do.
        return;
      }

      this.toggle.classList.add("ago-toggle--attract");
      this.attentionTimer = setTimeout(endPulse, ATTRACT_PULSE_DURATION_MS);
    };

    this.attentionTimer = setTimeout(startPulse, ATTRACT_INITIAL_DELAY_MS);
  }

  /** `23-63`: the one-way stop - clears whatever `scheduleAttractAttention` has pending, removes the
   * class immediately (so a pulse cannot be mid-flight when the panel opens), and marks the launcher
   * exhausted so nothing later in this page view can schedule another round. Safe to call whether or
   * not a schedule is actually in flight - `open()` calls it unconditionally rather than checking
   * first. */
  private stopAttractAttention(): void {
    if (this.attentionTimer !== null) {
      clearTimeout(this.attentionTimer);
      this.attentionTimer = null;
    }

    this.attentionExhausted = true;
    this.toggle.classList.remove("ago-toggle--attract");
  }

  /**
   * `23-64`/`adr/0148`: schedules the one-shot timer that draws the tenant's greeting and reveals
   * the panel - and nothing else. No hub connection, no `JoinAsync`, no HTTP call beyond the
   * handshake this widget already made at mount (`bootstrapSession`'s own `POST
   * /api/v1/visitor-sessions`, which happens regardless of auto-open and mints no conversation) -
   * `adr/0148`'s own words, "nothing reaches the server until the visitor writes." A visitor who
   * ignores the panel or closes it before writing leaves exactly the trace they would have left
   * without this feature: none. `ui/widget.test.ts`'s own fails-before test asserts this directly by
   * spying on `VisitorConnection` and `fetch`.
   *
   * <b>Three one-way gates, checked once, at the moment scheduling is attempted:</b>
   * <ul>
   * <li><b>Already shown this visitor identity.</b> «Opening is once» (the backlog item's own
   * words) - `WidgetStorage.getAutoOpenGreetingShown()` is keyed to the same visitor session this
   * item's own Scope asks to reuse ("the visitor's own session already has a lifetime and reusing it
   * is the obvious answer"), not a fresh in-memory flag that would reset on every reload the way
   * `scheduleAttractAttention`'s own `attentionExhausted` deliberately does for its own, different
   * feature.</li>
   * <li><b>A coarse-pointer (touch-primary) device.</b> This item's own required, stated mobile
   * decision - the backlog item's "Where this is likely to go wrong" section asks for one rather
   * than an accident discovered in production. A panel that opens itself over somebody's phone is a
   * far larger interruption than one that opens in the corner of a desktop tab a visitor can glance
   * past without losing their place on the page, so auto-open simply never fires here - the identical
   * `window.matchMedia?.(...)` feature-detection shape `scheduleAttractAttention`'s own
   * `prefers-reduced-motion` gate already uses, applied to a different media feature.</li>
   * <li><b>The panel is already open.</b> A visitor who opened it themselves before the timer fired
   * needs no invitation.</li>
   * </ul>
   */
  private scheduleAutoOpen(greetingText: string, delaySeconds: number): void {
    if (this.isOpen || this.storage.getAutoOpenGreetingShown()) {
      return;
    }

    if (window.matchMedia?.("(pointer: coarse)").matches) {
      return;
    }

    this.autoOpenTimer = setTimeout(() => this.openForAutoGreeting(greetingText), delaySeconds * 1000);
  }

  /**
   * `23-64`/`adr/0148`: the auto-open panel reveal - deliberately not a call to `open()`.
   * `open()` connects the hub (`connect()`, which mints a real conversation the instant it joins),
   * steals focus into the panel (`focusTrap.activate()`, `closeButton.focus()` - this item's own
   * "focus is not stolen" scope), and counts as a deliberate open for `23-07`'s own beacon - every
   * one of those is exactly what a visitor did not do by having a timer fire on their own page. This
   * method does only what a self-opened panel needs: reveal it, keep the toggle's own accessible
   * state honest about what the DOM now shows, mark this identity as shown, and draw the greeting.
   *
   * <b>Re-checks `isOpen` at the moment it actually runs</b>, not only when it was scheduled - the
   * timer can fire after the visitor has already opened the panel themselves in the interim, and
   * `open()`'s own `stopAttractAttention`-style cancellation does not reach this timer (see
   * `stopAutoOpen`, called from `open()` for exactly this reason).
   *
   * <b>Enables the composer without a live connection.</b> `autoOpenedWithoutConnecting` is what
   * lets the visitor type and send from a panel this widget has not connected the hub for -
   * `dispatchSend`'s own remarks explain the lazy-connect-on-first-send this makes possible.
   */
  private openForAutoGreeting(greetingText: string): void {
    this.autoOpenTimer = null;
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.panel.hidden = false;
    // `25-192`: re-evaluates to hidden regardless of hover - opening always wins.
    this.updateChannelSwitcherLauncherVisibility();
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.setAttribute("aria-label", this.strings.closeChat);
    // `25-141`: this reveal is "read" too - the backlog item's own words, "both put the transcript in
    // front of the visitor" - even though nothing could actually have gone unread yet on this, the
    // very first reveal; kept here rather than assumed so a later code path that starts calling this
    // method a second time in some future item does not silently reopen the gap `open()`'s own reset
    // closes.
    this.unreadCount = 0;
    this.renderUnreadBadge();
    // `25-143`: the identical write-back `open()` performs on the same event - a no-op in practice on
    // this particular reveal (no conversation has been minted yet, `adr/0148`'s "nothing reaches the
    // server until the visitor writes"), kept here for the same reason the comment above already gives
    // for this method's own redundant reset: a future caller of this method must not have to remember
    // to add it.
    this.seedLastReadSequence();

    this.storage.setAutoOpenGreetingShown();
    this.autoOpenedWithoutConnecting = true;
    this.input.disabled = false;
    this.updateSendButtonEnabled();
    this.updateEmojiButtonEnabled();
    // `25-140`: nothing is attempting to connect at this point - by design, this path never calls
    // `connect()` (this method's own doc comment) - so the construction-time "Подключение…" the
    // status line was born with (`this.status`'s own assignment in the constructor) is simply false
    // here. `renderConnectionState` is untouched: it still owns every state a *real* connection
    // attempt produces, starting with the true "Подключение…" `completeSend` triggers on the
    // visitor's first send (`connect()`'s own call into `VisitorConnection.start()`).
    this.status.textContent = "";

    this.drawAutoGreeting(greetingText);
  }

  /** `23-64`: the one-way stop - clears whatever `scheduleAutoOpen` has pending, the identical shape
   * `stopAttractAttention` already has for its own timer. Safe to call whether or not a schedule is
   * actually in flight - `open()` calls it unconditionally. Does not touch `isOpen`/storage: unlike
   * attract-attention's own one-shot-per-page-view exhaustion, "already shown" here is a fact about
   * the visitor's identity (`WidgetStorage`), not this page view, and a cancelled *schedule* (the
   * visitor opened the panel themselves before the timer fired) is not the same fact as "already
   * shown" - the greeting was never drawn, so it remains eligible for a future page view within the
   * same identity if the tenant's timer would otherwise have shown it. */
  private stopAutoOpen(): void {
    if (this.autoOpenTimer !== null) {
      clearTimeout(this.autoOpenTimer);
      this.autoOpenTimer = null;
    }
  }

  /**
   * `23-64`/`adr/0148`: renders the tenant's greeting locally - not a message, no author, no id,
   * never sent to the server. Deliberately not routed through `appendMessageBubble`:
   * `this.renderedMessages` (that method's own remarks) stays untouched, which is what keeps this
   * bubble out of `saveConversation`'s own archive and out of anything a reload would rebuild from -
   * `23-53` is the reason this is stated rather than assumed (this item's own "Where this is likely
   * to go wrong": "a client-only message sitting in that list is exactly the kind of thing that
   * produces an empty or duplicated view later").
   *
   * Visually identical to a real `"AutoGreeting"`-authored message (`renderBubble`'s own remarks on
   * that author kind) - a visitor who later writes and watches the drawn greeting quietly become
   * "real" (`handleIncoming`'s own `AutoGreeting` branch, below) never sees anything change, only
   * that the panel now remembers it happened.
   */
  private drawAutoGreeting(text: string): void {
    this.drawnGreetingBubble = this.renderBubble("AutoGreeting", text);
  }

  /**
   * `20-07`: loads the booking module's own chip copy from its lazily-built bundle
   * (`build.mjs`'s third entry point, `dist/widget-module-booking.js`) and reveals the chip only
   * once it has it. `ui/moduleLoader.ts`'s own doc comment covers why the specifier reaching
   * `import()` is a runtime-computed URL rather than a literal - that, not this method, is what keeps
   * `src/modules/booking/` out of the base bundle's inputs.
   *
   * Awaits `sessionPromise` first, for three reasons now instead of one: `this.locale` needs to be
   * resolved (unchanged since `20-07`), `23-105` adds the entitlement gate - whether the resolved
   * session's `enabledModules` contains this widget's one statically-wired module key - and `25-131`
   * adds a second gate right beside it: the resolved session's own `enabledModuleTriggerWords` must
   * carry a real, non-empty word for that same key, or the chip stays absent exactly as it would for
   * "not enabled" (a real, live tenant's chip sent a hardcoded `/booking` no site had to have
   * configured before this, which is the bug this second gate exists to close). This is the
   * single place in `ago-widget` allowed to compare a module key against the literal `"calendar"`:
   * `adr/0065` guard 9 forbids that literal inside `Ago.Chat.*`, because that assembly must stay
   * ignorant of what any module *is* - a constraint this repository was never under, and could not
   * meet anyway, since `ui/moduleLoader.ts` already names `widget-module-booking.js` and this whole
   * class is already built around exactly one module (`decisions.md`'s own "no module runtime": one
   * candidate, wired statically, until a second one exists to design the seam against). A site with
   * no grant for this key returns here without revealing a chip, building one, or calling
   * `loadModule` at all - unchanged from `20-07`'s own "a shop without booking pays nothing"
   * property, just decided from the handshake response now instead of from the script tag.
   *
   * `23-105`: the element itself moved here too, out of the constructor - `moduleChip` is `null`
   * until this method finds the grant, then built and spliced into the panel, before the label is
   * known. It stays `hidden`/`disabled` at that point, revealed only once the lazy bundle's own copy
   * has arrived, so "no calendar-flavored copy exists before the fetch resolves" holds exactly as it
   * did before.
   *
   * `25-126`: no longer spliced into the header (`insertBefore(closeButton)`) - the author's own
   * screenshot found it squeezed between the title and the close button there, reading as a plain
   * link rather than the real, already-wired button it is. It now lands as its own panel-level flex
   * child, inserted directly before `this.composer` (a real anchor `this.composer.parentElement`
   * already gives, the identical "insert before a known, stable sibling" shape the old header
   * insertion already used, just pointed at a different one) - between the scrollable thread and the
   * fixed composer row, which is safe to do here because this method only ever runs after the
   * constructor has finished building and appending every one of `this.panel`'s other children. The
   * header now stays title-and-close only, exactly as the backlog item's own scope asks.
   *
   * A failure here (the lazy bundle 404s, a host page blocks the request) is caught by this method's
   * own `guardAsync` caller and simply leaves the chip absent, never a throw onto the host page.
   */
  private async loadBookingModuleChip(): Promise<void> {
    const session = await this.sessionPromise;
    if (!session.enabledModules.includes("calendar")) {
      return;
    }

    // `25-131`: the site's own real, first configured trigger word - never a hardcoded `/booking`.
    // `EnabledModule`'s own constructor (`ago-chat`) refuses to persist an empty trigger-word list, so
    // a module present in `enabledModules` is guaranteed at least one word by the server's own
    // invariant; this is still a defensive re-check, the same "never trust the wire value blindly"
    // posture every other field on this response already gets, rather than a `!`. A missing or empty
    // entry here is treated exactly like "not enabled" - the chip stays absent rather than sending a
    // trigger word nobody on this platform actually granted.
    const triggerWord = session.enabledModuleTriggerWords["calendar"]?.[0];
    if (!triggerWord) {
      return;
    }

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ago-module-chip";
    chip.hidden = true;
    chip.disabled = true;
    this.composer.parentElement?.insertBefore(chip, this.composer);
    this.moduleChip = chip;

    const bookingModule = await loadModule<{
      bookingChipSpec: (locale: SupportedLocale, triggerWord: string) => ModuleChipSpec;
    }>(this.config.scriptUrl, "widget-module-booking.js");
    const spec = bookingModule.bookingChipSpec(this.locale, triggerWord);

    chip.textContent = spec.label;
    chip.setAttribute("aria-label", spec.ariaLabel);
    chip.hidden = false;
    chip.disabled = !this.isConnected;
    chip.addEventListener("click", () => this.invokeModule(spec.triggerText));
  }

  /**
   * `25-173`: the one place `ChannelSwitcherPlacement` is actually read - kicked off from the
   * constructor at the identical `loadBookingModuleChip` timing (`await this.sessionPromise`, so an
   * auto-opened panel gets whichever renderer applies too), and the only caller of either one.
   * `loadChannelSwitcherCard` below is `25-149`'s own pre-existing renderer, untouched - this method's
   * whole job is choosing between it and `buildChannelSwitcherLauncherRow` without either renderer
   * needing to know the other exists. A site left on the default placement (`"AboveComposer"`, or a
   * session cached before this field existed - `parseChannelSwitcherPlacement`'s own fallback) still
   * reaches `loadChannelSwitcherCard` by exactly the same call this constructor made before this item,
   * so its own output is pixel-for-pixel unaffected.
   */
  private async loadChannelSwitcher(): Promise<void> {
    const session = await this.sessionPromise;
    // `25-197`: captured regardless of which placement branch runs below - see this.channelLinks'
    // own doc comment for why toggleOpen needs this synchronously, independent of either
    // placement-specific renderer.
    this.channelLinks = session.channelLinks;

    // `25-198`: a touch visitor is routed through `openTouchRoutingSheet` instead - the identical
    // channel choice `isTouchRoutingDevice()` already gates there. Building either placement-specific
    // renderer here too would offer the same choice a second time, inside the panel, once the sheet's
    // own "Онлайн чат" row opens it - the crowding the author's own screenshot showed. Neither
    // renderer below is told about the other; this is the one call site that decides whether either
    // runs at all, so a touch device with connected channels now builds neither, and the panel is
    // left exactly as it was before either placement existed.
    if (this.isTouchRoutingDevice()) {
      return;
    }

    if (parseChannelSwitcherPlacement(session.widgetChannelSwitcherPlacement) === "below-launcher") {
      this.buildChannelSwitcherLauncherRow(session);
      return;
    }

    await this.loadChannelSwitcherCard();
  }

  /**
   * `25-149`: a Jivo-style card offering the tenant's own connected channels, built once the
   * handshake resolves `session.channelLinks` - the identical timing `loadBookingModuleChip` above
   * already established (`await this.sessionPromise`, so an auto-opened panel gets it too) and the
   * identical anchor (`this.composer.parentElement`, `insertBefore(..., this.composer)`) - "directly
   * above the composer," the item's own words, not a second floating surface the panel's own focus
   * trap and Escape handler would each need teaching about a second time.
   *
   * A site with nothing connected (`channelLinks.length === 0`) never builds this element at all -
   * "a session with an empty `channelLinks` shows no card at all, never an empty or single-row husk"
   * (the item's own Scope), the identical "pays nothing" property `loadBookingModuleChip` already
   * gives a shop with no grant. Nor does a returning visitor who already dismissed the card for this
   * identity: `storage.getChannelSwitcherDismissed()` is read here, once, so a dismissed identity gets
   * no channel-switcher DOM at all on a later page load, rather than a card built and immediately kept
   * hidden.
   *
   * The item's own cadence, "shows on every panel open until dismissed," needs no per-open reveal of
   * its own: this card sets `hidden = false` exactly once, right here, and is never re-hidden except by
   * `dismissChannelSwitcher`. It is an ordinary child of `this.panel` on the identical footing
   * `this.messages`/`composer` already are, so `open()`/`openForAutoGreeting()` revealing the whole
   * panel is what makes it visible again on every later open, for free - the same reason neither method
   * has to remember to re-reveal the transcript or the composer either.
   *
   * `25-173`: this method's own body is untouched by that item - `loadChannelSwitcher` above is the
   * only thing that changed, and only to decide *whether* to call this at all.
   */
  private async loadChannelSwitcherCard(): Promise<void> {
    const session = await this.sessionPromise;
    if (session.channelLinks.length === 0 || this.storage.getChannelSwitcherDismissed()) {
      return;
    }

    const card = document.createElement("div");
    card.className = "ago-channel-switcher";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", this.strings.channelSwitcherGroupLabel);

    for (const link of session.channelLinks) {
      card.append(this.buildChannelSwitcherRow(link));
    }

    const writeInChatRow = document.createElement("button");
    writeInChatRow.type = "button";
    writeInChatRow.className = "ago-channel-switcher-row ago-channel-switcher-row--dismiss";
    writeInChatRow.textContent = this.strings.channelSwitcherWriteInChat;
    // `adr/0148`: focuses the composer - never `connect()`. `completeSend`'s own lazy
    // connect-on-first-send is what actually opens the hub; a control that sends nothing itself must
    // not undo that laziness, which is exactly the regression the backlog item names by pointing at
    // `adr/0148` here.
    //
    // `25-191`: no longer dismisses the card. The author's own correction - two independent
    // dismissal triggers (this click, and `dispatchSend`'s own call for "the visitor's first sent
    // message") read as one condition doing double duty; the single one that should survive is the
    // visitor actually sending a message. Choosing to type instead of picking a channel is not the
    // same fact as having sent something - the card stays exactly as visible after this click as
    // before it, and `dispatchSend` remains the one place `dismissChannelSwitcher` is ever called.
    writeInChatRow.addEventListener("click", () => {
      this.input.focus();
    });
    card.append(writeInChatRow);

    this.composer.parentElement?.insertBefore(card, this.composer);
    this.channelSwitcherCard = card;
  }

  /**
   * `25-149`: one tappable row per connected channel - a real `<a target="_blank"
   * rel="noopener noreferrer">`, never a JS-driven navigation, so long-press/copy/open-in-app keep
   * working on a host page this widget does not control (the item's own reasoning). The accessible
   * name is the visible label alone - a plain text node beside an `aria-hidden` icon, so a screen
   * reader announces the channel's own name exactly once rather than the glyph a second time as
   * meaningless "image" content. An unrecognised `kind` still gets a real, working row: the neutral
   * fallback icon and colour, and the raw wire string itself as its label - never dropped, never a
   * throw (`25-149`'s own explicit Done-when).
   *
   * `25-172`: `buildBrandIcon` covers the four recognised kinds with their real, multi-colour marks;
   * anything else - including a future, unrecognised `kind` - falls through to exactly
   * `createSvgIcon(CHANNEL_FALLBACK_ICON_PATH)`, byte-for-byte the row this file has always built for
   * that case.
   */
  private buildChannelSwitcherRow(link: { kind: string; url: string }): HTMLAnchorElement {
    const row = document.createElement("a");
    row.className = "ago-channel-switcher-row";
    row.href = link.url;
    row.target = "_blank";
    row.rel = "noopener noreferrer";
    row.style.color = CHANNEL_BRAND_COLORS[link.kind] ?? CHANNEL_FALLBACK_COLOR;

    const icon = buildBrandIcon(link.kind) ?? createSvgIcon(CHANNEL_FALLBACK_ICON_PATH);
    icon.setAttribute("aria-hidden", "true");
    row.append(icon);

    const label = document.createElement("span");
    label.textContent = CHANNEL_DISPLAY_NAMES[link.kind] ?? link.kind;
    row.append(label);

    return row;
  }

  /**
   * `25-173`: the "below launcher" renderer - `loadChannelSwitcher`'s other branch, chosen instead of
   * `loadChannelSwitcherCard` when `ChannelSwitcherPlacement` is `"BelowLauncher"`. A horizontal row
   * of small circular icons, one per connected channel, vertically centred on `this.toggle`
   * (`.ago-toggle`, 56px/`3.5rem`) - `ui/styles.css`'s own `.ago-channel-switcher-launcher` rule
   * positions it, starting right after the toggle and growing toward whichever side the panel already
   * opens from (the same `.ago-position-left` class `bootstrapSession` toggles on `this.container` for
   * the toggle/panel themselves - this row follows it rather than choosing a side of its own).
   *
   * Still no dismiss concept, unlike `loadChannelSwitcherCard` - there is no
   * `storage.getChannelSwitcherDismissed()` check here, and nothing for `dismissChannelSwitcher`/
   * `dispatchSend` to hide permanently. A site with nothing connected still builds nothing, the
   * identical "pays nothing" property the card gives itself.
   *
   * `25-191`: no longer a persistent row. `25-173`'s own original design showed this row whether
   * the panel was open or closed, on the reasoning that a sibling of `this.toggle` (not a child of
   * `this.panel`) gets no reveal/hide behaviour from the panel's own `hidden` for free.
   *
   * `25-192`: and revealing it on open was itself wrong - the author's own second correction. The
   * real rule is hover, not open: visible only while the chat is closed *and* the hover region is
   * currently hovered, never while open regardless of hover.
   * `updateChannelSwitcherLauncherVisibility` is the one place that rule is evaluated, called from
   * here, from `pointerenter`/`pointerleave` on both `this.toggle` and this row itself, and from
   * `open()`/`close()`/`openForAutoGreeting()`. Built already hidden - hover is a live signal this
   * method cannot know anything about at build time, so there is no snapshot worth taking here the
   * way `25-191` briefly did for `this.isOpen`.
   *
   * `25-203`: this row sits beside `this.toggle`, not touching it (`ui/styles.css`'s own
   * `.ago-channel-switcher-launcher` grows outward across a real gap) - the toggle's own
   * `pointerenter`/`pointerleave` listeners alone left a "hover island" the instant the pointer
   * crossed that gap on its way to one of the icons below: `pointerleave` fired on the toggle before
   * the pointer ever reached this row, hiding it mid-crossing. This row now carries the identical
   * pair of listeners, writing the same `isHoverRegionActive` flag the toggle's own pair writes -
   * hovering *either* element keeps the row visible, closing the gap between them as one continuous
   * hoverable region.
   */
  private buildChannelSwitcherLauncherRow(session: VisitorSession): void {
    if (session.channelLinks.length === 0) {
      return;
    }

    const size = parseChannelSwitcherIconSize(session.widgetChannelSwitcherIconSize);
    const row = document.createElement("div");
    row.className = `ago-channel-switcher-launcher ago-channel-switcher-launcher--${size}`;
    row.hidden = true;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", this.strings.channelSwitcherGroupLabel);
    // `25-203`: the toggle's own pair's exact counterpart (see `isHoverRegionActive`'s own doc
    // comment) - without this, moving the pointer from the toggle toward any icon here crosses a gap
    // where neither element is hovered, and the toggle's `pointerleave` alone would hide the row
    // before the pointer ever arrives. `enterHoverRegion`/`scheduleHoverRegionLeave` are the same two
    // methods the toggle's own pair calls - one flag, one grace period, two writers.
    row.addEventListener("pointerenter", () => this.enterHoverRegion());
    row.addEventListener("pointerleave", () => this.scheduleHoverRegionLeave());

    for (const link of session.channelLinks) {
      row.append(this.buildChannelSwitcherLauncherIcon(link));
    }

    this.container.append(row);
    this.channelSwitcherLauncherRow = row;
    // `25-192`: in case the toggle is already hovered by the time this async build finishes (a slow
    // handshake settling while the pointer sits over a launcher that had nothing to show yet).
    this.updateChannelSwitcherLauncherVisibility();
  }

  /**
   * `25-173`: one circular icon per connected channel - reuses `25-172`'s own `buildBrandIcon`/
   * `createSvgIcon(CHANNEL_FALLBACK_ICON_PATH)` mechanism directly rather than inventing a second one.
   * The four recognised brand marks already render as full circular badges with their own fill
   * (`CHANNEL_ICON_TREES`'s own remarks), so they only need resizing to the chosen diameter, no
   * wrapping background; an unrecognised `kind` gets the same neutral fallback glyph
   * `buildChannelSwitcherRow` falls back to, laid over a solid circle of `CHANNEL_FALLBACK_COLOR` so
   * it still reads as one of the row's own circles rather than a glyph floating with no badge under
   * it. A real `<a target="_blank" rel="noopener noreferrer">`, the identical reasoning
   * `buildChannelSwitcherRow`'s own remarks give for why this is never a JS-driven navigation - and,
   * since this row carries no visible text label the way the card's own rows do, the accessible name
   * lives entirely on this anchor's own `aria-label`.
   */
  private buildChannelSwitcherLauncherIcon(link: { kind: string; url: string }): HTMLAnchorElement {
    const item = document.createElement("a");
    item.className = "ago-channel-switcher-launcher-icon";
    item.href = link.url;
    item.target = "_blank";
    item.rel = "noopener noreferrer";
    item.setAttribute("aria-label", CHANNEL_DISPLAY_NAMES[link.kind] ?? link.kind);

    const brandIcon = buildBrandIcon(link.kind);
    if (brandIcon) {
      brandIcon.setAttribute("aria-hidden", "true");
      brandIcon.style.width = "100%";
      brandIcon.style.height = "100%";
      item.append(brandIcon);
      return item;
    }

    item.classList.add("ago-channel-switcher-launcher-icon--fallback");
    const icon = createSvgIcon(CHANNEL_FALLBACK_ICON_PATH);
    icon.setAttribute("aria-hidden", "true");
    item.append(icon);
    return item;
  }

  /**
   * `25-149`: dismisses the card, permanently for this visitor identity. `25-191`: `dispatchSend`'s
   * own call below - "the visitor's first sent message" - is now the *only* caller; the «Написать в
   * чат» row's own click used to trigger this identically and no longer does (that handler's own
   * remarks have the reasoning). Idempotent by construction regardless: a second send once the card
   * is already dismissed writes the identical stored value and hides an already-hidden or
   * already-absent element, never a throw.
   *
   * Reuses `WidgetStorage`'s own per-identity clearing (`VisitorSessionManager.start`'s `17-07`
   * branch, alongside `clearAutoOpenGreetingShown`/`clearHasKnownContactDetail`) rather than a second,
   * parallel mechanism - the item's own explicit "Where this is likely to go wrong" - so a freshly
   * minted visitor identity is never silently born "already dismissed."
   */
  private dismissChannelSwitcher(): void {
    this.storage.setChannelSwitcherDismissed();
    if (this.channelSwitcherCard) {
      this.channelSwitcherCard.hidden = true;
    }
  }

  /**
   * `18-03`'s own interaction shape (`ago-console`'s `Composer.tsx`), read as a UX convention rather
   * than shared code: inserting the trigger phrase and sending it is **structurally identical to the
   * visitor typing it themselves**, not a second code path into the module - `sendCurrentMessage`
   * below is the exact function a keystroke-driven send already goes through.
   */
  private invokeModule(triggerText: string): void {
    this.input.value = triggerText;
    this.updateSendButtonEnabled();
    this.sendCurrentMessage();
  }

  /** Lazy-init on first open, not on page load (embeddable-widget skill: "nothing heavy before
   * first interaction") - `11-03`: true of the real-time connection built here, not of the visitor
   * identity/config resolution any more, which `bootstrapSession` now starts eagerly at mount time.
   * This method awaits that same `sessionPromise` rather than re-requesting it, so a first open
   * never fires a second, redundant `POST /api/v1/visitor-sessions`. Session + connection failures
   * degrade to a status message, never a throw that could escape to the host page. */
  private async connect(): Promise<void> {
    try {
      const session = await this.sessionPromise;
      this.session = session;
      const connection = new VisitorConnection(this.config, () => this.currentToken(), this.storage);
      connection.onMessage((message) => this.handleIncoming(message));
      connection.onStateChange((state) => this.renderConnectionState(state));
      // `23-78`: registered before `start()` so the initial join's own emission is never missed -
      // fires again on every later automatic reconnect too (`VisitorConnection`'s own remarks), which
      // is why this lives here rather than as a one-off read of `joinResult` right below.
      // `renderConnectionState` never touches `.hidden`, only `.disabled` - the same split
      // `moduleChip` already draws between "revealed at all" and "usable right now".
      connection.onAttachmentUploadGrantChange((hasGrant) => {
        this.attachButton.hidden = !hasGrant;
      });
      this.connection = connection;

      const joinResult = await connection.start();
      this.conversationId = joinResult.conversationId;
      // `23-53`: `joinResult.history` is `GetHistoryAsync`'s "most recent page" shape - newest first,
      // the same keyset-pagination direction `loadOlderHistory` needs for its own "fetch backward from
      // a cursor" case (`IConversationReadStore.GetHistoryAsync`'s own remarks). Before this item, this
      // loop only ever ran on a brand-new conversation with nothing in it yet, so the order was never
      // visible; a returning visitor's own history is now delivered here too, and a transcript rendered
      // in the order the query returns it would put the newest message first and the oldest last -
      // reversed. `resumeAfterReconnect`'s own delta path needs no such reversal (`GetDeltaAsync` is
      // already oldest-first, matching how `handleIncoming` appends one at a time as messages arrive).
      for (const message of [...joinResult.history].reverse()) {
        this.appendMessageBubble(message);
      }

      this.renderConnectionState("connected");
    } catch (error) {
      logWidgetError(error);
      if (!this.isSessionExpired) {
        this.status.textContent = this.strings.chatUnavailable;
      }
    }
  }

  /**
   * Every place this widget presents the visitor token - the hub's negotiate (via
   * `VisitorConnection`'s `accessTokenFactory`) and the three attachment calls - goes through here,
   * so renewal happens wherever the token is about to be used and nowhere else (`session.ts`
   * explains why that is a better shape here than a timer).
   *
   * The one thing this adds on top of `VisitorSessionManager.token()` is making the terminal case
   * *visible*. It still rethrows: the caller's own failure path is what stops the connect, the send
   * or the upload.
   */
  private async currentToken(): Promise<string> {
    try {
      return await this.sessionManager.token();
    } catch (error) {
      if (error instanceof VisitorSessionExpiredError) {
        this.handleSessionExpired();
      }

      throw error;
    }
  }

  /**
   * `17-07`'s decided answer for a token that dies **while the page is open**, which is a different
   * question from one that is already dead at page load (`session.ts`'s `start` mints a new identity
   * for that one and the panel says so).
   *
   * Here the widget does **not** re-identify. A new `VisitorId` would open a different conversation
   * while the previous one's messages are still on screen: the visitor would carry on typing into a
   * transcript the operator answering them cannot see, and nothing would look wrong. So the session
   * ends, visibly, and reloading - a thing the visitor can actually do - is what starts a new one.
   *
   * The connection is stopped rather than left to retry, because `@microsoft/signalr`'s reconnect
   * loop would otherwise ask for a token forever, and every one of those attempts now costs a
   * renewal request against a server that has already refused.
   *
   * `adr/0034` called the pre-`17-07` behaviour "silence: an expired token does not prompt anything;
   * the widget keeps presenting it and the hub connection simply fails". This is that path made
   * observable rather than moved.
   */
  private handleSessionExpired(): void {
    if (this.isSessionExpired) {
      return;
    }

    this.isSessionExpired = true;
    this.isConnected = false;
    this.input.disabled = true;
    this.attachButton.disabled = true;
    this.sendButton.disabled = true;
    // Set directly, not via `updateEmojiButtonEnabled()` - that helper also honours
    // `autoOpenedWithoutConnecting`, which a session expiring mid-auto-greeting does not reset, and
    // `sendButton` just above has the identical reason for the same direct assignment.
    this.emojiButton.disabled = true;
    this.closeEmojiPicker("none");
    this.status.textContent = this.strings.sessionExpired;

    const connection = this.connection;
    this.connection = null;
    if (connection !== null) {
      guardAsync(() => connection.stop());
    }
  }

  private renderConnectionState(state: ConnectionState): void {
    // `17-07`: an expired session is terminal for this page load, and stopping the connection makes
    // SignalR fire `onclose` right afterwards - without this the "reload to start a new one" message
    // would be replaced, one tick later, by "Disconnected. Trying to reconnect…", which is both
    // untrue and the exact kind of quiet that this item exists to remove.
    if (this.isSessionExpired) {
      return;
    }

    this.isConnected = state === "connected";
    this.input.disabled = !this.isConnected;
    this.attachButton.disabled = !this.isConnected;
    // `hidden` guards this too (still loading, or booking never asked for) - `disabled` only matters
    // once `loadBookingModuleChip` has actually revealed it.
    if (this.moduleChip && !this.moduleChip.hidden) {
      this.moduleChip.disabled = !this.isConnected;
    }
    this.updateSendButtonEnabled();
    this.updateSaveButtonEnabled();
    this.updateEmojiButtonEnabled();
    this.status.textContent =
      state === "connecting"
        ? this.strings.connecting
        : state === "reconnecting"
          ? this.strings.reconnecting
          : state === "disconnected"
            ? this.strings.disconnectedReconnecting
            : "";
  }

  /** Re-evaluated on every keystroke, not just once at connect time - a textarea starts empty
   * and the button must react to the visitor actually typing something (found live, 5-09: the
   * button was otherwise permanently disabled since nothing re-ran this check after connect).
   *
   * `23-64`: `autoOpenedWithoutConnecting` joins `isConnected` on the same terms a real connection
   * would - the one exception to "connected" gating this widget has, and it exists for exactly one
   * panel state: auto-opened, composer visible, hub deliberately not yet connected
   * (`openForAutoGreeting`'s own remarks). `completeSend` is what turns a click here into a real
   * connection the moment it is actually needed. */
  private updateSendButtonEnabled(): void {
    this.sendButton.disabled =
      !(this.isConnected || this.autoOpenedWithoutConnecting) || this.input.value.trim().length === 0;
  }

  /** `23-62`: mirrors `updateSendButtonEnabled` above - re-evaluated both on every connection-state
   * change (`renderConnectionState`) and around the archive build itself (`saveConversation`'s own
   * `finally`), so a visitor cannot start a second save while the first is still walking history and
   * fetching attachments. */
  private updateSaveButtonEnabled(): void {
    this.saveButton.disabled = !this.isConnected || this.isSavingConversation;
  }

  /** `25-120`: mirrors `updateSendButtonEnabled`/`updateSaveButtonEnabled` above - re-evaluated on
   * every connection-state change and once more when an auto-greeted panel enables the composer
   * without a live connection (`openForAutoGreeting`). Inserting an emoji is a local edit to
   * `this.input`, not a call to the server, so it tracks the same "can the visitor type at all"
   * signal `updateSendButtonEnabled` uses (`isConnected || autoOpenedWithoutConnecting`) rather than
   * `attachButton`'s stricter connection-only gate. Closes the picker the moment it goes disabled -
   * a disabled trigger can no longer be clicked to close it, so this is the one path that must do it
   * instead (found by asking "what closes the picker if the connection drops while it's open?", not
   * by a failing test). */
  private updateEmojiButtonEnabled(): void {
    const enabled = this.isConnected || this.autoOpenedWithoutConnecting;
    this.emojiButton.disabled = !enabled;
    if (!enabled) {
      this.closeEmojiPicker("none");
    }
  }

  /**
   * `25-120`: builds the picker's whole static DOM once, in the constructor - the 40-emoji set never
   * changes at runtime, so there is nothing to rebuild on open/close, only `hidden`/`disabled`/
   * `tabIndex` to flip. `role="grid"` > `role="row"` > `role="gridcell"`, the ARIA Authoring
   * Practices' own shape for a fixed 2-D grid of equally-weighted choices (that pattern's own worked
   * example is an emoji picker) - `emojiButton`'s own doc comment has the fuller reasoning for
   * choosing it over a listbox/menu. Each cell is a real `<button>` rather than a `<div
   * role="gridcell">` wrapping something else focusable: a native button gets `Enter`/`Space`
   * activation (dispatching `click`) for free, which is exactly the "Enter/Space picks the focused
   * one" Done-when and needs no hand-rolled key handling of its own - `handleEmojiPickerKeydown`
   * below only ever has to deal with the arrow keys and `Escape`.
   *
   * <b>Roving tabindex, not a fixed one.</b> Every cell starts at `tabIndex = -1` except the first,
   * which starts at `0` - the standard composite-widget technique this item's own Scope names by
   * name ("a roving-tabindex ... pattern"): `Tab` reaches the grid as a single stop, and the arrow
   * keys move which cell that stop lands on. This only works correctly inside `WidgetPanel`'s own
   * `FocusTrap` because of the accompanying fix in `focus-trap.ts` - see that file's own doc comment
   * on why a roving-tabindex sibling group needed it.
   */
  private buildEmojiPicker(): { picker: HTMLDivElement; cells: HTMLButtonElement[] } {
    const picker = document.createElement("div");
    picker.className = "ago-emoji-picker";
    picker.setAttribute("role", "grid");
    picker.setAttribute("aria-label", this.strings.emojiPickerLabel);
    picker.hidden = true;
    picker.addEventListener("keydown", (event) => this.handleEmojiPickerKeydown(event));

    const cells: HTMLButtonElement[] = [];
    for (let rowStart = 0; rowStart < EMOJI_PICKER_GLYPHS.length; rowStart += EMOJI_PICKER_COLUMNS) {
      const row = document.createElement("div");
      row.setAttribute("role", "row");
      row.className = "ago-emoji-picker-row";

      for (const glyph of EMOJI_PICKER_GLYPHS.slice(rowStart, rowStart + EMOJI_PICKER_COLUMNS)) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ago-emoji-cell";
        cell.setAttribute("role", "gridcell");
        cell.tabIndex = cells.length === 0 ? 0 : -1;
        cell.textContent = glyph;
        cell.addEventListener("click", () => this.insertEmoji(glyph));
        row.appendChild(cell);
        cells.push(cell);
      }

      picker.appendChild(row);
    }

    return { picker, cells };
  }

  private toggleEmojiPicker(): void {
    if (this.emojiPicker.hidden) {
      this.openEmojiPicker();
    } else {
      this.closeEmojiPicker("trigger");
    }
  }

  /** Resets the roving tabindex to the first cell on every open, rather than remembering the last
   * focused one across opens - the picker is a flat, static grid with no notion of "where you left
   * off" worth preserving (`docs/backlog/25-120-*.md`'s own Scope: no recently-used tracking), so a
   * deterministic starting corner is simpler than state to carry between an open and the next. */
  private openEmojiPicker(): void {
    this.emojiPicker.hidden = false;
    this.emojiButton.setAttribute("aria-expanded", "true");

    for (const [index, cell] of this.emojiCells.entries()) {
      cell.tabIndex = index === 0 ? 0 : -1;
    }
    this.emojiCells[0]?.focus();

    document.addEventListener("click", this.handleDocumentClickForEmojiPicker, true);
  }

  /**
   * `focusTarget` is why this is not simply "close" - the three callers each land focus somewhere
   * different for a different reason: `Escape`/an outside click return it to `emojiButton` itself
   * (the backlog item's own words, "returns focus to the emoji button"); picking an emoji returns it
   * to `this.input` instead, so typing continues without an extra click (the item's own words again);
   * and `updateEmojiButtonEnabled` closing the picker out from under a connection drop moves focus
   * nowhere; `emojiButton` is about to become `disabled` and cannot accept it.
   */
  private closeEmojiPicker(focusTarget: "trigger" | "input" | "none"): void {
    if (this.emojiPicker.hidden) {
      return;
    }

    this.emojiPicker.hidden = true;
    this.emojiButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", this.handleDocumentClickForEmojiPicker, true);

    if (focusTarget === "trigger") {
      this.emojiButton.focus();
    } else if (focusTarget === "input") {
      this.input.focus();
    }
  }

  /**
   * `event.composedPath()`, not `event.target` - the widget renders inside a Shadow DOM
   * (`shadow-root.ts`), and a click originating inside it retargets `event.target` to the shadow
   * host by the time this listener (registered on `document`, outside the shadow tree) observes it.
   * `composedPath()` is the one API that still names the real, shadow-internal element the click
   * actually landed on, which is what lets this tell "inside the picker" and "on the trigger button
   * itself" apart from "genuinely outside both" - `FocusTrap`'s own remarks on `getRootNode()` solve
   * the analogous problem for `document.activeElement`.
   *
   * The trigger button is excluded deliberately: it already toggles the picker from its own `click`
   * handler, so this listener staying silent about it is what stops a click there from closing the
   * picker (this handler) and immediately reopening it (the button's own handler) on the same click.
   */
  private readonly handleDocumentClickForEmojiPicker = (event: MouseEvent): void => {
    const path = event.composedPath();
    if (path.includes(this.emojiPicker) || path.includes(this.emojiButton)) {
      return;
    }

    this.closeEmojiPicker("trigger");
  };

  /**
   * `25-120`: cursor-position insert, not append-only - the backlog item's own concrete case is a
   * visitor who clicked back into the middle of what they already typed, who must get the emoji
   * where their cursor actually is, not at the end. `selectionStart`/`selectionEnd` rather than
   * always the same value: a visitor who had a *range* selected (rather than a collapsed cursor)
   * gets the emoji replacing that selection, matching how typing a character over a selection
   * already behaves in every text field.
   *
   * `updateSendButtonEnabled()` right after, not left to the next keystroke - setting `.value`
   * programmatically never fires the `input` event `this.input`'s own listener depends on
   * (`invokeModule` above has the identical call for the identical reason), so nothing else here
   * would otherwise notice the composer went from empty to non-empty.
   */
  private insertEmoji(emoji: string): void {
    const value = this.input.value;
    const start = this.input.selectionStart ?? value.length;
    const end = this.input.selectionEnd ?? value.length;

    this.input.value = value.slice(0, start) + emoji + value.slice(end);
    const cursor = start + emoji.length;
    this.input.setSelectionRange(cursor, cursor);
    this.updateSendButtonEnabled();

    this.closeEmojiPicker("input");
  }

  /**
   * Arrow-key roving-tabindex navigation for `emojiPicker`'s `role="grid"` - `Enter`/`Space` need no
   * branch here at all, since every cell is a real `<button>` that already activates on both (this
   * method's own doc comment on `buildEmojiPicker` has the reasoning). `Escape` stops the event from
   * reaching `WidgetPanel`'s own `keydown` listener (`event.stopPropagation()`) - without it, closing
   * just the picker on `Escape` would also close the whole chat panel, since that listener treats
   * every `Escape` anywhere inside it as "close the dialog".
   *
   * Movement clamps at the grid's own edges rather than wrapping - `EMOJI_PICKER_COLUMNS` divides
   * `EMOJI_PICKER_GLYPHS.length` evenly (that constant's own doc comment), so every column has the
   * same five rows and `ArrowUp`/`ArrowDown` never has to special-case a short one.
   */
  private handleEmojiPickerKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeEmojiPicker("trigger");
      return;
    }

    const currentIndex = this.emojiCells.findIndex((cell) => cell === this.root.activeElement);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = Math.min(currentIndex + 1, this.emojiCells.length - 1);
        break;
      case "ArrowLeft":
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + EMOJI_PICKER_COLUMNS, this.emojiCells.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - EMOJI_PICKER_COLUMNS, 0);
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextIndex === currentIndex) {
      return;
    }

    this.emojiCells[currentIndex]!.tabIndex = -1;
    this.emojiCells[nextIndex]!.tabIndex = 0;
    this.emojiCells[nextIndex]!.focus();
  }

  private sendCurrentMessage(): void {
    const body = this.input.value.trim();
    if (body.length === 0) {
      return;
    }

    this.input.value = "";
    this.updateSendButtonEnabled();
    this.dispatchSend(body);
  }

  /**
   * `20-07`: `contentKind`/`content` are how a **structured reply** rides this same send path -
   * "reply-by-id, never free text, on any channel including the widget". Both are `undefined` for a
   * plain typed message and for `invokeModule`'s trigger-phrase send, which is the whole point:
   * clicking a primitive's action or the module chip is never a second call, only a different pair of
   * arguments to the one function every visitor-authored message already goes through.
   */
  private dispatchSend(body: string, attachmentId?: string, contentKind?: string, content?: string): void {
    // `25-149`: "the visitor's first sent message" is the card's own second, independent dismissal
    // trigger, alongside the «Написать в чат» row's own click - every visitor-authored send, typed or
    // a module's own trigger phrase (`invokeModule`), goes through this one function, which is what
    // makes this the single place to observe that fact rather than a second copy of the check at each
    // of this method's own callers.
    this.dismissChannelSwitcher();

    // `23-64`/`adr/0148`: the optimistic bubble still renders synchronously, before any connection
    // exists or not - a visitor typing into an auto-opened panel gets the identical instant feedback
    // an already-connected one already gives, and `completeSend` below is where the one thing that
    // now might not exist yet (a live hub connection) actually gets awaited.
    const bubble = this.renderBubble("Visitor", body, "sending");
    if (attachmentId) {
      this.renderAttachmentInto(bubble, attachmentId);
    }

    const clientMessageId = newClientMessageId();
    this.pendingSends.set(clientMessageId, bubble);

    guardAsync(() => this.completeSend(bubble, clientMessageId, body, attachmentId, contentKind, content));
  }

  /**
   * `23-64`/`adr/0148`: the network half of `dispatchSend`, split out so the optimistic bubble above
   * can render before any of this runs. `materializeAutoGreeting` is decided *before* anything else
   * here - `this.connectPromise === null` is true only ever for the first send on a panel this
   * widget auto-opened without connecting (`openForAutoGreeting` never starts `connectPromise`; every
   * other way the panel opens does, in `open()`, before a visitor could ever reach the composer at
   * all). Once decided, this method starts the connection lazily if it has not already started -
   * `open()`'s own `if (this.connectPromise === null)` check, reused rather than duplicated, since a
   * lazy connect-on-first-interaction is exactly what `open()` already does for the ordinary path,
   * just deferred one step further for this one.
   *
   * `VisitorHub.SendMessageWithAutoGreetingAsync` (`ago-chat`) is what actually receives the flag -
   * a hint the server re-verifies inside the same transaction as this very message, never trusted
   * blindly (`PendingMessage`'s own remarks in `ago-chat`).
   */
  private async completeSend(
    bubble: HTMLDivElement,
    clientMessageId: string,
    body: string,
    attachmentId?: string,
    contentKind?: string,
    content?: string,
  ): Promise<void> {
    const materializeAutoGreeting = this.connectPromise === null;
    if (this.connectPromise === null) {
      this.connectPromise = this.connect();
    }

    await this.connectPromise;

    if (this.connection === null || this.conversationId === null) {
      // `connect()` itself already reported this via `this.status` - nothing new to say, only this
      // one bubble to resolve, the same "no delivery can ever carry this id" cleanup the ordinary
      // NotConnectedError branch below already does.
      this.pendingSends.delete(clientMessageId);
      this.markBubbleFailed(bubble, this.strings.notConnectedRetryNote);
      this.updateSendButtonEnabled();
      return;
    }

    const connection = this.connection;
    const conversationId = this.conversationId;

    connection
      .sendMessage(conversationId, body, clientMessageId, attachmentId, contentKind, content, materializeAutoGreeting)
      .then(() => {
        bubble.classList.remove("ago-message--pending");
      })
      .catch((error: unknown) => {
        if (error instanceof SendOutcomeUnknownError) {
          // `5-17`'s decision, and the case that decides it: **the entry is kept.** This error means
          // the invoke was in flight when the socket went, so the message may well have landed. If
          // it did, the server's own copy carries this same `clientMessageId` and will arrive - over
          // the live connection, or in the history a resuming `JoinAsync` replays after the
          // reconnect - and reconciles this bubble into the real message, rendered once. Dropping
          // the entry here would make that arrival look like a brand-new message and render the
          // visitor's one message twice, under a warning saying it might never have been sent.
          //
          // This is not "we are not sure" quietly becoming a cleared warning. The warning is removed
          // by one thing only: the server's own copy of *this* message showing up, which is
          // evidence. Nothing else can clear it - not a later message's echo, not a reconnect, not
          // time passing - and if the message really never landed, it stays on screen for good.
          //
          // The same rule the console takes from the other end: `ConversationPage.tsx` retries an
          // unknown-outcome send with the *same* `clientMessageId` (server-side dedup, `5-07`) and a
          // fresh one when nothing was sent. Both sides treat that id as still live exactly when the
          // server may already hold it. This widget does not retry at all - out of scope, and
          // `dispatchSend`'s own message says so - but "still live" means the same thing here.
          this.markBubbleFailed(bubble, this.strings.sendOutcomeUnknownNote);
        } else {
          // Nothing reached the server. `NotConnectedError` never invoked at all; anything else came
          // back while the socket was still up, i.e. the hub refused it. No delivery can ever carry
          // this id, so the entry would sit in the map for the life of the panel. The failed bubble
          // stays until the visitor does something about it, and a visitor message arriving with
          // this id anyway would be a genuinely new message - which is how it would render.
          this.pendingSends.delete(clientMessageId);

          // `25-61`: checked before the two branches below, and the only one of the three that reads
          // the caught error's own message rather than its type - `VisitorHub.SendAsync` (`ago-chat`)
          // has no second .NET exception type to distinguish this from any other hub rejection, only
          // this one prefixed string (see `CONVERSATION_CLOSED_HUB_ERROR_PREFIX`'s own remarks). This
          // is the fix itself: without it, a visitor whose conversation already closed was told the
          // same "Failed to send." as a real network/server failure, unable to tell the two apart.
          let note: string;
          if (error instanceof Error && error.message.startsWith(CONVERSATION_CLOSED_HUB_ERROR_PREFIX)) {
            note = this.strings.conversationEndedNote;
          } else if (error instanceof NotConnectedError) {
            note = this.strings.notConnectedRetryNote;
          } else {
            note = this.strings.sendFailedNote;
          }

          this.markBubbleFailed(bubble, note);
        }

        logWidgetError(error);
      })
      .finally(() => {
        this.updateSendButtonEnabled();
      });
  }

  private markBubbleFailed(bubble: HTMLDivElement, message: string): void {
    bubble.classList.remove("ago-message--pending");
    const note = document.createElement("div");
    note.className = "ago-status";
    note.textContent = message;
    bubble.appendChild(note);
  }

  /**
   * file-storage.md's Upload flow, steps 1-4, driven from the widget: presign, PUT with real
   * progress, confirm - each step's own failure surfaces as a visible bubble state, never a thrown
   * exception (embeddable-widget skill: "never break the host page"). Only step 5 (send the
   * message) reuses `dispatchSend` - an attachment is just a message that happens to carry one.
   */
  private handleFileSelected(file: File): void {
    const rejection = courtesyValidate(file, this.strings);
    if (rejection) {
      this.renderSystemNote(rejection);
      return;
    }

    if (this.connection === null || this.conversationId === null || this.session === null) {
      return;
    }

    const conversationId = this.conversationId;
    const body = this.input.value.trim() || file.name;
    this.input.value = "";
    this.updateSendButtonEnabled();

    const bubble = this.renderBubble("Visitor", body, "sending");
    const progress = document.createElement("div");
    progress.className = "ago-status";
    progress.textContent = `${this.strings.uploading} 0%`;
    bubble.appendChild(progress);

    this.uploadThenSend(file, body, conversationId, bubble, progress);
  }

  /**
   * `17-07`: the token is read per call through `currentToken()`, not captured once when the file
   * was picked. An upload is the one thing this widget does that can outlive a renewal window - a
   * large file on a slow connection - and step 4 (`confirmAttachment`) would otherwise present a
   * token minted before step 1 began.
   */
  private uploadThenSend(
    file: File,
    body: string,
    conversationId: string,
    bubble: HTMLDivElement,
    progress: HTMLDivElement,
  ): void {
    (async () => {
      const created = await createAttachment(this.config, await this.currentToken(), conversationId, file);
      await uploadToPresignedUrl(created.uploadUrl, file, (fraction) => {
        progress.textContent = `${this.strings.uploading} ${Math.round(fraction * 100)}%`;
      });
      await confirmAttachment(this.config, await this.currentToken(), created.attachmentId);

      bubble.remove();
      this.dispatchSend(body, created.attachmentId);
    })().catch((error: unknown) => {
      this.markBubbleFailed(bubble, this.strings.uploadFailedNote);
      logWidgetError(error);
    });
  }

  /**
   * A `MessageDto` from this visitor removes the optimistic bubble for *that* message rather than
   * appending a second one - matched by `clientMessageId` (`5-17`), the id `dispatchSend` generated
   * and the server echoes back on every delivery of it. Comparison is by string equality, which is
   * safe both ways: `crypto.randomUUID()` and `System.Text.Json`'s `Guid` both write the lowercase
   * 8-4-4-4-12 form.
   *
   * Everything with no matching entry renders as the genuinely new incoming message it is: any
   * operator message, a visitor message sent from another tab of this same visitor, a message old
   * enough to predate `clientMessageId` (`5-07` back-filled nothing), and the echo of a send this
   * panel has already given up on.
   */
  private handleIncoming(message: MessageDto): void {
    const clientMessageId = message.clientMessageId;
    if (message.authorKind === "Visitor" && clientMessageId) {
      const bubble = this.pendingSends.get(clientMessageId);
      if (bubble !== undefined) {
        this.pendingSends.delete(clientMessageId);
        bubble.remove();
      }
    }

    // `25-141`: the identical "other side of the conversation" test `appendMessageBubble` below
    // already uses for deciding what to render richly - not narrowed to `Operator` alone, so a
    // `System` module prompt or a materialised `AutoGreeting` arriving while the panel is closed
    // counts as unread too. Gated on `isOpen`, never on whether the panel is merely visible on
    // screen or the browser tab has focus - a message the visitor could already see is not unread
    // regardless of window focus (this item's own stated "Where this is likely to go wrong").
    if (!this.isOpen && message.authorKind !== "Visitor") {
      this.unreadCount += 1;
      this.renderUnreadBadge();
    }

    this.appendMessageBubble(message);
  }

  private appendMessageBubble(message: MessageDto): void {
    // `23-62`: recorded before anything else in this method - every path below can return early
    // (a courtesy-rejected file never reaches here at all) or throw from a later step, and this is
    // the one fact `saveConversation` needs regardless: "this message was shown to the visitor".
    this.renderedMessages.set(message.id, message);

    // `20-07`/`25-133`: only a message from the *other* side of the conversation is a step to render
    // richly. A visitor's own message can carry `contentKind`/`content` too - it is the reply this
    // same widget just sent (`sendStructuredReply`, `{ value }` only, no `actions`) - and re-running
    // the primitive renderer against it would either render nothing useful (no `prompt`/`title`/
    // `fieldId` to read) or, worse, a second set of buttons under a bubble that already answered them.
    //
    // `25-133`: computed *before* the bubble itself now, not after appending it as `20-07` originally
    // did - the fix below needs to know whether a rich form exists before deciding whether the plain
    // `body` bubble should show any text at all. Showing both every time, regardless of whether this
    // returned something, was the bug: a numbered-list `body` and real buttons for the identical
    // choice, one under the other.
    const primitive =
      message.authorKind !== "Visitor"
        ? renderPrimitiveContent(message, this.strings, (contentKind, value, displayText) =>
            this.sendStructuredReply(contentKind, value, displayText),
          )
        : null;

    // `25-146`: the module task's own phone-collection step - a `form`-kind step whose own
    // `content.fieldId === "phone"`, with no contact detail already known. `primitive !== null` is
    // part of this condition (rather than checked separately at the one place below that needs it)
    // purely so TypeScript narrows `primitive` there too - `contentKind === "form"` is always one of
    // `render.ts`'s own `KNOWN_KINDS`, so `primitive` is never actually `null` when this is otherwise
    // true. Gated on `contentKind`/`fieldId` alone, never a module name: `adr/0065`'s closed
    // vocabulary is what any future module sending a `phone` field would produce too, and
    // `loadBookingModuleChip` below stays the one place in this file allowed to name `"calendar"`
    // explicitly - this is not that place, and must not become a second one.
    const isPhoneCollectionStep =
      message.authorKind !== "Visitor" &&
      primitive !== null &&
      message.contentKind === "form" &&
      readFormFieldId(message.content) === "phone" &&
      !this.contactCaptureShown &&
      !this.storage.getHasKnownContactDetail();

    // `25-133`: `body` is the mandatory, every-channel fallback (`adr/0061`) - shown here only when
    // this build could not (or does not yet) turn this message into a rich control, i.e. exactly when
    // `primitive` above is `null` (an unrecognised `contentKind`, or a recognised one this build has
    // no case for, e.g. `verified_phone_form`/`escalate` - `ui/primitives/render.ts`'s own
    // `KNOWN_KINDS`) - or, `25-146`, `isPhoneCollectionStep`: the module's own prompt still deserves
    // showing (it is the only sentence that says *why* the rich contact form below is asking), even
    // though `primitive` itself is non-null there too. When a rich form *did* render (and this is not
    // that case), showing the plain-text rendering underneath it is not a fallback being used, it is a
    // redundant second rendering of the identical choice. The console and Telegram/MAX are untouched
    // by this: both read the full `Message.Body` over their own separate paths, never through this
    // function.
    const bubble = this.renderBubble(
      message.authorKind, message.body, undefined, primitive === null || isPhoneCollectionStep,
    );
    if (message.attachmentId) {
      this.renderAttachmentInto(bubble, message.attachmentId);
    }

    // `23-64`/`adr/0148`: the real, materialised greeting arriving - over the live connection
    // (`ConnectionFanoutConsumer`'s own fan-out, the ordinary delivery path every message uses,
    // `MessageBatchWriter`'s own remarks in `ago-chat`) or replayed in `connect()`'s own history
    // loop on a later page load. Two things this branch guarantees that arrival order alone would
    // not: **no duplicate** - `drawnGreetingBubble` (the client-only placeholder `drawAutoGreeting`
    // left showing) is removed the moment its real counterpart shows up, and **correct position** -
    // inserted as the transcript's own first child rather than appended at whatever position happens
    // to be last when this arrives. That second guarantee matters because this message's own
    // delivery is not guaranteed to *win the race* against the visitor's own local echo
    // (`completeSend`'s optimistic bubble, rendered synchronously before either the connect or the
    // send that materialises this one even starts) - the greeting is always sequence 1 by
    // construction (`Conversation.AddAutoGreetingMessage`, `ago-chat`), so it always belongs first,
    // whichever of the two bubbles this panel happens to receive first.
    if (message.authorKind === "AutoGreeting") {
      this.drawnGreetingBubble?.remove();
      this.drawnGreetingBubble = null;
      if (this.messages.firstChild !== bubble) {
        this.messages.insertBefore(bubble, this.messages.firstChild);
      }
    }

    // `25-133`: `primitive` was computed above, before the bubble existed, so this is simply
    // attaching it - never a second call to `renderPrimitiveContent` against the same message (that
    // would risk a second, independent read disagreeing with the first, however unlikely given the
    // function is pure).
    //
    // `25-146`: never attached for the phone-collection step - the generic bare-input form
    // `isPhoneCollectionStep` detected must never reach the DOM at all, "in place of, not alongside"
    // the rich contact-capture control this method appends for it below (the backlog item's own
    // words) - not merely present-but-disabled the way `25-136`'s own first-step gate left its own
    // gated primitive visible. The built-but-never-inserted element still exists in memory purely so
    // the disable/re-enable calls below can reuse `setPrimitiveControlsDisabled` in the identical
    // shape `25-136` already built, on a node that is already, structurally, never alongside anything.
    if (primitive && !isPhoneCollectionStep) {
      bubble.appendChild(primitive);
    }

    // `23-58`: the online entry point - a light, link-like control under the visitor's *own first*
    // message, offered exactly once (`visitorIntroControlOffered`) regardless of how many visitor
    // messages follow. It does not claim `contactCaptureShown` on its own (see that field's own
    // remarks) - only being clicked, or one of the two branches below pre-empting it, does.
    if (message.authorKind === "Visitor" && !this.contactCaptureShown && !this.visitorIntroControlOffered) {
      this.visitorIntroControlOffered = true;
      this.appendVisitorIntroControl(bubble);
    }

    // `23-09`/`decisions.md` §4: the out-of-hours name-and-phone control, offered exactly once,
    // under the auto-reply bubble that is this item's only caller (this class's own
    // `contactCaptureShown` remarks). `24-05`: appending it is now async (`appendContactCaptureControl`
    // below) - it asks the server whether this site requires a recorded consent before rendering, so
    // the control never shows a checkbox nobody can act on and never omits one the write path would
    // then refuse.
    //
    // `23-58`: if the online link (above) is already showing - unclicked, waiting - this branch is
    // what an out-of-hours reply arriving mid-conversation looks like: the visitor was online, then
    // was not. The link is removed rather than left beside a second, active copy of the same form.
    //
    // `25-136`: narrowed to `primitive === null` - a module step's own prompt rides this identical
    // `authorKind === "System"` (since `20-07`, before this branch existed), which is exactly the
    // coincidence that let this control show up next to a booking prompt with no relationship to
    // booking at all. A message this build actually turned into a rich control is never "an
    // out-of-hours auto-reply with nothing else going on" - the dedicated branch below is what a
    // module step gets instead, now a deliberate condition rather than a side effect of this one.
    if (message.authorKind === "System" && primitive === null && !this.contactCaptureShown) {
      this.visitorIntroControlEl?.remove();
      this.visitorIntroControlEl = null;
      this.contactCaptureShown = true;
      guardAsync(() => this.appendContactCaptureControl(bubble));
    }

    // `25-146`: the module task's own phone-collection step, answered with the rich contact-capture
    // control instead of the generic bare-input form `isPhoneCollectionStep`'s own remarks (above)
    // already keep out of the DOM. This replaces `25-136`'s own "gate the *first* step" branch, which
    // used to fire on any module step at all (service-choice, for booking) the moment `primitive` was
    // non-null and no contact detail was known - glued onto whatever question happened to be first.
    // The author's own reasoning for moving it here (this item's own "What is actually true today"
    // section): a visitor who has already picked a service, a worker, a date and a time has invested
    // real effort, and asking for contact details *there*, immediately before confirmation, reads as
    // a deliberate step of its own rather than a wall going up front.
    //
    // Gated on `!this.storage.getHasKnownContactDetail()` (part of `isPhoneCollectionStep`): a
    // visitor with a contact detail already on file reaches this step's controls immediately - in the
    // common configuration (`25-137`'s own live setup), `ago-calendar` already skips sending this step
    // at all in that case, so this check is this widget's own defensive second line, not the only one.
    // `contactCaptureShown` is the same "shown once" latch `23-09`'s out-of-hours branch above already
    // uses, so the two can never both fire for the same conversation turn.
    //
    // Client-side only, and known to be exactly that: a visitor could still answer this step by
    // crafting a raw send this widget never offered a control for, and a text-channel (Telegram/MAX)
    // visitor never reaches this file at all - both accepted, named limitations (`25-138`), not
    // oversights this branch tries to close.
    if (isPhoneCollectionStep && primitive !== null) {
      const gatedPrimitive = primitive;
      this.visitorIntroControlEl?.remove();
      this.visitorIntroControlEl = null;
      this.contactCaptureShown = true;
      setPrimitiveControlsDisabled(gatedPrimitive, true);
      guardAsync(() =>
        this.appendContactCaptureControl(
          bubble,
          () => setPrimitiveControlsDisabled(gatedPrimitive, false),
          // `25-146`: the one thing this call site needs that the other two never did - answering the
          // step itself once the contact detail is recorded, the same reply mechanism a plain `form`
          // step's own submit already uses (`sendStructuredReply`, matching `render.ts`'s own `form`
          // case byte-for-byte: `contentKind` echoed back, the typed value as both `value` and
          // `displayText`), so `ReplyToModuleTaskHandler.HandlePhoneProvidedAsync` proceeds exactly as
          // it does today for an ordinary typed phone reply.
          (result) => this.sendStructuredReply("form", result.phone, result.phone),
        ),
      );
    }
  }

  /**
   * `23-58`: renders as a sibling placed right *after* `bubble` via `insertAdjacentElement`, never
   * appended inside it - `bubble` here is the visitor's own accent-colored message
   * (`.ago-message--visitor`), and this control's light-grey text is contrast-checked against the
   * panel's white background (`ui/styles.css`'s own `.ago-contact-capture-intro-link` rule), not
   * against that bubble's fill; `insertAdjacentElement` keeps the control anchored to *this* message
   * regardless of what else has since been appended to `this.messages`, which a plain
   * `this.messages.appendChild` would not.
   *
   * A native `<button>`, not a styled `<span>` with a click handler - the backlog item's own "must
   * look like a link and behave like a button... give it an accessible name and keyboard reach" is
   * exactly what a real `<button>` gives for free (focusable, activated by Enter/Space, its
   * `textContent` is its accessible name).
   */
  private appendVisitorIntroControl(bubble: HTMLElement): void {
    const container = document.createElement("div");
    container.className = "ago-contact-capture-intro";

    const link = document.createElement("button");
    link.type = "button";
    link.className = "ago-contact-capture-intro-link";
    link.textContent = this.strings.contactCaptureIntroLink;

    link.addEventListener("click", () => {
      // Defensive: the out-of-hours branch above removes this element from the DOM the moment it
      // claims `contactCaptureShown`, but a click already queued on the event loop at that instant
      // could still reach this handler once. Checking the flag again is cheaper than proving that
      // race cannot happen.
      if (this.contactCaptureShown) {
        return;
      }

      this.contactCaptureShown = true;
      container.replaceChildren();
      guardAsync(() => this.appendContactCaptureControl(container));
    });

    container.appendChild(link);
    bubble.insertAdjacentElement("afterend", container);
    this.visitorIntroControlEl = container;
  }

  /**
   * `24-05`: the one place `getConsentRequirement` is ever called from the widget - right before the
   * control it decides the shape of. A failure here (the request errors, or times out) is treated the
   * same as "not required": the visitor still gets the ordinary, unverified control `23-09` always
   * offered, because a consent *read* failing must never be the reason a visitor cannot leave a
   * callback number at all - the crux this whole item exists to protect the opposite failure mode of.
   *
   * `23-58`: the same function backs both entry points now - `into` is either the out-of-hours
   * `System` bubble itself (the form nests inside it, as `23-09` always did) or the online link's own
   * now-emptied container (`appendVisitorIntroControl`, the form takes the link's place). One render
   * function, one caller of it, two callers of *that*.
   *
   * `25-136`: a third caller now exists - the module-step gate - and it is the one caller that ever
   * passes `onSuccess`: a callback run once `submitContactCapture` actually resolves, so the gate can
   * re-enable the primitive's own controls the moment the form is submitted. The two older callers
   * pass nothing, and nothing about their own behaviour changes.
   *
   * `25-146`: `onSubmitted` is the one thing the module-step gate's own caller needs that no other
   * caller does - a chance to see the just-recorded `ContactCaptureResult` itself, called after
   * `submitContactCapture` resolves and before `onSuccess`, so it can answer the module step's own
   * reply (`sendStructuredReply`) with the phone number that same submission just recorded. The two
   * older callers, and 25-136's own module-gate caller before this item moved it, have no step to
   * answer and pass nothing.
   */
  private async appendContactCaptureControl(
    into: HTMLElement,
    onSuccess?: () => void,
    onSubmitted?: (result: ContactCaptureResult) => void,
  ): Promise<void> {
    let consent: ConsentRequirement | null = null;
    if (this.conversationId) {
      try {
        const token = await this.currentToken();
        consent = await getConsentRequirement(this.config, token, this.conversationId);
      } catch (error) {
        logWidgetError(error);
      }
    }

    // A site that requires consent but has published nothing under this purpose's key yet
    // (`consent.contact` is `null` while `contactRequired` is `true`) is a real tenant
    // misconfiguration `GetConsentRequirementHandler`'s own remarks name - offering a phone form with
    // no way to satisfy the gate would only produce a confusing server refusal on submit, so this
    // widget declines to offer the control at all rather than guess at a friendlier failure.
    //
    // `25-136`: this is also why a gating caller's `onSuccess` is invoked here too, on the way out -
    // the same "must never be the reason a visitor cannot proceed" principle `24-05`'s own remarks
    // above already state for a *consent-read* failure applies identically to a misconfiguration that
    // stops the control from rendering at all: a booking step must not lock forever because this
    // widget declined to offer the one control that would have unlocked it.
    if (consent?.contactRequired && !consent.contact) {
      onSuccess?.();
      return;
    }

    into.appendChild(
      // `25-27`: `this.config.policyBaseUrl` - the one caller in the whole widget that ever needs
      // it, since this is the only place a consent checkbox is ever rendered.
      //
      // `25-129`: the tenant's own configured confirmation text, if `this.session` has one - the
      // one place in the widget that ever resolves this choice, so `renderContactCaptureControl`
      // itself never has to know whether a template came from a tenant or from this widget's own
      // default.
      renderContactCaptureControl(
        this.strings,
        // `25-136`: `onSuccess` runs only once `submitContactCapture` itself resolves - a rejected
        // submission leaves the gate exactly where `renderContactCaptureControl`'s own `.catch`
        // already leaves the form: re-enabled, waiting for the visitor to try again.
        // `25-146`: `onSubmitted` runs first, with the same resolved `result` - see this method's own
        // doc comment for why the module-step gate is the only caller that ever passes it.
        (result) => this.submitContactCapture(result).then(() => {
          onSubmitted?.(result);
          onSuccess?.();
        }),
        consent,
        this.config.policyBaseUrl,
        parseContactCaptureConfirmationText(this.session?.widgetContactCaptureConfirmationText ?? null),
      ),
    );
  }

  /**
   * `23-09`/`23-58`: records the phone, the name (as `Kind: "Name"`) and the e-mail (as
   * `Kind: "Email"`) - three unconditional rows now that `ui/contactCapture.ts` requires all three
   * fields, rather than the two rows `23-09` wrote when the name was optional. `Email` needed no new
   * domain work on the `ago-chat` side: `VisitorContactDetailKind.Email` already existed (`14-14`),
   * unused by this widget until now. Both calls run under the same visitor token this class already
   * renews for every other authenticated write (`currentToken`); a failure on any of the three rejects
   * the whole submission so the control's own catch branch re-enables the form rather than silently
   * losing a row.
   *
   * `24-05`: `recordConsent` runs *before* any contact-detail call, and only for a purpose the
   * control actually rendered a ticked checkbox for (`result.acceptContact`/`result.acceptMarketing`).
   * Ordering matters: if the site requires contact consent, the server's own gate
   * (`RecordVisitorContactDetailHandler`) refuses the phone write until an acceptance already exists,
   * so recording it first is not a style choice, it is what makes the very next call succeed.
   *
   * `25-136`: `this.storage.setHasKnownContactDetail()` runs last, only once every write above has
   * actually succeeded - the one flag every caller of this method shares (the out-of-hours control,
   * the online link, and the module-step gate), so whichever one a visitor happens to submit through
   * unlocks every other one for the rest of this stored identity, not just the caller that showed it.
   */
  private async submitContactCapture(result: ContactCaptureResult): Promise<void> {
    if (!this.conversationId) {
      throw new Error("No conversation to record a contact detail against.");
    }

    const token = await this.currentToken();
    if (result.acceptContact) {
      await recordConsent(this.config, token, this.conversationId, "Contact");
    }

    if (result.acceptMarketing) {
      await recordConsent(this.config, token, this.conversationId, "Marketing");
    }

    await recordContactDetail(this.config, token, this.conversationId, "Phone", result.phone);
    await recordContactDetail(this.config, token, this.conversationId, "Name", result.name);
    await recordContactDetail(this.config, token, this.conversationId, "Email", result.email);
    this.storage.setHasKnownContactDetail();
  }

  /**
   * `20-07`: what a click on a primitive's action, or a submitted `form` input, actually sends -
   * `contentKind` equal to the kind being replied to, `content: { value }`, no `actions`
   * (`ui/primitives/render.ts`'s own contract, matched byte-for-byte against the `ago-chat`/
   * `ago-calendar` workers' identical spec). `displayText` is what the visitor's own bubble shows
   * back to them - the action's label for a button, or the typed text itself for a form - never the
   * raw `value`, which for many kinds is an id or a slot token nobody typed or read.
   */
  private sendStructuredReply(contentKind: string, value: string, displayText: string): void {
    // `25-31`: `content` rides the wire as `ago-chat`'s own `MessagePayload` - a string the server
    // parses as JSON (`MessagePayload`'s own constructor: `JsonDocument.Parse(value)` against a
    // `string`). A raw object here is not that: SignalR's JSON hub protocol serializes each argument
    // by its own JS shape, so a bare `{ value }` reaches the server as a JSON *object* token where
    // the hub method's parameter is typed `string?` - a binding mismatch SignalR rejects before the
    // hub method is ever invoked (no application code runs, nothing is logged, the client sees only
    // the generic "Failed to invoke ... due to an error on the server"). Found live: every structured
    // reply a visitor ever sent through this control - a booking choice, a form submission - silently
    // failed to send, with the visitor's own bubble left reading "Не удалось отправить."
    this.dispatchSend(displayText, undefined, contentKind, JSON.stringify({ value }));
  }

  /**
   * `25-133`: `showBody` defaults to `true` - every existing caller (a visitor's own optimistic
   * bubble, the auto-greeting placeholder) keeps setting the text it always did, unchanged. The one
   * caller that ever passes `false` is `appendMessageBubble`, and only once it already knows
   * `renderPrimitiveContent` built something for this message - see that method's own remarks for
   * why showing both is the bug this parameter exists to let it avoid.
   */
  private renderBubble(
    authorKind: MessageDto["authorKind"],
    body: string,
    state?: "sending",
    showBody = true,
  ): HTMLDivElement {
    const bubble = document.createElement("div");
    // `14-04`: a System message is the shop's own automatic reply, so it gets an incoming-side bubble
    // with a label - deliberately not `.ago-message--system`, which is this widget's *local* status
    // note ("You are offline") and is centred, grey and unlabelled. Conflating the two would make a
    // real message from the shop look like a client-side notice, and vice versa.
    //
    // `23-64`: `"AutoGreeting"` renders exactly like `"Operator"` - not a class of its own, and
    // deliberately not `"auto"` either. This is the author's own decision (`MessageAuthorKind.AutoGreeting`'s
    // own remarks, `ago-chat`): the greeting reads as if from the shop's own side, the opposite of
    // `"System"`'s machine-reply styling, so it gets the identical bubble a real operator message
    // already has - both for the client-drawn placeholder (`drawAutoGreeting`) and the real,
    // materialised message that eventually replaces it, so a visitor never sees a visual change
    // between the two.
    const modifier = authorKind === "System" ? "auto" : authorKind === "AutoGreeting" ? "operator" : authorKind.toLowerCase();
    bubble.className = `ago-message ago-message--${modifier}`;
    if (state === "sending") {
      bubble.classList.add("ago-message--pending");
    }

    if (showBody) {
      // textContent, never innerHTML: `body` is untrusted content typed by the other participant
      // (a visitor's or operator's own keyboard input), never treated as markup.
      bubble.textContent = body;
    }

    this.messages.appendChild(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;
    return bubble;
  }

  private renderSystemNote(text: string): void {
    const note = document.createElement("div");
    note.className = "ago-message ago-message--system";
    note.textContent = text;
    this.messages.appendChild(note);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  /**
   * Resolves a presigned URL for `attachmentId` and appends either an inline image or a plain
   * download link - never a thrown exception if that lookup fails (a stale/expired attachment,
   * the API unreachable), matching this widget's whole "never break the host page" posture.
   *
   * Both render as an `<a target="_blank" rel="noopener noreferrer">`: opening the URL is a
   * top-level navigation to the storage origin, not this host page's origin, so it cannot execute
   * anything in the host page's own context regardless of file-storage.md's still-open
   * `Content-Disposition`/CSP gap on the presigned GET itself (`file-storage.md`, "not shipped by
   * `5-03`") - that gap is a storage-origin content-spoofing risk, out of this widget's reach to
   * fix, and unrelated to the host page it must never break.
   */
  private renderAttachmentInto(bubble: HTMLDivElement, attachmentId: string): void {
    if (this.session === null) {
      return;
    }

    this.currentToken()
      .then((token) => getAttachmentDownload(this.config, token, attachmentId))
      .then((info) => {
        const link = document.createElement("a");
        link.href = info.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "ago-attachment-link";

        if (info.contentType.startsWith("image/")) {
          const img = document.createElement("img");
          img.className = "ago-attachment-image";
          img.src = info.thumbnailUrl ?? info.url;
          img.alt = this.strings.attachmentAlt;
          link.appendChild(img);
        } else {
          link.textContent = this.strings.downloadAttachment;
        }

        bubble.appendChild(link);
        this.messages.scrollTop = this.messages.scrollHeight;
      })
      .catch((error: unknown) => {
        logWidgetError(error);
        const note = document.createElement("div");
        note.className = "ago-status";
        // `25-80`: `Attachment.Removed` (`ConversationErrors`, `23-80`) is the one download failure
        // that is permanent - the file itself is gone, not merely not-ready-yet or unreachable - so
        // it is the one case that earns a distinct sentence. Every other failure this promise chain
        // can reject with (a still-`Pending` upload's `Attachment.NotReady`, a network error, the
        // API unreachable, an expired session) falls through to the original, unnarrowed
        // `attachmentUnavailable` text, exactly as before this item.
        const removed = error instanceof AttachmentRejectedError && error.code === "Attachment.Removed";
        note.textContent = removed ? this.strings.attachmentRemoved : this.strings.attachmentUnavailable;
        bubble.appendChild(note);
      });
  }

  /**
   * `23-62`: the click handler behind «Сохранить диалог» - loads the archive-building module on
   * first use (never before: this `loadModule` call is the only reference anywhere in this file to
   * `modules/saveConversation/archive.ts`, which is what keeps it out of the base bundle exactly as
   * `bundleInputs.test.ts` already checks for the booking module), then hands it everything it needs
   * as plain callbacks bound to this widget's own connection and attachment lookup - the module
   * itself never imports `connection.ts`/`attachments.ts` (`archive.ts`'s own doc comment explains
   * why that separation is what keeps it independently testable).
   *
   * A failure at any point - the lazy chunk 404s, every attachment turns out unreachable, the
   * archive builder itself throws - is caught here and shown as a system note
   * (`saveConversationFailedNote`), never a thrown exception the host page could see
   * (embeddable-widget skill: "never break the host page"). The button simply does not produce a
   * file this time.
   */
  private async saveConversation(): Promise<void> {
    if (this.isSavingConversation || this.connection === null || this.conversationId === null) {
      return;
    }

    this.isSavingConversation = true;
    this.updateSaveButtonEnabled();

    const connection = this.connection;
    const conversationId = this.conversationId;

    try {
      const archiveModule = await loadModule<{
        buildConversationArchive: (input: BuildConversationArchiveInput) => Promise<{ blob: Blob; filename: string }>;
      }>(this.config.scriptUrl, "widget-module-save.js");

      const archive = await archiveModule.buildConversationArchive({
        knownMessages: [...this.renderedMessages.values()],
        fetchOlderPage: (beforeSequence, pageSize) => connection.loadOlderHistory(conversationId, beforeSequence, pageSize),
        fetchAttachmentLocation: (attachmentId) => this.fetchAttachmentLocationForExport(attachmentId),
        locale: this.locale,
        siteKey: this.config.siteKey,
        now: new Date(),
      });

      triggerBrowserDownload(archive.blob, archive.filename);
    } catch (error) {
      logWidgetError(error);
      this.renderSystemNote(this.strings.saveConversationFailedNote);
    } finally {
      this.isSavingConversation = false;
      this.updateSaveButtonEnabled();
    }
  }

  /** `23-62`: the same `getAttachmentDownload` call `renderAttachmentInto` above already makes for an
   * inline bubble - reused, not duplicated, so there is exactly one place in this widget that turns
   * an attachment id into a presigned download location. An {@link AttachmentLookupFailure} on any
   * failure (an expired session, the API unreachable), which `archive.ts` treats as "leave this
   * attachment out of the file", never a thrown exception that would abort the whole save over one
   * unreachable attachment.
   *
   * `25-94`: `"removed"` vs `"unavailable"` is the identical branch `renderAttachmentInto` above
   * already makes on `error.code === "Attachment.Removed"` (`25-80`) - repeated here rather than
   * factored into one shared helper, because the two call sites disagree on what to do with the
   * result: this one returns a plain string across the `saveConversation` module boundary,
   * `renderAttachmentInto` picks a `WidgetStrings` value directly. */
  private async fetchAttachmentLocationForExport(
    attachmentId: string,
  ): Promise<AttachmentLocation | AttachmentLookupFailure> {
    try {
      const token = await this.currentToken();
      const info = await getAttachmentDownload(this.config, token, attachmentId);
      return { url: info.url, contentType: info.contentType };
    } catch (error) {
      logWidgetError(error);
      return error instanceof AttachmentRejectedError && error.code === "Attachment.Removed" ? "removed" : "unavailable";
    }
  }
}

/**
 * `23-62`: the one place a file actually leaves this widget - `URL.createObjectURL` plus a momentary
 * `<a download>` click, the standard way a page triggers a save without navigating anywhere.
 *
 * Deliberately never appended to `document.body`: every other DOM node this widget ever creates lives
 * inside its own Shadow DOM (`ui/shadow-root.ts`), and the isolation rule that keeps it there
 * (embeddable-widget skill: "nothing here may leak into or inherit from the host page") applies to a
 * transient, invisible node exactly as it does to a visible one - a click on a detached element
 * already downloads the file in every browser this widget targets, so there is no reason to touch the
 * host page's own body at all, not even for a moment.
 *
 * The object URL is revoked on a delay rather than immediately after `click()`: revoking it before
 * the browser has actually started reading it (Safari in particular) can cancel the download outright
 * - a real failure mode of the synchronous version of this pattern, not a hypothetical one.
 */
function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
