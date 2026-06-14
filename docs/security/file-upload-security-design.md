# File Upload Security Design

How Edify accepts, validates, stores, and serves evidence files (visit/attendance/visit forms, meeting minutes, photos, PDFs). Follows OWASP file-upload guidance: authenticated, authorized, validated, access-controlled.

## Upload pipeline (`POST /evidence/upload`)

| Control | Where | Detail |
|---|---|---|
| Authentication | `JwtAuthGuard` | Bearer JWT required. |
| Authorization (role) | `@RequirePermissions(ACTIVITY_COMPLETE)` | Only the staff/partner who did the work. |
| Authorization (object) | `AuthorizationService` `evidence:upload` | Uploader must own/deliver the **parent activity** (partner pinned to their assigned work). |
| Size limit | multer `limits.fileSize` | 10 MB hard cap. |
| Declared-MIME allowlist | multer `fileFilter` + `ALLOWED_MIME_TYPES` | image/jpeg,png,webp,heic · pdf · doc/docx · xls/xlsx · csv · octet-stream. |
| Extension allowlist + block | `assertSafeUpload` | Allowed: jpg/jpeg/png/webp/heic/pdf/doc/docx/xls/xlsx/csv. **Blocked: svg, html, xml, exe, dll, bat, sh, js, jar, php, py, archives (zip/rar/7z/gz/tar)…** |
| Extension ⇄ MIME agreement | `assertSafeUpload` | A `.pdf` declaring `image/png` is rejected. |
| Magic-byte sniff | `assertSafeUpload` | Real bytes must match the extension's content family (PNG/JPEG/WEBP/HEIC/PDF/ZIP-OOXML/OLE/text). The declared Content-Type is never trusted. |
| Active-content block | `isDangerousContent` | Rejects ELF/PE/Mach-O/Java, shebang scripts, and HTML/SVG/XML/`<script>` heads regardless of extension. |
| Malware scan | `EvidenceScanner` seam | No-op default → `scanStatus='skipped'`; bind a ClamAV impl in prod. `infected` → file deleted + quarantined + audited, upload rejected. |
| Safe storage name | multer random filename | On-disk name is random; never derived from user input. |
| Filename sanitization | `sanitizeOriginalName` | Original kept as **metadata only**: path segments, control chars, quotes, leading dots stripped; capped 200 chars (defeats traversal + header injection). |
| Storage location | `EVIDENCE_DIR` | Outside the web root; a Railway persistent volume in prod (`EVIDENCE_STORAGE_DIR`). |
| Audit | `AuditService` | `evidence.upload` (with scanStatus) / `evidence.quarantine`. |

A rejected upload's temp file is always removed from disk (`discard`).

## Why magic bytes + active-content block

The declared extension and Content-Type are attacker-controlled. A `payload.png` could carry an ELF binary or an HTML/SVG file with `<script>` (stored-XSS if ever served inline). We therefore (1) read the first ~4 KB of the **stored** file, (2) require the bytes to match the claimed type, and (3) reject any executable or markup signature outright. SVG and HTML are blocked entirely (not sanitized) because the app has no need for them as evidence.

## Tests

`src/modules/evidence/file-validation.spec.ts` — 15 cases: real PNG/PDF/DOCX/CSV accepted; `.exe`/`.svg`/`.html` blocked by extension; ELF-as-`.pdf` and HTML-as-`.pdf` blocked by content; PDF-bytes-as-`.png` mismatch; bad MIME; filename sanitization (traversal, control chars, leading dots).

See also `evidence-access-policy.md` for download/preview.
