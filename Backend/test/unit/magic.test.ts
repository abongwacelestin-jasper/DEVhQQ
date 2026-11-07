import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SNIFF_BYTES, matchesMagic, sniffableTypes } from '../../storage/magic.ts';

const bytes = (...xs: (number | string)[]) =>
  Buffer.concat(
    xs.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from([x]))),
  );
const utf8 = (s: string) => Buffer.from(s, 'utf8');

const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'IHDR');
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF');
const GIF87 = utf8('GIF87a\x01\x00');
const GIF89 = utf8('GIF89a\x01\x00');
const WEBP = bytes('RIFF', 0x24, 0, 0, 0, 'WEBPVP8 ');
const PDF = utf8('%PDF-1.7\n%âãÏÓ');
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('storage/magic — binary signatures', () => {
  const cases: [string, Buffer][] = [
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF87],
    ['image/gif', GIF89],
    ['image/webp', WEBP],
    ['application/pdf', PDF],
    ['application/zip', ZIP],
    [DOCX, ZIP],
    [XLSX, ZIP],
    [PPTX, ZIP],
  ];
  for (const [type, data] of cases)
    it(`accepts real ${type}`, () => assert.equal(matchesMagic(type, data), true));

  it('rejects every binary type whose bytes belong to another format (full cross matrix)', () => {
    const samples: Record<string, Buffer> = {
      'image/png': PNG,
      'image/jpeg': JPEG,
      'image/gif': GIF89,
      'image/webp': WEBP,
      'application/pdf': PDF,
      'application/zip': ZIP,
    };
    const zipFamily = new Set(['application/zip', DOCX, XLSX, PPTX]);
    for (const type of Object.keys(samples).concat(DOCX, XLSX, PPTX))
      for (const [from, data] of Object.entries(samples)) {
        const expected = from === type || (zipFamily.has(type) && from === 'application/zip');
        assert.equal(matchesMagic(type, data), expected, `${type} ← ${from}`);
      }
  });

  it('rejects truncated signatures', () => {
    for (let n = 0; n < 8; n++)
      assert.equal(matchesMagic('image/png', PNG.subarray(0, n)), false, `png[${n}]`);
    assert.equal(matchesMagic('image/jpeg', JPEG.subarray(0, 2)), false);
    assert.equal(matchesMagic('image/gif', utf8('GIF89')), false);
    assert.equal(matchesMagic('image/webp', utf8('RIFF\0\0\0\0WEB')), false);
    assert.equal(matchesMagic('application/pdf', utf8('%PDF')), false);
    assert.equal(matchesMagic('application/zip', ZIP.subarray(0, 3)), false);
  });

  it('webp needs both RIFF and WEBP at offset 8 (RIFF/WAVE is not an image)', () => {
    assert.equal(matchesMagic('image/webp', bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt ')), false);
    assert.equal(matchesMagic('image/webp', bytes('RIFX', 0, 0, 0, 0, 'WEBP')), false);
  });

  it('a signature not at offset 0 does not count', () => {
    assert.equal(matchesMagic('image/png', Buffer.concat([Buffer.from([0]), PNG])), false);
    assert.equal(matchesMagic('application/pdf', utf8(' %PDF-1.4')), false);
  });

  it('unknown or dangerous types are never sniffable', () => {
    for (const t of [
      'image/svg+xml',
      'text/html',
      'application/javascript',
      'application/octet-stream',
      'IMAGE/PNG',
      '',
    ])
      assert.equal(matchesMagic(t, PNG), false, t);
    assert.ok(!sniffableTypes.includes('image/svg+xml'));
    assert.ok(!sniffableTypes.includes('text/html'));
  });

  it('empty input never matches anything', () => {
    for (const t of sniffableTypes) assert.equal(matchesMagic(t, new Uint8Array()), false, t);
  });

  it('reads at most a small prefix', () => {
    assert.equal(SNIFF_BYTES, 512);
  });
});

describe('storage/magic — text types', () => {
  const TEXT = ['text/plain', 'text/markdown', 'text/csv'];

  it('accepts UTF-8 text, including non-ASCII', () => {
    for (const t of TEXT) {
      assert.equal(matchesMagic(t, utf8('hello, world\nnaïve café ሴ 😀\n')), true, t);
      assert.equal(matchesMagic(t, utf8('a,b,c\n1,2,3\n')), true, t);
    }
  });

  it('tolerates a multi-byte character split at the end of the sniffed prefix', () => {
    for (const ch of ['é', 'ሴ', '😀']) {
      const full = utf8(`abc${ch}`);
      for (let cut = 1; cut < Buffer.byteLength(ch); cut++)
        assert.equal(
          matchesMagic('text/plain', full.subarray(0, full.length - cut)),
          true,
          `${ch} minus ${cut}`,
        );
    }
  });

  it('rejects NUL bytes and invalid UTF-8', () => {
    assert.equal(matchesMagic('text/plain', utf8('abc\0def')), false);
    assert.equal(matchesMagic('text/plain', bytes('ab', 0xff, 'cd')), false);
    assert.equal(
      matchesMagic('text/plain', bytes('ab', 0xc3, 'cd')),
      false,
      'lone lead byte mid-text',
    );
    assert.equal(matchesMagic('text/csv', PNG), false, 'binary is not text');
    assert.equal(
      matchesMagic('text/plain', PDF.subarray(0, 4)),
      true,
      '"%PDF" alone is plain text',
    );
  });

  it('refuses text that browsers would sniff as markup', () => {
    for (const s of [
      '<!DOCTYPE html><p>x',
      '<html>',
      '  \n<HTML>',
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<?xml version="1.0"?>',
      '<script>alert(1)</script>',
      '<head>',
      '<body onload=x>',
      '<iframe src=//evil>',
      '﻿<html>',
    ])
      for (const t of TEXT)
        assert.equal(matchesMagic(t, utf8(s)), false, `${t}: ${JSON.stringify(s)}`);
    assert.equal(
      matchesMagic('text/markdown', utf8('# Title\n\n<b>inline html later</b> is fine')),
      true,
    );
  });

  // FINDING B-20 (storage/magic.ts:29): the markup deny-list covers 8 tags, but
  // the WHATWG MIME Sniffing "HTML" patterns (§7.1, rules for identifying an
  // unknown MIME type) also include `<!--`, `<a `, `<style`, `<title`, `<b `,
  // `<br`, `<p`, `<h1`, `<div`, `<font`, `<table`. A file starting with any
  // of those passes as text/plain|markdown|csv although the module's stated
  // intent is to refuse anything a browser may sniff as HTML. Low severity
  // while downloads keep `X-Content-Type-Options: nosniff` and an explicit
  // Content-Type, but the check is incomplete as written.
  it(
    'refuses every WHATWG HTML sniffing pattern as text',
    () => {
      for (const s of [
        '<!-- c --><script>x</script>',
        '<a href=x>',
        '<style>',
        '<title>',
        '<b >',
        '<br>',
        '<p>',
        '<h1>',
        '<div>',
        '<font>',
        '<table>',
      ])
        assert.equal(matchesMagic('text/plain', utf8(s)), false, s);
    },
  );
});

describe('storage/magic — application/json', () => {
  it('accepts objects, arrays and strings (after whitespace)', () => {
    for (const s of ['{"a":1}', ' \n[1,2]', '"str"'])
      assert.equal(matchesMagic('application/json', utf8(s)), true, s);
  });

  it('refuses non-JSON-looking text and markup', () => {
    for (const s of ['hello', '<html>{"a":1}', 'a{"x":1}', ''])
      assert.equal(matchesMagic('application/json', utf8(s)), false, JSON.stringify(s));
  });
});
