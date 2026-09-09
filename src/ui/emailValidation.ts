/**
 * `25-28`: a real, named email check for `contactCapture.ts`, run before submit rather than trusting
 * `<input type="email">`'s own constraint validation alone - the HTML spec deliberately leaves that
 * check loose (it accepts plenty of strings no mail system would), and this codebase's own
 * `nameInput`/`phoneInput` guards already re-check every `required` field by hand for the same reason
 * `24-05`'s consent checkbox does: a programmatically dispatched `submit` skips the browser's native
 * validation entirely, so anything that must actually hold has to be checked in code, not attributes.
 *
 * **The pattern itself is WHATWG's own** - the exact regular expression the HTML Living Standard's
 * §"Email state (type=email)" specifies as the *non-normative* reference implementation of "a valid
 * e-mail address", the same one Chromium, Firefox and Safari's own native `type=email` validation is
 * built from. It is deliberately conservative rather than a full RFC 5322 parser (RFC 5322's own
 * grammar accepts addresses - quoted local parts, comments, folding whitespace - that no real mail
 * provider issues), which is exactly the register the backlog item asks for: "well-known,
 * conservative", not hand-invented. Reproduced here verbatim (case-insensitive) rather than pulled in
 * as a dependency - it is one line, and a regex is not a library.
 */
export const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}
