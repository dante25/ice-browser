// Rice-Golomb dekodiranje za Safe Browsing v5 (32-bitne vrijednosti), prema
// Chromium 156 components/safe_browsing/core/browser/db/v5_rice.cc:
//  - bitovi se čitaju od najmanje značajnog bita svakog bajta (LSB first),
//  - količnik q je unarni (jedinice završene nulom), ostatak r ima k bitova (LSB first),
//  - delta = (q << k) + r, vrijednosti se sabiraju počevši od first_value.

export const MIN_RICE_PARAMETER = 3;   // V5TypeTraits<uint32_t>::kMinRiceParameter
export const MAX_RICE_PARAMETER = 30;  // V5TypeTraits<uint32_t>::kMaxRiceParameter

export class RiceError extends Error {
  constructor(code) { super(`Rice: ${code}`); this.code = code; }
}

// Provjera kao V5RiceInputValidator::Validate<uint32_t>
export function validateRice32(riceParameter, entriesCount) {
  if (entriesCount < 0) throw new RiceError('kNegativeNumEntries');
  if (entriesCount !== 0) {
    if (riceParameter < MIN_RICE_PARAMETER) throw new RiceError('kRiceParameterTooSmall');
    if (riceParameter > MAX_RICE_PARAMETER) throw new RiceError('kRiceParameterTooLarge');
  }
}

// Dekodira `count` delta vrijednosti (bez sabiranja). Bez provjere parametra,
// da se mogu testirati i Chromiumovi v4 vektori (isti format bitova).
export function riceDeltas(riceParameter, count, data, bitWidth = 32) {
  const out = new Float64Array(count);
  const totalBits = data.length * 8;
  const maxQ = 2 ** (bitWidth - riceParameter) - 1;
  const pow = 2 ** riceParameter;
  let p = 0;
  for (let i = 0; i < count; i++) {
    let q = 0;
    for (;;) {
      if (p >= totalBits) throw new RiceError('kRanOutOfBits');
      const bit = (data[p >> 3] >> (p & 7)) & 1;
      p++;
      if (!bit) break;
      if (++q > maxQ) throw new RiceError('kQuotientTooLarge');
    }
    if (p + riceParameter > totalBits) throw new RiceError('kRanOutOfBits');
    let r = 0, got = 0;
    while (got < riceParameter) {
      const off = p & 7;
      const take = Math.min(8 - off, riceParameter - got);
      r += ((data[p >> 3] >> off) & ((1 << take) - 1)) * 2 ** got;
      got += take;
      p += take;
    }
    out[i] = q * pow + r;
  }
  return out;
}

// V5RiceDecoder::DecodeIntegers<uint32_t>: vraća Uint32Array dužine entriesCount + 1.
export function decodeRice32({ firstValue, riceParameter, entriesCount, encodedData }) {
  validateRice32(riceParameter, entriesCount);
  const deltas = riceDeltas(riceParameter, entriesCount, encodedData);
  const out = new Uint32Array(entriesCount + 1);
  let v = firstValue >>> 0;
  out[0] = v;
  for (let i = 0; i < entriesCount; i++) {
    v += deltas[i];
    if (v > 0xffffffff) throw new RiceError('kPrefixAccumulationOverflow');
    out[i + 1] = v;
  }
  return out;
}

// Rice-kodiranje (za testove i lažni server). values: rastući niz uint32.
export function encodeRice32(values, riceParameter = 20) {
  const sorted = Array.from(values);
  const bits = [];
  const pow = 2 ** riceParameter;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d < 0) throw new Error('vrijednosti moraju biti sortirane');
    const q = Math.floor(d / pow), r = d % pow;
    for (let j = 0; j < q; j++) bits.push(1);
    bits.push(0);
    for (let j = 0; j < riceParameter; j++) bits.push(Math.floor(r / 2 ** j) % 2);
  }
  const data = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) data[i >> 3] |= 1 << (i & 7); });
  return { firstValue: sorted.length ? sorted[0] : 0, riceParameter, entriesCount: Math.max(0, sorted.length - 1), encodedData: data };
}
