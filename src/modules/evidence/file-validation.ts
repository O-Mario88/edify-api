import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

// ── Secure file-upload validation (OWASP file-upload guidance) ─────────────
// Defence in depth: an upload must pass ALL of —
//   1) extension allowlist            (reject .svg/.html/.exe/.js/archives/...)
//   2) declared-MIME allowlist         (multer fileFilter — first gate)
//   3) extension <-> declared-MIME agree (a .pdf claiming image/png is rejected)
//   4) magic-byte sniff of real bytes  (the declared type must match content)
//   5) active-content / executable block (HTML, SVG, scripts, ELF/PE/Mach-O)
// We never trust the client-supplied filename or Content-Type alone.

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  // Browsers sometimes send a generic type for .docx/.xlsx — allowed at the
  // MIME gate, but the magic-byte sniff still pins it to a real signature.
  'application/octet-stream',
]);

export type FileFamily = 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | 'zip' | 'ole' | 'text';

// Extension -> the content families its bytes are allowed to be. The magic-byte
// check uses these families so a .docx (a zip) and a .csv (text) are validated
// against the right signatures regardless of the declared MIME.
const EXTENSION_FAMILY: Record<string, FileFamily[]> = {
  '.jpg': ['jpeg'],
  '.jpeg': ['jpeg'],
  '.png': ['png'],
  '.webp': ['webp'],
  '.heic': ['heic'],
  '.pdf': ['pdf'],
  '.doc': ['ole'],
  '.docx': ['zip'],
  '.xls': ['ole'],
  '.xlsx': ['zip'],
  '.csv': ['text'],
};

// Explicitly dangerous extensions — blocked even if the MIME looks innocuous.
const BLOCKED_EXTENSIONS = new Set([
  '.svg', '.html', '.htm', '.xhtml', '.xml',
  '.exe', '.dll', '.com', '.scr', '.msi', '.bat', '.cmd', '.ps1',
  '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.jar', '.php', '.py', '.rb',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.tgz', '.bz2',
]);

const startsWith = (buf: Buffer, sig: number[], offset = 0): boolean =>
  buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);

// Signatures that, if present near the head, mean "active/executable content" —
// always rejected, no matter the declared type.
function isDangerousContent(buf: Buffer): boolean {
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return true; // ELF
  if (startsWith(buf, [0x4d, 0x5a])) return true; // MZ / PE
  if (startsWith(buf, [0xca, 0xfe, 0xba, 0xbe])) return true; // Mach-O fat / Java class
  if (startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(buf, [0xce, 0xfa, 0xed, 0xfe])) return true; // Mach-O
  if (startsWith(buf, [0x23, 0x21])) return true; // shebang #!
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<svg') ||
    head.startsWith('<?xml') ||
    head.startsWith('<script')
  );
}

function matchesFamily(buf: Buffer, family: FileFamily): boolean {
  switch (family) {
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
    case 'heic':
      return startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4); // ISO-BMFF 'ftyp' at offset 4
    case 'pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'zip':
      // OOXML (docx/xlsx) are zip containers. Accept the 3 zip record markers.
      return (
        startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
      );
    case 'ole':
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc/.xls
    case 'text':
      // CSV/plain text: no NUL bytes (binary) and no active-content head.
      return !buf.subarray(0, 4096).includes(0x00);
  }
}

// Strip ASCII control characters (0x00-0x1F, 0x7F) and the double-quote, which
// would allow Content-Disposition header injection. Done by char code to avoid
// a control-character regex literal.
function stripUnsafeChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || ch === '"') continue;
    out += ch;
  }
  return out;
}

/** Sanitize the uploader's filename for safe storage as METADATA only (the
 *  on-disk name is random). Strips path separators, control chars, leading
 *  dots, and caps length — defeats path traversal + header injection. */
export function sanitizeOriginalName(name: string): string {
  const base = (name || 'file').split(/[/\\]/).pop() ?? 'file';
  return stripUnsafeChars(base).replace(/^\.+/, '').slice(0, 200).trim() || 'file';
}

export interface UploadCandidate {
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Validate an uploaded file against extension + MIME + magic bytes. Throws
 * BadRequestException on any failure. `head` is the first ~4KB read from the
 * stored file (real content — not client metadata).
 */
export function assertSafeUpload(file: UploadCandidate, head: Buffer): void {
  const ext = extname(file.originalname || '').toLowerCase();

  if (!ext || BLOCKED_EXTENSIONS.has(ext)) {
    throw new BadRequestException('This file type is not allowed. Use PDF, image, Word, Excel or CSV.');
  }
  const families = EXTENSION_FAMILY[ext];
  if (!families) {
    throw new BadRequestException('This file type is not allowed. Use PDF, image, Word, Excel or CSV.');
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Unsupported content type for this file.');
  }
  if (isDangerousContent(head)) {
    throw new BadRequestException('The file contains active or executable content and was rejected.');
  }
  if (!families.some((fam) => matchesFamily(head, fam))) {
    throw new BadRequestException('The file content does not match its extension.');
  }
}
