// Jedinični testovi za Google Safe Browsing v5 dio Ice Shielda.
// Pokretanje: node --test tests/unit.test.mjs   (bez mreže)
// Vektori su iz Chromium 156 unittestova (navedeno kod svakog testa).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as P from '../gsb/proto.js';
import { decodeRice32, riceDeltas, encodeRice32, RiceError } from '../gsb/rice.js';
import { canonicalize, hostVariants, pathVariants, urlExpressions, urlHashes, domainAndRegistry } from '../gsb/url.js';
import * as C from '../gsb/core.js';

const bin = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const hex = (u8) => Buffer.from(u8).toString('hex');
const sha = (s) => new Uint8Array(createHash('sha256').update(Buffer.from(s, 'latin1')).digest());

// ---------------- protobuf ----------------

test('protobuf: BatchGetHashListsRequest = Chromium TestBase64EncodingUsesUrlEncoding', () => {
  // v5_update_protocol_manager_unittest.cc: names=["bi-4b"], version=["ANo>Qqel>C"] -> "CgViaS00YhIKQU5vPlFxZWw-Qw=="
  const req = P.encodeBatchGetHashListsRequest(['bi-4b'], [new TextEncoder().encode('ANo>Qqel>C')]);
  assert.equal(P.base64UrlEncode(req), 'CgViaS00YhIKQU5vPlFxZWw-Qw==');
  const back = P.decodeBatchGetHashListsRequest(P.base64UrlDecode('CgViaS00YhIKQU5vPlFxZWw-Qw=='));
  assert.deepEqual(back.names, ['bi-4b']);
  assert.equal(new TextDecoder().decode(back.versions[0]), 'ANo>Qqel>C');
});

test('protobuf: lista imena + verzija kao Chromium (mw-4b, se-4b, uws-4b)', () => {
  const v = ['version_1', 'version_2', 'version_3'].map((s) => new TextEncoder().encode(s));
  const back = P.decodeBatchGetHashListsRequest(P.encodeBatchGetHashListsRequest(['mw-4b', 'se-4b', 'uws-4b'], v));
  assert.deepEqual(back.names, ['mw-4b', 'se-4b', 'uws-4b']);
  assert.deepEqual(back.versions.map((x) => new TextDecoder().decode(x)), ['version_1', 'version_2', 'version_3']);
});

test('protobuf: SearchHashesRequest bajtovi', () => {
  // polje 1, wire type 2 (0x0a), dužina 4, "abcd"; dva prefiksa
  assert.equal(hex(P.encodeSearchHashesRequest([bin('abcd'), bin('\x00\x01\x02\x03')])), '0a04616263640a0400010203');
  assert.deepEqual(P.decodeSearchHashesRequest(bin('\x0a\x04abcd')).hashPrefixes.map(hex), ['61626364']);
});

test('protobuf: varint, negativni int32, fixed64, packed enumi, nepoznata polja', () => {
  // Duration{seconds=300, nanos=-1}: 08 ac 02 10 ff ff ff ff ff ff ff ff ff 01
  const d = P.decodeDuration(Uint8Array.from([0x08, 0xac, 0x02, 0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]));
  assert.deepEqual(d, { seconds: 300, nanos: -1 });
  assert.deepEqual(P.decodeDuration(P.encodeDuration({ seconds: 300, nanos: -1 }).finish()), { seconds: 300, nanos: -1 });
  // uint32 max i velika vrijednost
  const r = P.decodeRice32(P.encodeRice32({ firstValue: 0xffffffff, riceParameter: 30, entriesCount: 7, encodedData: bin('xyz') }).finish());
  assert.deepEqual({ ...r, encodedData: hex(r.encodedData) }, { firstValue: 0xffffffff, riceParameter: 30, entriesCount: 7, encodedData: '78797a' });
  // FullHashDetail sa packed i nepacked attributes + nepoznato fixed64/fixed32 polje koje se preskače
  const fh = new Uint8Array([
    0x0a, 0x20, ...new Uint8Array(32).fill(7),                 // full_hash
    0x12, 0x06, 0x08, 0x02, 0x12, 0x02, 0x01, 0x02,            // detail{threat_type=2, attributes=[1,2] packed}
    0x12, 0x04, 0x08, 0x01, 0x10, 0x02,                        // detail{threat_type=1, attributes=2 nepacked}
    0x19, 1, 2, 3, 4, 5, 6, 7, 8,                              // polje 3 fixed64 (nepoznato)
    0x25, 1, 2, 3, 4,                                          // polje 4 fixed32 (nepoznato)
  ]);
  const resp = P.decodeSearchHashesResponse(Uint8Array.from([0x0a, fh.length, ...fh, 0x12, 0x03, 0x08, 0xd8, 0x04]));
  assert.equal(resp.fullHashes.length, 1);
  assert.deepEqual(resp.fullHashes[0].details, [{ threatType: 2, attributes: [1, 2] }, { threatType: 1, attributes: [2] }]);
  assert.deepEqual(resp.cacheDuration, { seconds: 600, nanos: 0 });
});

test('protobuf: HashList kodiranje/dekodiranje (sva polja)', () => {
  const hl = {
    name: 'se-4b', version: bin('\x01\x02v3'), partialUpdate: true,
    additionsFourBytes: { firstValue: 10, riceParameter: 3, entriesCount: 1, encodedData: bin('\x02') },
    compressedRemovals: { firstValue: 2, riceParameter: 4, entriesCount: 0, encodedData: new Uint8Array(0) },
    minimumWaitDuration: { seconds: 1800, nanos: 500000000 },
    sha256Checksum: new Uint8Array(32).fill(9),
    metadata: { threatTypes: [2], description: 'opis', hashLength: 2 },
  };
  const resp = P.decodeBatchGetHashListsResponse(P.encodeBatchGetHashListsResponse([hl, { name: 'mw-4b', version: bin('x') }]));
  const [a, b] = resp.hashLists;
  assert.equal(a.name, 'se-4b');
  assert.equal(hex(a.version), hex(hl.version));
  assert.equal(a.partialUpdate, true);
  assert.equal(a.additionsPrefixSize, 4);
  assert.deepEqual({ ...a.additionsFourBytes, encodedData: hex(a.additionsFourBytes.encodedData) }, { firstValue: 10, riceParameter: 3, entriesCount: 1, encodedData: '02' });
  assert.equal(a.compressedRemovals.firstValue, 2);
  assert.deepEqual(a.minimumWaitDuration, { seconds: 1800, nanos: 500000000 });
  assert.equal(P.durationMs(a.minimumWaitDuration), 1800500);
  assert.equal(a.sha256Checksum.length, 32);
  assert.deepEqual(a.metadata, { threatTypes: [2], likelySafeTypes: [], description: 'opis', hashLength: 2 });
  assert.equal(b.name, 'mw-4b');
  assert.equal(b.partialUpdate, false);
  assert.equal(b.additionsFourBytes, null);
  assert.equal(b.additionsPrefixSize, null);
  assert.equal(b.compressedRemovals, null);
});

test('protobuf: oštećen ulaz baca grešku', () => {
  assert.throws(() => P.parseFields(Uint8Array.from([0x0a, 0x05, 1, 2])), /izlazi iz bafera/);
  assert.throws(() => P.parseFields(Uint8Array.from([0x08, 0x80])), /varint/);
  assert.throws(() => P.parseFields(Uint8Array.from([0x0b])), /wire type/);
});

test('base64url sa paddingom', () => {
  assert.equal(P.base64UrlEncode(Uint8Array.from([0xfb, 0xff])), '-_8=');
  assert.deepEqual(Array.from(P.base64UrlDecode('-_8')), [0xfb, 0xff]);
});

// ---------------- Rice ----------------

const be = (arr) => hex(Uint8Array.from(Array.from(arr).flatMap((v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])));

test('Rice: Chromium V5InterestingValues (uint32)', () => {
  // v5_rice_unittest.cc TEST(V5RiceDecoderTest, V5InterestingValues)
  const cases = [
    [489866504, 30, 2, 't\x00\xd2\x97\x1b\xedIt\x00', '1d32c508291bc542f7a502e5'],
    [0x1d7d1d75, 30, 2, '\xf1\x4e\x08\x33\xeb\x16\xa6\x41\x00', '1d7d1d756a3f3131f273f40e'],
    [0x30303030, 3, 2, '\x22', '303030303030303130303032'],
    [0x30303030, 7, 2, '\x02\x02', '303030303030303130303032'],
    [0x30303030, 8, 2, '\x02\x04\x00', '303030303030303130303032'],
    [0, 26, 1, '\xcf\x7d\x00\x00', '00000000100003ee'],
  ];
  for (const [firstValue, riceParameter, entriesCount, stream, expected] of cases) {
    assert.equal(be(decodeRice32({ firstValue, riceParameter, entriesCount, encodedData: bin(stream) })), expected);
  }
});

test('Rice: Chromium V5HashListRiceDecoderTest.DecodeAdditions32Bit', () => {
  assert.equal(be(decodeRice32({ firstValue: 10, riceParameter: 3, entriesCount: 1, encodedData: bin('\x02') })), '0000000a0000000b');
  assert.throws(() => decodeRice32({ firstValue: 10, riceParameter: 3, entriesCount: 1, encodedData: new Uint8Array(0) }), (e) => e.code === 'kRanOutOfBits');
});

test('Rice: Chromium v4 GetNextValueWithInterestingValues (isti format bitova, delte)', () => {
  // v4_rice_unittest.cc TestDecoderGetNextValueWithInterestingValues
  const cases = [
    [2, [15, 9], '\xf7\x02'],
    [28, [1777762129, 2093280223, 924369848], '\xbf\xa8\x3f\xfb\xfc\xfb\x5e\x27\xe6\xc3\x1d\xc6\x38'],
    [28, [62763050, 1046523781, 192522171, 1800511020, 4442775, 582142548],
      '\x54\x60\x7b\xe7\x0a\x5f\xc1\xdc\xee\x69\xde\xfe\x58\x3c\xa3\xd6\xa5\xf2\x10\x8c\x4a\x59\x56\x00'],
    [28, [26067715, 344823336, 8420095, 399843890, 95029378, 731622412, 35811335, 1047558127, 1117722715, 78698892],
      '\x06\x86\x1b\x23\x14\xcb\x46\xf2\xaf\x07\x08\xc9\x88\x54\x1f\x41\x04\xd5\x1a\x03\xeb\xe6\x3a\x80\x13\x91\x7b\xbf\x83\xf3\xb7\x85\xf1\x29\x18\xb3\x61\x09'],
    [27, [225846818, 328287420, 166748623, 29117720, 552397365, 350353215, 558267528, 4738273, 567093445, 28563065, 55077698, 73091685, 339246010, 98242620, 38060941, 63917830, 206319759, 137700744],
      '\x89\x98\xd8\x75\xbc\x44\x91\xeb\x39\x0c\x3e\x30\x9a\x78\xf3\x6a\xd4\xd9\xb1\x9f\xfb\x70\x3e\x44\x3e\xa3\x08\x67\x42\xc2\x2b\x46\x69\x8e\x3c\xeb\xd9\x10\x5a\x43\x9a\x32\xa5\x2d\x4e\x77\x0f\x87\x78\x20\xb6\xab\x71\x98\x48\x0c\x9e\x9e\xd7\x23\x0c\x13\x43\x2c\xa9\x01'],
    [28, [339784008, 263128563, 63871877, 69723256, 826001074, 797300228, 671166008, 207712688],
      '\x21\xc5\x02\x91\xf9\x82\xd7\x57\xb8\xe9\x3c\xf0\xc8\x4f\xe8\x64\x8d\x77\x62\x04\xd6\x85\x3f\x1c\x97\x00\x04\x1b\x17\xc6'],
  ];
  for (const [k, expected, stream] of cases) assert.deepEqual(Array.from(riceDeltas(k, expected.length, bin(stream))), expected);
  // v4 TestDecoderIntegersWithMultipleValues: first=5, k=2, "\xf7\x02" -> 5, 20, 29 (direktno preko dekodera delti)
  const d = riceDeltas(2, 2, bin('\xf7\x02'));
  assert.deepEqual([5, 5 + d[0], 5 + d[0] + d[1]], [5, 20, 29]);
});

test('Rice: greške (prekoračenje, prevelik količnik, parametar, broj unosa)', () => {
  // v4 TestDecoderIntegersWithOverflowValues: 5 + 1777762129 + 2093280223 + 924369848 > 2^32
  assert.throws(() => decodeRice32({ firstValue: 5, riceParameter: 28, entriesCount: 3, encodedData: bin('\xbf\xa8\x3f\xfb\xfc\xfb\x5e\x27\xe6\xc3\x1d\xc6\x38') }),
    (e) => e instanceof RiceError && e.code === 'kPrefixAccumulationOverflow');
  // k=30: max q = 3; 4 jedinice -> kQuotientTooLarge
  assert.throws(() => decodeRice32({ firstValue: 0, riceParameter: 30, entriesCount: 1, encodedData: Uint8Array.from([0x0f, 0, 0, 0, 0]) }), (e) => e.code === 'kQuotientTooLarge');
  assert.throws(() => decodeRice32({ firstValue: 0, riceParameter: 2, entriesCount: 1, encodedData: bin('a') }), (e) => e.code === 'kRiceParameterTooSmall');
  assert.throws(() => decodeRice32({ firstValue: 0, riceParameter: 31, entriesCount: 1, encodedData: bin('a') }), (e) => e.code === 'kRiceParameterTooLarge');
  assert.throws(() => decodeRice32({ firstValue: 0, riceParameter: 5, entriesCount: -1, encodedData: bin('') }), (e) => e.code === 'kNegativeNumEntries');
  // 0 unosa: samo first_value, parametar se ne provjerava
  assert.deepEqual(Array.from(decodeRice32({ firstValue: 0x69f67f51, riceParameter: 0, entriesCount: 0, encodedData: bin('') })), [0x69f67f51]);
  // max vrijednost tačno 0xffffffff je dozvoljena
  const enc = encodeRice32([0xfffffff0, 0xffffffff], 3);
  assert.deepEqual(Array.from(decodeRice32(enc)), [0xfffffff0, 0xffffffff]);
});

test('Rice: kodiranje -> dekodiranje (nasumično, 20.000 vrijednosti)', () => {
  const set = new Set();
  let x = 12345;
  while (set.size < 20000) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; set.add(x); }
  const vals = [...set].sort((a, b) => a - b);
  for (const k of [17, 18, 28, 30]) {
    assert.deepEqual(Array.from(decodeRice32(encodeRice32(vals, k))), vals);
  }
});

// ---------------- URL ----------------

test('URL kanonizacija: Chromium SBProtocolManagerUtilTest.CanonicalizeUrl', () => {
  const cases = [
    ['http://host/%25%32%35', 'host', '/%25', ''],
    ['http://host/%25%32%35%25%32%35', 'host', '/%25%25', ''],
    ['http://host/%2525252525252525', 'host', '/%25', ''],
    ['http://host/asdf%25%32%35asd', 'host', '/asdf%25asd', ''],
    ['http://host/%%%25%32%35asd%%', 'host', '/%25%25%25asd%25%25', ''],
    ['http://www.google.com/', 'www.google.com', '/', ''],
    ['http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/', '168.188.99.26', '/.secure/www.ebay.com/', ''],
    ['http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/', '195.127.0.11',
      '/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/', ''],
    ['http://host.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B', 'host.com', '/~a!b@c%23d$e%25f^00&11*22(33)44_55+', ''],
    ['http://3279880203/blah', '195.127.0.11', '/blah', ''],
    ['http://www.google.com/blah/..', 'www.google.com', '/', ''],
    ['http://www.google.com/blah#fraq', 'www.google.com', '/blah', ''],
    ['http://www.GOOgle.com/', 'www.google.com', '/', ''],
    ['http://www.google.com.../', 'www.google.com', '/', ''],
    ['http://www.google.com/q?', 'www.google.com', '/q', ''],
    ['http://www.google.com/q?r?', 'www.google.com', '/q', 'r?'],
    ['http://www.google.com/q?r?s', 'www.google.com', '/q', 'r?s'],
    ['http://evil.com/foo#bar#baz', 'evil.com', '/foo', ''],
    ['http://evil.com/foo;', 'evil.com', '/foo;', ''],
    ['http://evil.com/foo?bar;', 'evil.com', '/foo', 'bar;'],
    ['http://notrailingslash.com', 'notrailingslash.com', '/', ''],
    ['http://www.gotaport.com:1234/', 'www.gotaport.com', '/', ''],
    ['  http://www.google.com/  ', 'www.google.com', '/', ''],
    ['https://www.securesite.com/', 'www.securesite.com', '/', ''],
    ['http://host.com/ab%23cd', 'host.com', '/ab%23cd', ''],
    ['http://host%7d.com//twoslashes?more//slashes', 'host}.com', '/twoslashes', 'more//slashes'],
    ['http://host.com/abc?val=xyz#anything', 'host.com', '/abc', 'val=xyz'],
    ['http://abc:def@host.com/xyz', 'host.com', '/xyz', ''],
    ['http://host%7d.com/abc/%2e%2e%2fdef', 'host}.com', '/def', ''],
    ['http://.......host...com.....//abc/////def%2F%2F%2Fxyz', 'host.com', '/abc/def/xyz', ''],
    ['ftp://host.com/foo?bar', 'host.com', '/foo', 'bar'],
  ];
  for (const [input, host, path, query] of cases) {
    const c = canonicalize(input);
    assert.deepEqual([c.host, c.path, c.query], [host, path, query], input);
  }
  for (const input of ['data:text/html;charset=utf-8,%0D%0A', 'javascript:alert()', 'mailto:abc@example.com']) assert.equal(canonicalize(input), null, input);
  // Napomena: Chromium vektori "http:// leadingspace.com/" i "http://%20leadingspace.com/" (host "%20leadingspace.com")
  // nisu primjenjivi: WHATWG URL parser (i Chromium navigacija) odbija razmak u hostu.
  assert.equal(canonicalize('http:// leadingspace.com/'), null);
});

test('URL izrazi: Chromium SBProtocolManagerUtilUrlParsingTest.UrlParsing (v5)', () => {
  const H = (u) => hostVariants(canonicalize(u).host);
  const Pv = (u) => { const c = canonicalize(u); return pathVariants(c.path, c.query); };
  assert.deepEqual(H('http://a.b.c/1/2.html?param=1'), ['b.c', 'a.b.c']);
  assert.deepEqual(new Set(Pv('http://a.b.c/1/2.html?param=1')), new Set(['/1/2.html?param=1', '/1/2.html', '/1/', '/']));
  assert.equal(Pv('http://a.b.c/1/2.html?param=1').length, 4);
  assert.deepEqual(H('http://a.b.c.d.e.f.g/1.html'), ['f.g', 'e.f.g', 'd.e.f.g', 'c.d.e.f.g', 'a.b.c.d.e.f.g']);
  assert.deepEqual(new Set(Pv('http://a.b.c.d.e.f.g/1.html')), new Set(['/1.html', '/']));
  assert.deepEqual(new Set(Pv('http://a.b/saw-cgi/eBayISAPI.dll/')), new Set(['/saw-cgi/eBayISAPI.dll/', '/saw-cgi/', '/']));
  assert.equal(Pv('http://a.b/saw-cgi/eBayISAPI.dll/').length, 3);
  assert.deepEqual(H('http://maps.google.example.com/1'), ['example.com', 'google.example.com', 'maps.google.example.com']);
  assert.deepEqual(H('http://some.example.co.uk/1'), ['example.co.uk', 'some.example.co.uk']);
  assert.deepEqual(H('http://a.b.c.d.e.f.co.uk/1'), ['f.co.uk', 'e.f.co.uk', 'd.e.f.co.uk', 'c.d.e.f.co.uk', 'a.b.c.d.e.f.co.uk']);
  assert.deepEqual(H('http://example.com/1'), ['example.com']);
  assert.deepEqual(H('http://localhost/1'), ['localhost']);
  assert.deepEqual(H('http://a.foo.appspot.com/1'), ['appspot.com', 'foo.appspot.com', 'a.foo.appspot.com']);
  assert.deepEqual(H('http://a.b.c.domain.test/1'), ['domain.test', 'c.domain.test', 'b.c.domain.test', 'a.b.c.domain.test']);
  assert.deepEqual(H('http://co.uk/1'), ['co.uk']);
  assert.deepEqual(H('http://a.b.example.com./1'), ['example.com', 'b.example.com', 'a.b.example.com']);
  assert.deepEqual(H('http://.a.co.uk/1'), ['a.co.uk']);
});

test('PSL: wildcard i izuzeci (ICANN), privatni registri se ne računaju', () => {
  assert.equal(domainAndRegistry('a.b.kawasaki.jp'), 'a.b.kawasaki.jp'); // *.kawasaki.jp
  assert.equal(domainAndRegistry('city.kawasaki.jp'), 'city.kawasaki.jp'); // !city.kawasaki.jp
  assert.equal(domainAndRegistry('x.city.kawasaki.jp'), 'city.kawasaki.jp');
  assert.equal(domainAndRegistry('b.kawasaki.jp'), '');
  assert.equal(domainAndRegistry('foo.github.io'), 'github.io');
  assert.equal(domainAndRegistry('1.2.3.4'), '');
});

test('URL heševi: IP adresa i spec primjer', async () => {
  // IP: samo tačan host (UrlToFullHashes: HostIsIPAddress)
  assert.deepEqual(urlExpressions('http://1.2.3.4/a/b'), ['1.2.3.4/', '1.2.3.4/a/', '1.2.3.4/a/b']);
  const h = await urlHashes('http://a.b.c/1/2.html?param=1');
  assert.equal(h.length, 8);
  for (const x of h) {
    assert.equal(hex(x.hash), hex(sha(x.expr)));
    assert.equal(x.prefix, Buffer.from(x.hash.subarray(0, 4)).readUInt32BE(0));
  }
  // Google-ov primjer iz specifikacije heširanja: SHA-256("abc")
  assert.equal(hex(sha('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---------------- liste ----------------

test('merge: dodavanja, uklanjanja po indeksu, greške (SBStore::MergeUpdateLoop)', () => {
  const old = Uint32Array.from([10, 20, 30, 40]);
  assert.deepEqual(Array.from(C.merge(old, Uint32Array.from([5, 25, 50]), Uint32Array.from([1, 3]))), [5, 10, 25, 30, 50]);
  assert.deepEqual(Array.from(C.merge(old, new Uint32Array(0), new Uint32Array(0))), [10, 20, 30, 40]);
  assert.throws(() => C.merge(old, Uint32Array.from([20]), new Uint32Array(0)), (e) => e.code === 'kAdditionsHasExistingPrefixFailure');
  assert.throws(() => C.merge(old, new Uint32Array(0), Uint32Array.from([4])), (e) => e.code === 'kRemovalsIndexTooLargeFailure');
  // big-endian redoslijed bajtova = numerički redoslijed uint32
  assert.deepEqual(Array.from(C.merge(Uint32Array.from([0x7fffffff]), Uint32Array.from([0x80000000]), new Uint32Array(0))), [0x7fffffff, 0x80000000]);
});

const listOf = (vals, extra = {}) => ({
  name: 'se-4b', version: bin('v1'), partialUpdate: false, additionsPrefixSize: 4,
  additionsFourBytes: encodeRice32(vals, 20), compressedRemovals: null, minimumWaitDuration: { seconds: 1800, nanos: 0 },
  sha256Checksum: new Uint8Array(0), metadata: null, ...extra,
});
const checksumOf = (vals) => sha(Buffer.from(Uint8Array.from(vals.flatMap((v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]))).toString('latin1'));

test('applyHashList: puno ažuriranje, djelimično, kontrolni zbir', async () => {
  const full = await C.applyHashList(undefined, listOf([100, 200, 300], { sha256Checksum: checksumOf([100, 200, 300]) }));
  assert.deepEqual(Array.from(full.prefixes), [100, 200, 300]);
  assert.equal(new TextDecoder().decode(full.version), 'v1');
  // djelimično: ukloni indeks 0 (100), dodaj 150 i 400
  const part = await C.applyHashList(full, listOf([150, 400], {
    version: bin('v2'), partialUpdate: true, compressedRemovals: encodeRice32([0], 5), sha256Checksum: checksumOf([150, 200, 300, 400]),
  }));
  assert.deepEqual(Array.from(part.prefixes), [150, 200, 300, 400]);
  assert.equal(new TextDecoder().decode(part.version), 'v2');
  // djelimično bez promjena i bez novog zbira: koristi stari zbir
  const same = await C.applyHashList(part, { ...listOf([]), additionsFourBytes: null, additionsPrefixSize: null, version: bin('v3'), partialUpdate: true });
  assert.deepEqual(Array.from(same.prefixes), [150, 200, 300, 400]);
  // pogrešan zbir
  await assert.rejects(C.applyHashList(full, listOf([150], { partialUpdate: true, sha256Checksum: new Uint8Array(32) })), (e) => e.code === 'kChecksumMismatchFailure');
  // puno ažuriranje ignoriše stare podatke
  const reset = await C.applyHashList(part, listOf([7], { sha256Checksum: checksumOf([7]) }));
  assert.deepEqual(Array.from(reset.prefixes), [7]);
});

test('validateBatchResponse: provjere kao ParseUpdateResponse', () => {
  const names = ['se-4b', 'mw-4b'];
  const ok = { hashLists: [listOf([1], { sha256Checksum: new Uint8Array(32), minimumWaitDuration: { seconds: 900, nanos: 0 } }), { ...listOf([]), name: 'mw-4b', additionsFourBytes: null, additionsPrefixSize: null, minimumWaitDuration: { seconds: 300, nanos: 0 } }] };
  assert.equal(C.validateBatchResponse(ok, names).minWaitMs, 300000);
  const bad = (patch, code) => assert.throws(() => C.validateBatchResponse({ hashLists: [{ ...ok.hashLists[0], ...patch }, ok.hashLists[1]] }, names), (e) => e.code === code);
  assert.throws(() => C.validateBatchResponse({ hashLists: [ok.hashLists[0]] }, names), (e) => e.code === 'kMismatchedSizeError');
  bad({ name: 'uws-4b' }, 'kMismatchedNameError');
  bad({ additionsPrefixSize: 8, additionsFourBytes: null }, 'kMismatchedPrefixLengthError');
  bad({ sha256Checksum: new Uint8Array(0) }, 'kChecksumMissingError');
  bad({ sha256Checksum: new Uint8Array(16) }, 'kChecksumSizeError');
  bad({ minimumWaitDuration: { seconds: -1, nanos: 0 } }, 'kNegativeDurationError');
  bad({ additionsFourBytes: { firstValue: 1, riceParameter: 40, entriesCount: 2, encodedData: bin('') } }, 'kInvalidRiceFieldError');
});

test('URL zahtjeva: $req, $ct i key kao u Chromiumu', () => {
  assert.equal(C.batchGetUrl('https://safebrowsing.googleapis.com', 'CgViaS00Yg==', 'AIza x'),
    'https://safebrowsing.googleapis.com/v5/hashLists:batchGet?$req=CgViaS00Yg==&$ct=application/x-protobuf&key=AIza%20x');
  assert.equal(C.searchUrl('http://127.0.0.1:9/', 'CgRhYmNk', 'k'), 'http://127.0.0.1:9/v5/hashes:search?$req=CgRhYmNk&$ct=application/x-protobuf&key=k');
});

// ---------------- odluka o prijetnji ----------------

test('decideThreat: blokira samo potvrđen puni heš odgovarajuće vrste', async () => {
  const url = 'http://evil.example.com/login';
  const hashes = await urlHashes(url);
  const target = hashes.find((h) => h.expr === 'evil.example.com/');
  const lists = new Map([['se-4b', Uint32Array.from([target.prefix])], ['mw-4b', new Uint32Array(0)]]);
  const hits = C.localHits(hashes, lists);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].sbTypes, ['URL_PHISHING']);
  const resp = (fullHash, details) => {
    const req = [C.toHex(C.prefixBytes(target.prefix))];
    const r = C.validateSearchResponse(P.decodeSearchHashesResponse(P.encodeSearchHashesResponse({ fullHashes: [{ fullHash, details }], cacheDuration: { seconds: 300 } })), req);
    const m = new Map();
    for (const fh of r.fullHashes) m.set(fh.fullHash, [fh]);
    return m;
  };
  assert.equal(C.decideThreat(hits, resp(target.hash, [{ threatType: 2, attributes: [] }])), 'URL_PHISHING');
  // isti prefiks, drugi puni heš -> nije potvrđeno
  const other = Uint8Array.from(target.hash); other[31] ^= 1;
  assert.equal(C.decideThreat(hits, resp(other, [{ threatType: 2, attributes: [] }])), null);
  // malware rezultat za prefiks koji je samo u phishing listi -> ne blokira (kao Chromium)
  assert.equal(C.decideThreat(hits, resp(target.hash, [{ threatType: 1, attributes: [] }])), null);
  // CANARY phishing = SUSPICIOUS_SITE -> ne blokira
  assert.equal(C.decideThreat(hits, resp(target.hash, [{ threatType: 2, attributes: [1] }])), null);
  // nepoznata vrsta prijetnje se odbacuje
  assert.equal(C.decideThreat(hits, resp(target.hash, [{ threatType: 99, attributes: [] }])), null);
  // odgovor bez cache_duration je greška
  assert.throws(() => C.validateSearchResponse({ fullHashes: [], cacheDuration: null }, []), (e) => e.code === 'kNoCacheDurationError');
  // puni heš koji ne odgovara traženom prefiksu se izbacuje
  const r = C.validateSearchResponse({ fullHashes: [{ fullHash: new Uint8Array(32), details: [] }], cacheDuration: { seconds: 1, nanos: 0 } }, ['ffffffff']);
  assert.equal(r.fullHashes.length, 0);
});

test('backoff za ažuriranje: 15-30 min, pa duplo, najviše 24 h', () => {
  assert.equal(C.updateBackoffMs(1, 0), 30 * 60e3);
  assert.equal(C.updateBackoffMs(1, 1), 15 * 60e3);
  assert.equal(C.updateBackoffMs(2, 0), 60 * 60e3);
  assert.equal(C.updateBackoffMs(20, 0), 24 * 3600e3);
});
