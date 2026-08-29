import type { AttachmentDownloadInfo, CreateAttachmentResponse, ProblemDetails } from "./protocol/types.js";
import type { WidgetConfig } from "./config.js";
import type { WidgetStrings } from "./i18n/strings.js";

/**
 * Mirrors `Ago.Chat.Application.UseCases.CreateAttachment.AttachmentOptions`'s defaults - a
 * courtesy check only (embeddable-widget skill's Uploads section: "enforce the size ceiling
 * client-side as a courtesy while assuming the server enforces it for real"). The widget has no
 * way to ask the server for its real, currently-configured limits (no site-settings endpoint
 * exposes them yet), so this is a starting point that can drift from the server's own config, not
 * an authoritative source - the server's own check is what actually protects it either way.
 */
const COURTESY_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const COURTESY_ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export class AttachmentRejectedError extends Error {}
export class AttachmentUploadFailedError extends Error {}

/** Returns a human-readable reason the file fails the courtesy check, or `null` if it passes.
 * `11-10`: the frame text is translated, `file.type` (or its own "unknown type" filler) is not - it
 * is a value read off the file, not prose this widget wrote. */
export function courtesyValidate(file: File, strings: WidgetStrings): string | null {
  if (!COURTESY_ALLOWED_CONTENT_TYPES.has(file.type)) {
    return `"${file.type || strings.unknownFileType}" ${strings.unsupportedFileTypeSuffix}`;
  }

  if (file.size > COURTESY_MAX_SIZE_BYTES) {
    return strings.fileTooLarge(Math.floor(COURTESY_MAX_SIZE_BYTES / (1024 * 1024)));
  }

  return null;
}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as ProblemDetails;
    return problem.title ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

/** file-storage.md's Upload flow, steps 1-2 - authenticated, unlike `session.ts`'s handshake. */
export async function createAttachment(
  config: WidgetConfig,
  token: string,
  conversationId: string,
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateAttachmentResponse> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/conversations/${conversationId}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
  });

  if (response.status !== 201) {
    throw new AttachmentRejectedError(await problemMessage(response));
  }

  return (await response.json()) as CreateAttachmentResponse;
}

/**
 * Step 3 - `XMLHttpRequest`, not `fetch`: only `XMLHttpRequest` exposes upload progress events,
 * and the skill explicitly asks for real progress from the PUT, not a fake spinner. The presigned
 * URL's own signature was computed over exactly this `Content-Type` (`S3FileStorage`'s
 * `GetPreSignedUrlRequest.ContentType`) - sending a different one here fails the signature, not
 * just a courtesy mismatch.
 */
export function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new AttachmentUploadFailedError(`Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new AttachmentUploadFailedError("Upload failed: network error.")));
    xhr.send(file);
  });
}

/** Step 4 - "uploaded", the server's own HEAD-verify against storage is what actually decides
 * readiness (file-storage.md: "a client claim is never trusted"). */
export async function confirmAttachment(
  config: WidgetConfig,
  token: string,
  attachmentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/attachments/${attachmentId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status !== 204) {
    throw new AttachmentUploadFailedError(await problemMessage(response));
  }
}

/** file-storage.md's Access control section - a fresh presigned GET, authorised per caller. */
export async function getAttachmentDownload(
  config: WidgetConfig,
  token: string,
  attachmentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AttachmentDownloadInfo> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status !== 200) {
    throw new AttachmentRejectedError(await problemMessage(response));
  }

  return (await response.json()) as AttachmentDownloadInfo;
}
