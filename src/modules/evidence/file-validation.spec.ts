import { describe, it, expect } from 'vitest';
import { assertSafeUpload, sanitizeOriginalName } from './file-validation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n%abc');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]);
const HTML = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
const CSV = Buffer.from('school,score\nA,80\nB,90\n');

const file = (originalname: string, mimetype: string) => ({ originalname, mimetype, size: 1000 });

describe('assertSafeUpload — secure file validation', () => {
  it('accepts a real PNG', () => {
    expect(() => assertSafeUpload(file('photo.png', 'image/png'), PNG)).not.toThrow();
  });
  it('accepts a real PDF', () => {
    expect(() => assertSafeUpload(file('visit.pdf', 'application/pdf'), PDF)).not.toThrow();
  });
  it('accepts a .docx (zip container) sent as octet-stream', () => {
    expect(() => assertSafeUpload(file('form.docx', 'application/octet-stream'), ZIP)).not.toThrow();
  });
  it('accepts a CSV', () => {
    expect(() => assertSafeUpload(file('ssa.csv', 'text/csv'), CSV)).not.toThrow();
  });

  it('blocks an .exe by extension', () => {
    expect(() => assertSafeUpload(file('malware.exe', 'application/octet-stream'), ELF)).toThrow(/not allowed/i);
  });
  it('blocks an .svg by extension (active content)', () => {
    expect(() => assertSafeUpload(file('logo.svg', 'image/png'), SVG)).toThrow(/not allowed/i);
  });
  it('blocks .html by extension', () => {
    expect(() => assertSafeUpload(file('page.html', 'text/csv'), HTML)).toThrow(/not allowed/i);
  });

  it('rejects an executable disguised as a .pdf (magic bytes win)', () => {
    expect(() => assertSafeUpload(file('invoice.pdf', 'application/pdf'), ELF)).toThrow(/active or executable/i);
  });
  it('rejects HTML/script disguised as a .pdf', () => {
    expect(() => assertSafeUpload(file('report.pdf', 'application/pdf'), HTML)).toThrow(/active or executable/i);
  });
  it('rejects a .png whose bytes are actually a PDF (content/extension mismatch)', () => {
    expect(() => assertSafeUpload(file('image.png', 'image/png'), PDF)).toThrow(/does not match/i);
  });
  it('rejects an unsupported declared MIME', () => {
    expect(() => assertSafeUpload(file('x.png', 'application/x-shockwave-flash'), PNG)).toThrow(/Unsupported content type/i);
  });
});

describe('sanitizeOriginalName', () => {
  it('strips path traversal segments', () => {
    expect(sanitizeOriginalName('../../etc/passwd')).toBe('passwd');
  });
  it('strips control chars and quotes (header-injection safe)', () => {
    expect(sanitizeOriginalName('a"b\tc.pdf')).toBe('abc.pdf');
  });
  it('drops leading dots', () => {
    expect(sanitizeOriginalName('...hidden.png')).toBe('hidden.png');
  });
  it('falls back to "file" for empty input', () => {
    expect(sanitizeOriginalName('')).toBe('file');
  });
});
