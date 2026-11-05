/**
 * 黄果封面「无 Worker」可行性诊断包（临时，验完即删）
 *
 * 目的：判断封面解密能否搬进包内，从而彻底不依赖 hgpic.113210833.xyz。
 * 需要验证三件事：
 *   A 运行时 ctx.http.get 能不能拿到未被破坏的二进制
 *   B 纯 JS AES-CBC 能不能用（首块解出 JPEG 魔数 ff d8 ff 即为通过）
 *   C App 能不能显示 data:image/... 形式的封面
 * 另外测一段解密耗时，用于外推整图。
 */
const VERSION = "0.1.0";

const GxCrypto = (function () {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function utf8Encode(str) {
    const s = String(str == null ? "" : str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const a = bytes[i++];
      let c;
      if (a < 0x80) c = a;
      else if (a >= 0xf0) c = ((a & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (a >= 0xe0) c = ((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (a >= 0xc0) c = ((a & 31) << 6) | (bytes[i++] & 63);
      else c = 0xfffd;
      if (c > 0xffff) {
        c -= 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
      } else {
        out += String.fromCharCode(c);
      }
    }
    return out;
  }

  function hexToBytes(hex) {
    const h = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const out = new Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function base64ToBytes(text) {
    const s = String(text || "").replace(/[^A-Za-z0-9+/]/g, "");
    const out = [];
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 255);
      }
    }
    return out;
  }

  function bytesToBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
      out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : "=";
      out += i + 2 < bytes.length ? B64.charAt(n & 63) : "=";
    }
    return out;
  }

  const SBOX = new Array(256);
  const INV_SBOX = new Array(256);
  (function () {
    let p = 1;
    let q = 1;
    do {
      p = p ^ ((p << 1) & 255) ^ (p & 128 ? 0x1b : 0);
      q ^= q << 1;
      q ^= q << 2;
      q ^= q << 4;
      q &= 255;
      if (q & 128) q ^= 0x09;
      const x = q ^ ((q << 1 | q >> 7) & 255) ^ ((q << 2 | q >> 6) & 255) ^ ((q << 3 | q >> 5) & 255) ^ ((q << 4 | q >> 4) & 255) ^ 0x63;
      SBOX[p] = x;
      INV_SBOX[x] = p;
    } while (p !== 1);
    SBOX[0] = 0x63;
    INV_SBOX[0x63] = 0;
  })();

  function xtime(a) { return ((a << 1) ^ (a & 128 ? 0x1b : 0)) & 255; }
  function gmul(a, b) {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = xtime(a);
      b >>= 1;
    }
    return r;
  }

  function expandKey(key) {
    const nk = key.length >> 2;
    const nr = nk + 6;
    const w = key.slice();
    let rcon = 1;
    for (let i = nk; i < 4 * (nr + 1); i++) {
      let t = w.slice((i - 1) * 4, i * 4);
      if (i % nk === 0) {
        t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
        rcon = xtime(rcon);
      } else if (nk > 6 && i % nk === 4) {
        t = t.map(v => SBOX[v]);
      }
      for (let j = 0; j < 4; j++) w.push(w[(i - nk) * 4 + j] ^ t[j]);
    }
    return { w, nr };
  }

  function encryptBlock(s, ks) {
    const { w, nr } = ks;
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    for (let r = 1; r <= nr; r++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (r < nr) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
          const x = a0 ^ a1 ^ a2 ^ a3;
          s[c] ^= x ^ xtime(a0 ^ a1);
          s[c + 1] ^= x ^ xtime(a1 ^ a2);
          s[c + 2] ^= x ^ xtime(a2 ^ a3);
          s[c + 3] ^= x ^ xtime(a3 ^ a0);
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    return s;
  }

  function decryptBlock(s, ks) {
    const { w, nr } = ks;
    for (let i = 0; i < 16; i++) s[i] ^= w[nr * 16 + i];
    for (let r = nr - 1; r >= 0; r--) {
      let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
      if (r > 0) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
          s[c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
          s[c + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
          s[c + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
          s[c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
        }
      }
    }
    return s;
  }

  function aesCbcEncrypt(data, key, iv) {
    const ks = expandKey(key);
    const pad = 16 - (data.length % 16);
    const src = data.concat(new Array(pad).fill(pad));
    const out = [];
    let prev = iv.slice();
    for (let i = 0; i < src.length; i += 16) {
      const block = src.slice(i, i + 16).map((v, j) => v ^ prev[j]);
      prev = encryptBlock(block, ks);
      for (let j = 0; j < 16; j++) out.push(prev[j]);
    }
    return out;
  }

  function aesCbcDecrypt(data, key, iv) {
    if (!data.length || data.length % 16) throw new Error("AES 密文长度错误");
    const ks = expandKey(key);
    const out = [];
    let prev = iv.slice();
    for (let i = 0; i < data.length; i += 16) {
      const block = data.slice(i, i + 16);
      const plain = decryptBlock(block.slice(), ks);
      for (let j = 0; j < 16; j++) out.push(plain[j] ^ prev[j]);
      prev = block;
    }
    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16) throw new Error("AES 填充错误");
    return out.slice(0, out.length - pad);
  }

  function md5(bytes) {
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const msg = bytes.slice();
    const bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 0; i < 8; i++) msg.push(i < 4 ? (bitLen >>> (8 * i)) & 255 : Math.floor(bitLen / 4294967296) >>> (8 * (i - 4)) & 255);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let off = 0; off < msg.length; off += 64) {
      const M = [];
      for (let i = 0; i < 16; i++) M[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const sh = S[(i >> 4) * 4 + (i & 3)];
        const x = (A + F + K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((x << sh) | (x >>> (32 - sh)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = [];
    [a0, b0, c0, d0].forEach(v => { for (let i = 0; i < 4; i++) out.push((v >>> (8 * i)) & 255); });
    return bytesToHex(out);
  }

  let ZERO, ONE;
  function initBig() {
    if (ONE) return;
    if (typeof BigInt !== "function") throw new Error("当前运行环境不支持 BigInt");
    ZERO = BigInt(0);
    ONE = BigInt(1);
  }

  function bytesToBig(bytes) {
    initBig();
    const h = bytesToHex(bytes);
    return h ? BigInt("0x" + h) : ZERO;
  }

  function bigToBytes(n, len) {
    let h = n.toString(16);
    if (h.length % 2) h = "0" + h;
    const b = hexToBytes(h);
    while (b.length < len) b.unshift(0);
    return b;
  }

  function modPow(base, exp, mod) {
    let r = ONE;
    let b = base % mod;
    let e = exp;
    while (e > ZERO) {
      if (e & ONE) r = (r * b) % mod;
      e >>= ONE;
      b = (b * b) % mod;
    }
    return r;
  }

  function derIntegers(bytes) {
    const ints = [];
    (function walk(start, end) {
      let p = start;
      while (p < end) {
        const tag = bytes[p++];
        let len = bytes[p++];
        if (len & 128) {
          const n = len & 127;
          len = 0;
          for (let i = 0; i < n; i++) len = len * 256 + bytes[p++];
        }
        if (tag === 0x02) ints.push(bytesToBig(bytes.slice(p, p + len)));
        else if (tag === 0x30) walk(p, p + len);
        else if (tag === 0x03) walk(p + 1, p + len);
        else if (tag === 0x04) { try { walk(p, p + len); } catch (e) {} }
        p += len;
      }
    })(0, bytes.length);
    return ints;
  }

  const keyCache = {};
  function parseKey(pem) {
    if (keyCache[pem]) return keyCache[pem];
    const der = base64ToBytes(String(pem).replace(/-----[^-]+-----/g, ""));
    const ints = derIntegers(der);
    let i = 0;
    while (i < ints.length && ints[i] < BigInt(1) << BigInt(256)) i++;
    const n = ints[i];
    if (!n) throw new Error("RSA 密钥解析失败");
    const key = { n, e: ints[i + 1], d: ints[i + 2], p: ints[i + 3], q: ints[i + 4], dp: ints[i + 5], dq: ints[i + 6], qi: ints[i + 7] };
    key.size = bigToBytes(n, 0).length;
    keyCache[pem] = key;
    return key;
  }

  function rsaEncrypt(text, pem) {
    const key = parseKey(pem);
    const k = key.size;
    const msg = utf8Encode(text);
    if (msg.length > k - 11) throw new Error("RSA 明文过长");
    const em = [0, 2];
    for (let i = 0; i < k - 3 - msg.length; i++) em.push(1 + Math.floor(Math.random() * 255));
    em.push(0);
    const c = modPow(bytesToBig(em.concat(msg)), key.e, key.n);
    return bytesToBase64(bigToBytes(c, k));
  }

  function rsaPrivate(c, key) {
    if (key.p && key.q && key.dp && key.dq && key.qi) {
      const m1 = modPow(c % key.p, key.dp, key.p);
      const m2 = modPow(c % key.q, key.dq, key.q);
      let h = ((m1 - m2) * key.qi) % key.p;
      if (h < ZERO) h += key.p;
      return m2 + h * key.q;
    }
    return modPow(c, key.d, key.n);
  }

  function rsaDecrypt(b64, pem) {
    try {
      const key = parseKey(pem);
      const k = key.size;
      const raw = base64ToBytes(b64);
      let out = [];
      for (let off = 0; off < raw.length; off += k) {
        const em = bigToBytes(rsaPrivate(bytesToBig(raw.slice(off, off + k)), key), k);
        if (em[0] !== 0 || em[1] !== 2) return null;
        const sep = em.indexOf(0, 2);
        if (sep < 10) return null;
        out = out.concat(em.slice(sep + 1));
      }
      return utf8Decode(out);
    } catch (e) {
      return null;
    }
  }

  return { decryptBlock, expandKey, aesCbcDecrypt, aesCbcEncrypt, 
    aesEncryptHex: (text, key, iv) => bytesToHex(aesCbcEncrypt(utf8Encode(text), utf8Encode(key), utf8Encode(iv))),
    aesDecryptHex: (hex, key, iv) => utf8Decode(aesCbcDecrypt(hexToBytes(hex), utf8Encode(key), utf8Encode(iv))),
    md5: text => md5(utf8Encode(text)),
    rsaEncrypt,
    rsaDecrypt,
    base64Decode: text => utf8Decode(base64ToBytes(text))
  };
})();

const COVER_URL = "https://pic.drleao.cn/upload_01/upload/20260826/2026082615264138039.jpg?auth_key=1793881403-0-0-9a6e";
const TINY = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLoor1Gu7OM4/szk9zm5r9bWtbyfc8jA4H63ze9a1ul97+Z5dRXqNFeF/rj/04/wDJv/tT0f7C/wCnn4f8E8uor1Gij/XH/px/5N/9qH9hf9PPw/4J5dRXqNFH+uP/AE4/8m/+1D+wv+nn4f8ABPLqK9Roo/1x/wCnH/k3/wBqH9hf9PPw/wCCeXUV6jXnGqf8ha8/67v/AOhGvayjO/7SnKHs+Wyvvf8ARHBjsv8AqkVLmvfyt+pVr1GvLq9RrxeMf+XH/b3/ALad+Rf8vPl+oUUUV8IfRhRRRQAUUUUAFFFFABXnGqf8ha8/67v/AOhGvR6841T/AJC15/13f/0I19nwh/Hq+i/M8DPP4cPUq16jXl1eo10cY/8ALj/t7/20zyL/AJefL9Qooor4Q+jCiiigAooooAKKKKACvONU/wCQtef9d3/9CNej15xqn/IWvP8Aru//AKEa+z4Q/j1fRfmeBnn8OHqVa9Rry6uz/wCEw07/AJ43P/fK/wDxVenxRgsRivZewg5W5r287HJlGIpUef2krXt+pvUVg/8ACYad/wA8bn/vlf8A4qj/AITDTv8Anjc/98r/APFV8f8A2JmP/Ppnu/2hhf50b1FYP/CYad/zxuf++V/+Ko/4TDTv+eNz/wB8r/8AFUf2JmP/AD6Yf2hhf50b1FYP/CYad/zxuf8Avlf/AIqj/hMNO/543P8A3yv/AMVR/YmY/wDPph/aGF/nRvUVg/8ACYad/wA8bn/vlf8A4qj/AITDTv8Anjc/98r/APFUf2JmP/Pph/aGF/nRvV5xqn/IWvP+u7/+hGup/wCEw07/AJ43P/fK/wDxVclezLcX086AhZZWcA9cE5r6rhnAYnC1qjrQcU0t/U8bNsTRrQiqcr6kNP8AKf8Au/rTKt19LjsXPD8vIlrff5F5FlVHMPae1bXLba3W/dPsV/Kf+7+tHlP/AHf1qxRXm/2rX7L8f8z6P/VXBfzS+9f/ACJX8p/7v60eU/8Ad/WrFFH9q1+y/H/MP9VcF/NL71/8iV/Kf+7+tHlP/d/WrFFH9q1+y/H/ADD/AFVwX80vvX/yJX8p/wC7+tHlP/d/WrFFH9q1+y/H/MP9VcF/NL71/wDIlfyn/u/rTCMHBq3VV/vt9a78DjKmIk1JLTseBnmT0MvpwlSbd31t+iQlW6qVbrnzf7Hz/Q9HhH/l9/27/wC3BRRRXhn24UUUUAFFFFABRRRQAVVf77fWrVVX++31r2cp+OXofH8Wfwafq/yEq3VSrdXm/wBj5/oYcI/8vv8At3/24KKKK8M+3CiiigAooooAKKKKACqr/fb61aqq/wB9vrXs5T8cvQ+P4s/g0/V/kJVuqlLvb+8fzrvxuElieWzta58/kubQy72nPFvmtt5X/wAy1RVXe394/nRvb+8fzrg/smf8yPoP9bKP/Pt/ei1RVXe394/nRvb+8fzo/smf8yD/AFso/wDPt/ei1RVXe394/nRvb+8fzo/smf8AMg/1so/8+396LVFVd7f3j+dG9v7x/Oj+yZ/zIP8AWyj/AM+396LVVX++31o3t/eP50lduDwcsPJtu9zw85zmnmFOMYxas76n/9k=";
const KEY = "f5d965df75336270";   // 黄果封面 AES-128-CBC
const IV = "97b60394abc2fbe1";

function hex2(n) {
  let s = (n & 0xff).toString(16);
  return s.length < 2 ? "0" + s : s;
}

/* 把运行时返回的 data 尽力还原成字节数组，同时报告它到底是什么 */

/* 字节是否完好：长度对得上、且字符串模式下没有出现 U+FFFD 之类的替换字符 */
function isIntact(info) {
  if (!info || !info.bytes) return false;
  if (info.bad && info.bad > 0) return false;
  return true;
}

function toBytes(data) {
  if (!data) return { kind: "empty", bytes: null, len: 0 };
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    var u0 = new Uint8Array(data);
    return { kind: "ArrayBuffer", bytes: Array.prototype.slice.call(u0), len: u0.length };
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
    var u1 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { kind: (data.constructor && data.constructor.name) || "typedarray", bytes: Array.prototype.slice.call(u1), len: u1.length };
  }
  if (Array.isArray(data)) {
    return { kind: "array", bytes: data.map(function (v) { return v & 0xff; }), len: data.length };
  }
  if (typeof data === "string") {
    const n = data.length;
    const bytes = new Array(n);
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const c = data.charCodeAt(i);
      if (c > 0xff) bad++;
      bytes[i] = c & 0xff;
    }
    return {
      kind: "string" + (bad ? "(含U+" + bad + "个多字节)" : "(纯latin1)"),
      bytes: bytes, len: n, bad: bad,
    };
  }
  if (typeof data === "object") {
    const ks = Object.keys(data).slice(0, 6).join(",");
    return { kind: "object{" + ks + "}", bytes: null, len: 0 };
  }
  return { kind: typeof data, bytes: null, len: 0 };
}

function pkcsOk(bytes, from, to) {
  const pad = bytes[to - 1];
  if (pad < 1 || pad > 16) return false;
  for (let i = to - pad; i < to; i++) if (bytes[i] !== pad) return false;
  return true;
}

/* AES-128-CBC 解出前 nBlocks 块（不需要整图，密文块之间无依赖） */
function decryptHead(enc, nBlocks) {
  const total = Math.floor(enc.length / 16);
  const blocks = Math.min(total, nBlocks);
  const key = [];
  for (let i = 0; i < KEY.length; i++) key.push(KEY.charCodeAt(i));
  const ks = GxCrypto.expandKey(key);
  const out = [];
  let prev = [];
  for (let i = 0; i < IV.length; i++) prev.push(IV.charCodeAt(i));
  for (let b = 0; b < blocks; b++) {
    const block = enc.slice(b * 16, b * 16 + 16);
    const plain = GxCrypto.decryptBlock(block.slice(), ks);
    for (let j = 0; j < 16; j++) out.push(plain[j] ^ prev[j]);
    prev = block;
  }
  return out;
}

function card(id, title, subtitle, cover) {
  const it = { ref: { source: "custom", id: "hgdiag:" + id }, title: title, subtitle: subtitle, mediaType: "movie" };
  if (cover) it.images = { poster: cover, cover: cover };
  return it;
}

const widget = {
  type: "widget",
  id: "hgdiag",
  title: "黄果封面诊断",
  description: "验完即删",
  template: "poster-grid",
  async load(ctx) {
    const out = [];
    const t0 = Date.now();

    /* ① 环境 */
    let env = "get=" + typeof ctx.http.get + " post=" + typeof ctx.http.post;
    env += " setTimeout=" + typeof setTimeout;
    env += " locale=" + (ctx.locale || "?");
    out.push(card(0, "① 环境", env));

    /* ② 二进制读取：三种取值方式各试一次，看运行时到底怎么返回字节 */
    let bytes = null;
    const modes = [{ tag: "默认", opt: null }, { tag: "arrayBuffer", opt: { responseType: "arrayBuffer" } }, { tag: "base64", opt: { responseType: "base64" } }];
    for (let mi = 0; mi < modes.length; mi++) {
      const m = modes[mi];
      try {
        const o = { headers: { Referer: "https://huangguoai.com/", "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile" }, timeoutMs: 25000 };
        if (m.opt) { o.responseType = m.opt.responseType; }
        const rr = await ctx.http.get(COVER_URL, o);
        const ii = toBytes(rr.data);
        if (ii.bytes && ii.bytes.length > 64) {
          out.push(card(5, "②b " + m.tag + " " + rr.status, "kind=" + ii.kind + " len=" + ii.len + " 首字节=" + ii.bytes.slice(0, 4).map(hex2).join(" ")));
        } else {
          out.push(card(5, "②b " + m.tag + " " + rr.status, "kind=" + ii.kind + " len=" + ii.len + " 不可用"));
        }
        if (!bytes && ii.bytes && ii.len > 200 && isIntact(ii)) bytes = ii.bytes;
      } catch (e) {
        out.push(card(5, "②b " + m.tag + " 异常", String((e && e.message) || e).slice(0, 140)));
      }
    }
    try {
      const r = await ctx.http.get(COVER_URL, {
        headers: {
          Referer: "https://huangguoai.com/",
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile",
        },
        timeoutMs: 25000,
      });
      const info = toBytes(r.data);
      const hs = r.headers || {};
      const cl = hs["content-length"] || hs["Content-Length"] || "?";
      const ct = hs["content-type"] || hs["Content-Type"] || "?";
      const head = [];
      if (info.bytes) for (let i = 0; i < 6 && i < info.bytes.length; i++) head.push(hex2(info.bytes[i]));
      out.push(card(1, "② 取封面 " + r.status,
        "kind=" + info.kind + " len=" + info.len + " cl=" + cl + " ct=" + ct + " 首字节=" + head.join(" ")));
      if (info.bytes && info.len > 64) bytes = info.bytes;
    } catch (e) {
      out.push(card(1, "② 取封面失败", String((e && e.message) || e).slice(0, 200)));
    }

    /* ③ 首块解密 → 应得 JPEG 魔数 ff d8 ff */
    if (bytes) {
      try {
        const head = decryptHead(bytes, 2);
        const expect = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
        out.push(card(2, expect ? "③ 首块解密 ✅" : "③ 首块解密 ❌",
          "magic=" + hex2(head[0]) + hex2(head[1]) + hex2(head[2]) +
          " 期望=ffd8ff · 前8字节=" + head.slice(0, 8).map(hex2).join(" ")));
      } catch (e) {
        out.push(card(2, "③ 首块解密异常", String((e && e.message) || e).slice(0, 200)));
      }

      /* ④ 解密 32KB 耗时 → 外推整图 */
      try {
        const slice = bytes.slice(0, Math.min(bytes.length - (bytes.length % 16), 32768));
        const t1 = Date.now();
        const pt = decryptHead(slice, slice.length / 16);
        const ms = Date.now() - t1;
        const full = bytes.length - (bytes.length % 16);
        let padOk = "n/a";
        if (pt.length >= 16) padOk = pkcsOk(pt, pt.length - 16, pt.length) ? "尾部像填充" : "尾部非填充(正常)";
        out.push(card(3, "④ 解密耗时",
          "32KB=" + ms + "ms（" + slice.length + "B）→ 整图 " + full + "B 约 " + Math.round(ms * (full / slice.length)) + "ms · " + padOk));
      } catch (e) {
        out.push(card(3, "④ 解密耗时异常", String((e && e.message) || e).slice(0, 200)));
      }
    } else {
      out.push(card(2, "③ 首块解密", "跳过：没拿到字节"));
    }

    /* ⑤ data URL 能否显示（内联小图，与取图无关） */
    const dataUrl = "data:image/jpeg;base64," + TINY;
    out.push(card(4, "⑤ data URL 封面",
      "若能显示下方竖图，说明 App 支持 data: 封面（" + dataUrl.length + " 字符）", dataUrl));

    out.push(card(5, "⑥ 总耗时", (Date.now() - t0) + "ms"));
    return out;
  },
};

definePackage({
  id: "conflux.hgdiag",
  title: "黄果封面诊断",
  version: VERSION,
  icon: "https://maxbo718.github.io/conflux-subscribe/icons/guazi.png",
  description: "临时诊断包：验证封面能否在包内解密（验完即删）",
  engine: 1,
  permissions: {
    network: ["https://", "http://"],
  },
  settings: [],
  extensions: [widget],
});
