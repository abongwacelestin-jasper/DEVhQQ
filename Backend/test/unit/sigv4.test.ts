import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  ALGORITHM,
  EMPTY_SHA256,
  UNSIGNED_PAYLOAD,
  amzDate,
  canonicalQuery,
  canonicalUri,
  presignUrl,
  sha256Hex,
  signRequest,
  signingKey,
  uriEncode,
} from '../../storage/sigv4.ts';
import { runSigV4Vectors } from '../../storage/sigv4.test.ts';
import { rng } from '../helpers/random.ts';

const SUITE = {
  credentials: {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  },
  region: 'us-east-1',
  service: 'service',
  date: new Date('2015-08-30T12:36:00Z'),
};
const S3 = {
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  region: 'us-east-1',
  service: 's3',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('storage/sigv4 — AWS published vectors', () => {
  // The STORAGE lane's vector table (aws-sig-v4-test-suite + S3 documentation examples).
  for (const v of runSigV4Vectors()) {
    it(v.name, () => assert.equal(v.got, v.want));
  }

  it('derives the documented signing key (IAM docs: 20120215 / us-east-1 / iam)', () => {
    assert.equal(
      signingKey(
        'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        '20120215',
        'us-east-1',
        'iam',
      ).toString('hex'),
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });

  it('get-vanilla canonical request and string-to-sign match the suite byte for byte', () => {
    const s = signRequest({
      ...SUITE,
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
    });
    assert.equal(
      s.canonicalRequest,
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
    assert.equal(
      s.stringToSign,
      [
        ALGORITHM,
        '20150830T123600Z',
        '20150830/us-east-1/service/aws4_request',
        sha256Hex(s.canonicalRequest),
      ].join('\n'),
    );
    assert.equal(
      sha256Hex(s.canonicalRequest),
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
    );
  });

  it('the S3 presigned GET example carries the documented query parameters', () => {
    const url = presignUrl({
      ...S3,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      expiresIn: 86_400,
    });
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), ALGORITHM);
    assert.equal(
      url.searchParams.get('X-Amz-Credential'),
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    assert.equal(url.searchParams.get('X-Amz-Date'), '20130524T000000Z');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '86400');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
    // Credential slashes are percent-encoded on the wire, exactly as in the AWS example URL.
    assert.ok(
      url.search.includes(
        'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
      ),
    );
  });
});

describe('storage/sigv4 — canonicalisation', () => {
  it('amzDate drops separators and milliseconds', () => {
    assert.equal(amzDate(new Date('2015-08-30T12:36:00.123Z')), '20150830T123600Z');
  });

  it('uriEncode keeps only unreserved characters and encodes UTF-8 bytes in upper-case hex', () => {
    assert.equal(uriEncode('AZaz09-._~'), 'AZaz09-._~');
    assert.equal(uriEncode(' +*/=&$'), '%20%2B%2A%2F%3D%26%24');
    assert.equal(uriEncode('a/b', false), 'a/b');
    assert.equal(uriEncode('ሴ'), '%E1%88%B4');
    assert.equal(uriEncode('é'), '%C3%A9');
  });

  it('uriEncode round-trips through decodeURIComponent (property)', () => {
    const r = rng(41);
    const alphabet = [
      'a',
      'Z',
      '0',
      '-',
      '_',
      '.',
      '~',
      ' ',
      '/',
      '+',
      '%',
      '&',
      '=',
      'é',
      'ሴ',
      '😀',
      '*',
      '?',
      '#',
    ];
    for (let i = 0; i < 300; i++) {
      const s = Array.from({ length: r.int(0, 12) }, () => r.pick(alphabet)).join('');
      const enc = uriEncode(s);
      assert.match(enc, /^(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})*$/, s);
      assert.equal(decodeURIComponent(enc), s);
    }
  });

  it('S3 paths are encoded once and never normalised', () => {
    const u = (p: string) => canonicalUri(new URL(`https://b.s3.amazonaws.com${p}`), true);
    assert.equal(u('/test$file.text'), '/test%24file.text');
    assert.equal(u('/a b/c+d'), '/a%20b/c%2Bd');
    // WHATWG URL already resolves dot segments; S3 must still keep empty segments (keys may contain '//').
    assert.equal(u('/a//b'), '/a//b');
    assert.equal(u('/'), '/');
    assert.equal(u('/k%2Fslash'), '/k%2Fslash', 'an encoded slash stays part of the key');
  });

  it('generic services double-encode and remove dot segments (IAM docs example)', () => {
    const u = (p: string) => canonicalUri(new URL(`https://iam.amazonaws.com${p}`), false);
    assert.equal(u('/documents and settings/'), '/documents%2520and%2520settings/');
    assert.equal(u('/example1/example2/../..'), '/');
    assert.equal(u('/./'), '/');
    assert.equal(u('//'), '/');
    assert.equal(u('/a//b'), '/a/b');
    assert.equal(u('/example/..'), '/');
    assert.equal(u('/a/./b/'), '/a/b/');
  });

  it('canonicalQuery sorts by encoded key then value and encodes both', () => {
    assert.equal(
      canonicalQuery(new URLSearchParams('Param2=value2&Param1=value1')),
      'Param1=value1&Param2=value2',
    );
    assert.equal(
      canonicalQuery(new URLSearchParams('a=2&a=1&B=x')),
      'B=x&a=1&a=2',
      'upper-case sorts first',
    );
    assert.equal(canonicalQuery(new URLSearchParams('lifecycle')), 'lifecycle=');
    assert.equal(canonicalQuery(new URLSearchParams([['k y', 'v/a+l']])), 'k%20y=v%2Fa%2Bl');
    assert.equal(canonicalQuery(new URLSearchParams()), '');
  });

  it('header names are lower-cased, values trimmed and inner whitespace collapsed', () => {
    const s = signRequest({
      ...SUITE,
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: { 'My-Header1': '  value1  ', 'My-Header2': '"a   b   c"' },
    });
    assert.ok(s.canonicalRequest.includes('my-header1:value1\nmy-header2:"a b c"\n'));
    assert.equal(s.signedHeaders, 'host;my-header1;my-header2;x-amz-date');
  });

  it('does not duplicate a caller-supplied Host or X-Amz-Date', () => {
    const s = signRequest({
      ...SUITE,
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
    });
    assert.equal(s.signedHeaders, 'host;x-amz-date');
    assert.equal(s.signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });
});

describe('storage/sigv4 — signing behaviour', () => {
  it('Authorization header format and signature = HMAC(signingKey, stringToSign)', () => {
    const s = signRequest({
      ...S3,
      method: 'PUT',
      url: new URL('https://b.s3.amazonaws.com/k'),
      payloadHash: sha256Hex('hi'),
    });
    assert.match(
      s.authorization,
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    const key = signingKey(S3.credentials.secretAccessKey, '20130524', 'us-east-1', 's3');
    assert.equal(s.signature, createHmac('sha256', key).update(s.stringToSign).digest('hex'));
    assert.equal(s.headers.authorization, s.authorization);
    assert.ok(s.canonicalRequest.endsWith(sha256Hex('hi')));
  });

  it('any change to method, path, query, signed header, payload, date, region or secret changes the signature', () => {
    const base = {
      ...S3,
      method: 'PUT',
      url: new URL('https://b.s3.amazonaws.com/key?x=1'),
      headers: { 'content-type': 'image/png' },
      payloadHash: sha256Hex('body'),
    };
    const sig = signRequest(base).signature;
    const variants = [
      { ...base, method: 'POST' },
      { ...base, url: new URL('https://b.s3.amazonaws.com/key2?x=1') },
      { ...base, url: new URL('https://b.s3.amazonaws.com/key?x=2') },
      { ...base, headers: { 'content-type': 'image/gif' } },
      { ...base, payloadHash: sha256Hex('body!') },
      { ...base, date: new Date('2013-05-24T00:00:01Z') },
      { ...base, region: 'eu-west-1' },
      { ...base, credentials: { ...base.credentials, secretAccessKey: 'other' } },
    ];
    for (const v of variants) assert.notEqual(signRequest(v).signature, sig);
    assert.equal(signRequest({ ...base }).signature, sig, 'deterministic');
  });

  it('a session token is sent and signed', () => {
    const s = signRequest({
      ...S3,
      credentials: { ...S3.credentials, sessionToken: 'tok' },
      method: 'GET',
      url: new URL('https://b.s3.amazonaws.com/k'),
    });
    assert.equal(s.headers['x-amz-security-token'], 'tok');
    assert.ok(s.signedHeaders.split(';').includes('x-amz-security-token'));
  });

  it('defaults the payload hash to the empty-body SHA-256', () => {
    assert.equal(sha256Hex(''), EMPTY_SHA256);
    const s = signRequest({ ...S3, method: 'GET', url: new URL('https://b.s3.amazonaws.com/k') });
    assert.ok(s.canonicalRequest.endsWith(`\n${EMPTY_SHA256}`));
  });
});

describe('storage/sigv4 — presigned URLs', () => {
  const base = { ...S3, method: 'PUT', url: new URL('https://b.s3.amazonaws.com/uploads/a b.png') };

  it('rejects expiries outside 1..604800 seconds (S3 maximum is 7 days)', () => {
    for (const expiresIn of [0, -1, 604_801, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      assert.throws(() => presignUrl({ ...base, expiresIn }), /expiresIn/, String(expiresIn));
    assert.equal(presignUrl({ ...base, expiresIn: 1 }).searchParams.get('X-Amz-Expires'), '1');
    assert.equal(
      presignUrl({ ...base, expiresIn: 604_800 }).searchParams.get('X-Amz-Expires'),
      '604800',
    );
  });

  it('pins extra headers as signed headers and defaults to UNSIGNED-PAYLOAD', () => {
    const url = presignUrl({
      ...base,
      expiresIn: 300,
      headers: { 'Content-Type': 'image/png', 'content-length': '42' },
    });
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    const pinned = presignUrl({
      ...base,
      expiresIn: 300,
      headers: { 'Content-Type': 'image/png', 'content-length': '43' },
    });
    assert.notEqual(
      pinned.searchParams.get('X-Amz-Signature'),
      url.searchParams.get('X-Amz-Signature'),
    );
    const sig = url.searchParams.get('X-Amz-Signature')!;
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.ok(!url.search.includes(UNSIGNED_PAYLOAD), 'payload hash is not a query parameter');
  });

  it('keeps the caller query, adds the session token, and serialises canonically', () => {
    const url = presignUrl({
      ...base,
      url: new URL('https://b.s3.amazonaws.com/k?response-content-disposition=attachment'),
      credentials: { ...S3.credentials, sessionToken: 'a/b+c' },
      expiresIn: 60,
    });
    assert.equal(url.searchParams.get('response-content-disposition'), 'attachment');
    assert.equal(url.searchParams.get('X-Amz-Security-Token'), 'a/b+c');
    assert.ok(url.search.includes('X-Amz-Security-Token=a%2Fb%2Bc'));
    const keys = [...url.searchParams.keys()];
    assert.deepEqual(keys, [...keys].sort(), 'query is in canonical (sorted) order');
  });

  it('does not mutate the input URL', () => {
    const input = new URL('https://b.s3.amazonaws.com/k?x=1');
    presignUrl({ ...base, url: input, expiresIn: 60 });
    assert.equal(input.toString(), 'https://b.s3.amazonaws.com/k?x=1');
  });
});
