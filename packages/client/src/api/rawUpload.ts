// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { getCsrfToken } from './trpc';

export class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * POSTs a file as the raw request body — the lab routes take audio this way
 * because base64 through tRPC would outgrow the JSON body limit. XHR rather
 * than fetch so the student sees upload progress on a slow school network.
 */
export function uploadRaw<T>(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // Generous for a slow school network (a minute plus ten seconds per MB),
    // but finite: a dead connection must end in an error the student can retry.
    xhr.timeout = 60_000 + Math.ceil(body.size / (1024 * 1024)) * 10_000;
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    xhr.setRequestHeader('x-csrf-token', getCsrfToken());
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    if (onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        const message = (data as { error?: string } | null)?.error ?? `Upload failed (${xhr.status})`;
        reject(new UploadError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError('Network error — check your connection and try again.', 0));
    xhr.ontimeout = () => reject(new UploadError('The upload timed out — try again.', 0));
    xhr.send(body);
  });
}
