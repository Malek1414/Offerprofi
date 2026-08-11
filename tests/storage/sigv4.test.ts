/**
 * AWS Signature Version 4, checked against AWS's own published test vector.
 *
 * A signer is the one piece of this adapter that cannot be verified by reading it.
 * It either produces the byte-exact string a remote server independently recomputes,
 * or every request fails with a 403 that says nothing about which of the dozen
 * canonicalisation rules was broken. So it is tested against the `get-vanilla` case
 * from the AWS SigV4 test suite, whose intermediate values are published, rather than
 * against itself.
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonicalRequest, signedHeaders } from '../../src/storage/sigv4'

// The credentials AWS publishes for the test suite. Not secret, not real.
const VECTOR = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  now: new Date('2015-08-30T12:36:00Z'),
}

const EMPTY_SHA = createHash('sha256').update('').digest('hex')

describe('sigv4 canonical request', () => {
  it('matches the published get-vanilla canonical request byte for byte', () => {
    const canonical = canonicalRequest({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA,
    })

    expect(canonical).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_SHA,
      ].join('\n'),
    )
  })

  it('escapes a path the way S3 expects — slashes kept, everything else encoded', () => {
    const canonical = canonicalRequest({
      method: 'GET',
      url: new URL("https://example.amazonaws.com/a/one/two*three'four"),
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA,
    })

    expect(canonical.split('\n')[1]).toBe('/a/one/two%2Athree%27four')
  })

  it('sorts headers and query parameters, because the server recomputes them sorted', () => {
    const canonical = canonicalRequest({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/?b=2&a=1'),
      headers: {
        'X-Amz-Date': '20150830T123600Z',
        host: 'example.amazonaws.com',
        'Content-Type': 'text/plain',
      },
      payloadHash: EMPTY_SHA,
    })
    const lines = canonical.split('\n')

    expect(lines[2]).toBe('a=1&b=2')
    expect(lines).toContain('content-type;host;x-amz-date')
  })
})

describe('sigv4 signing', () => {
  it('produces the signature AWS publishes for get-vanilla', () => {
    const headers = signedHeaders({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: {},
      payloadHash: EMPTY_SHA,
      ...VECTOR,
    })

    expect(headers['x-amz-date']).toBe('20150830T123600Z')
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
  })

  it('signs the body, so a tampered payload is a different signature', () => {
    const sign = (payloadHash: string) =>
      signedHeaders({
        method: 'PUT',
        url: new URL('https://example.amazonaws.com/object.txt'),
        headers: {},
        payloadHash,
        ...VECTOR,
      }).authorization

    expect(sign(createHash('sha256').update('hello').digest('hex')))
      .not.toBe(sign(createHash('sha256').update('hell0').digest('hex')))
  })
})
