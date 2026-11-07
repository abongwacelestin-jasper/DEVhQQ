/**
 * SigV4 signer checked against AWS's published test vectors.
 *
 *   node --experimental-strip-types storage/sigv4.test.ts
 *
 * Sources (values copied verbatim, never regenerated from this signer):
 *  - aws-sig-v4-test-suite (`get-vanilla`, `post-vanilla`,
 *    `get-vanilla-query-order-key-case`) — generic-service canonicalisation.
 *  - "Signature Calculations for the Authorization Header" and "Query String
 *    Authentication" examples in the Amazon S3 API reference (sigv4-header-based-auth,
 *    sigv4-query-string-auth) — S3 canonicalisation, ranges, sub-resources, presigning.
 * Every signature check also exercises the signing-key derivation (kDate →
 * kRegion → kService → kSigning). The smoke suite imports `runSigV4Vectors` so these run on every `npm run smoke`.
 */

import { EMPTY_SHA256, presignUrl, signRequest } from './sigv4.ts';

export interface VectorResult {
  name: string;
  ok: boolean;
  want: string;
  got: string;
}

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

export function runSigV4Vectors(): VectorResult[] {
  const out: VectorResult[] = [];
  const check = (name: string, want: string, got: string) =>
    out.push({ name, ok: want === got, want, got });

  check(
    'suite: get-vanilla',
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    signRequest({ ...SUITE, method: 'GET', url: new URL('https://example.amazonaws.com/') })
      .authorization,
  );

  check(
    'suite: post-vanilla',
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
    signRequest({ ...SUITE, method: 'POST', url: new URL('https://example.amazonaws.com/') })
      .authorization,
  );

  check(
    'suite: get-vanilla-query-order-key-case',
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    signRequest({
      ...SUITE,
      method: 'GET',
      url: new URL('https://example.amazonaws.com/?Param2=value2&Param1=value1'),
    }).authorization,
  );

  const s3Headers = (extra: Record<string, string>) => ({
    host: 'examplebucket.s3.amazonaws.com',
    'x-amz-date': '20130524T000000Z',
    ...extra,
  });

  check(
    's3: GET object with range',
    'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    signRequest({
      ...S3,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: s3Headers({ range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 }),
      payloadHash: EMPTY_SHA256,
    }).signature,
  );

  const putBodyHash = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';
  check(
    's3: PUT object (reserved char in key, storage class)',
    '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    signRequest({
      ...S3,
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
      headers: s3Headers({
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        'x-amz-content-sha256': putBodyHash,
      }),
      payloadHash: putBodyHash,
    }).signature,
  );

  check(
    's3: GET bucket lifecycle (empty sub-resource value)',
    'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543',
    signRequest({
      ...S3,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?lifecycle'),
      headers: s3Headers({ 'x-amz-content-sha256': EMPTY_SHA256 }),
      payloadHash: EMPTY_SHA256,
    }).signature,
  );

  check(
    's3: list objects (query ordering)',
    '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    signRequest({
      ...S3,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
      headers: s3Headers({ 'x-amz-content-sha256': EMPTY_SHA256 }),
      payloadHash: EMPTY_SHA256,
    }).signature,
  );

  const presigned = presignUrl({
    ...S3,
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    expiresIn: 86_400,
  });
  check(
    's3: presigned GET (query-string auth)',
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    presigned.searchParams.get('X-Amz-Signature') ?? '',
  );

  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runSigV4Vectors();
  for (const r of results)
    console.log(
      `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    want ${r.want}\n    got  ${r.got}`}`,
    );
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} SigV4 vectors pass`);
  process.exit(failed ? 1 : 0);
}
