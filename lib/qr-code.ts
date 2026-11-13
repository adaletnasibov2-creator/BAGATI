/**
 * Minimal QR Code encoder (ISO/IEC 18004, byte mode, error correction level M) used to show the 2FA otpauth URI
 * without external services or a new dependency. Structure follows the well-known reference algorithm by
 * Project Nayuki (MIT). Output is a square boolean matrix (true = dark) and an SVG renderer.
 */

type EccLevel = "L" | "M" | "Q" | "H";

// Index 0 unused; versions 1..40.
const ECC_CODEWORDS_PER_BLOCK: Record<EccLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_ERROR_CORRECTION_BLOCKS: Record<EccLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

function getBit(value: number, index: number) {
  return ((value >>> index) & 1) !== 0;
}

function numRawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number, ecl: EccLevel) {
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
}

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

class QrMatrix {
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];
  constructor(readonly version: number, readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
  drawFunctionPatterns(ecl: EccLevel) {
    for (let i = 0; i < this.size; i += 1) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const positions = alignmentPositions(this.version, this.size);
    const last = positions.length - 1;
    positions.forEach((x, i) => positions.forEach((y, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    this.drawFormatBits(ecl, 0);
    this.drawVersion();
  }
  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunction(xx, yy, distance !== 2 && distance !== 4);
      }
    }
  }
  drawFormatBits(ecl: EccLevel, mask: number) {
    const data = (FORMAT_BITS[ecl] << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i += 1) this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, this.size - 15 + i, getBit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }
  private drawVersion() {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, bit);
      this.setFunction(b, a, bit);
    }
  }
  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert && !this.isFunction[y][x]) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
  penalty() {
    let result = 0;
    const size = this.size;
    const addHistory = (length: number, history: number[]) => {
      if (history[0] === 0) length += size;
      history.pop();
      history.unshift(length);
    };
    const countPatterns = (h: number[]) => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const terminate = (color: boolean, length: number, history: number[]) => {
      if (color) { addHistory(length, history); length = 0; }
      length += size;
      addHistory(length, history);
      return countPatterns(history);
    };
    const scan = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < size; a += 1) {
        let color = false;
        let run = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b += 1) {
          if (get(a, b) === color) {
            run += 1;
            if (run === 5) result += 3;
            else if (run > 5) result += 1;
          } else {
            addHistory(run, history);
            if (!color) result += countPatterns(history) * 40;
            color = get(a, b);
            run = 1;
          }
        }
        result += terminate(color, run, history) * 40;
      }
    };
    scan((y, x) => this.modules[y][x]);
    scan((x, y) => this.modules[y][x]);
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) result += 3;
      }
    }
    const dark = this.modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }
}

/** Encodes UTF-8 text in byte mode at the given error correction level. Throws when the text does not fit version 40. */
export function encodeQr(text: string, ecl: EccLevel = "M"): boolean[][] {
  const bytes = [...Buffer.from(text, "utf8")];
  let version = 1;
  let capacityBits = 0;
  for (; version <= 40; version += 1) {
    capacityBits = numDataCodewords(version, ecl) * 8;
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= capacityBits) break;
  }
  if (version > 40) throw new RangeError("Text too long for a QR code");

  const bits: number[] = [];
  const append = (value: number, length: number) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i += 1) {
    const block = data.slice(k, k + shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1));
    k += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) codewords.push(block[i]);
    });
  }

  const matrix = new QrMatrix(version, version * 4 + 17);
  matrix.drawFunctionPatterns(ecl);
  matrix.drawCodewords(codewords);
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    matrix.applyMask(mask);
    matrix.drawFormatBits(ecl, mask);
    const penalty = matrix.penalty();
    if (penalty < minPenalty) { bestMask = mask; minPenalty = penalty; }
    matrix.applyMask(mask);
  }
  matrix.applyMask(bestMask);
  matrix.drawFormatBits(ecl, bestMask);
  return matrix.modules;
}

/** SVG markup with a 4-module quiet zone. Contains only the encoded data; no external references. */
export function qrSvg(text: string, options: { ecl?: EccLevel; title?: string } = {}): string {
  const modules = encodeQr(text, options.ecl ?? "M");
  const border = 4;
  const size = modules.length + border * 2;
  let path = "";
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + border},${y + border}h1v1h-1z`; }));
  const title = options.title ? `<title>${options.title.replace(/[<>&"]/g, "")}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">${title}<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
