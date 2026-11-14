/** Downloading a song from an http(s) address into tools/out/downloads/, refusing anything that is not audio. */
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { SongToolError, errorMessage } from './errors';
import { hexPreview, sniffAudio, SNIFF_BYTES, type AudioKind } from './sniff';

export interface Download {
  file: string;
  kind: AudioKind;
  bytes: number;
}

/** A safe file name for a download: from Content-Disposition, else the address, with the sniffed extension. */
export function downloadFileName(url: string, contentDisposition: string | null, kind: AudioKind): string {
  let name = '';
  const disposition = contentDisposition ?? '';
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  try {
    if (encoded) name = decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    else if (plain) name = plain[1].trim();
    else name = decodeURIComponent(path.posix.basename(new URL(url).pathname));
  } catch {
    name = '';
  }
  const base = name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80);
  return `${base || 'download'}.${kind}`;
}

function notAudioMessage(url: string, bytes: Uint8Array): string {
  const sniff = sniffAudio(bytes);
  if (!sniff.audio && sniff.looksLike === 'html') {
    return `${url} returned a web page, not an audio file. Use the direct link to the file itself (often the link behind the page's Download button).`;
  }
  if (!sniff.audio && sniff.looksLike === 'empty') return `${url} returned an empty file.`;
  return `${url} does not look like MP3, WAV, OGG or FLAC audio (it starts with ${hexPreview(bytes)}).`;
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

export async function downloadAudio(url: string, folder: string, options: DownloadOptions = {}): Promise<Download> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'follow' });
  } catch (error) {
    throw new SongToolError(`Could not download ${url}: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new SongToolError(`Could not download ${url}: HTTP ${response.status} ${response.statusText}`.trim());
  if (!response.body) throw new SongToolError(`${url} returned no data.`);

  const total = Number(response.headers.get('content-length')) || null;
  const reader = response.body.getReader();
  const head: Uint8Array[] = [];
  let headLength = 0;
  let received = 0;
  let kind: AudioKind | null = null;
  let file: string | null = null;
  let sink: ReturnType<typeof createWriteStream> | null = null;

  const write = (chunk: Uint8Array) =>
    new Promise<void>((resolve, reject) => sink!.write(chunk, (error) => (error ? reject(error) : resolve())));

  const startFile = async (bytes: Uint8Array) => {
    const sniff = sniffAudio(bytes);
    if (!sniff.audio) {
      await reader.cancel().catch(() => undefined);
      throw new SongToolError(notAudioMessage(url, bytes));
    }
    kind = sniff.kind;
    await mkdir(folder, { recursive: true });
    file = path.join(folder, downloadFileName(url, response.headers.get('content-disposition'), kind));
    sink = createWriteStream(file);
    await write(bytes);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        received += value.length;
        if (sink) await write(value);
        else {
          head.push(value);
          headLength += value.length;
          if (headLength >= SNIFF_BYTES) await startFile(Buffer.concat(head));
        }
        options.onProgress?.(received, total);
      }
      if (done) break;
    }
    if (!sink) await startFile(Buffer.concat(head)); // a file shorter than SNIFF_BYTES
    await new Promise<void>((resolve, reject) => sink!.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    const stream = sink as ReturnType<typeof createWriteStream> | null;
    stream?.destroy();
    if (file) await rm(file, { force: true });
    throw error instanceof SongToolError ? error : new SongToolError(`Could not download ${url}: ${errorMessage(error)}`);
  }
  return { file: file!, kind: kind!, bytes: received };
}
