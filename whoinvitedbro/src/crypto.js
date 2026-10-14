// Pure JavaScript crypto for the sources that encrypt their links: the same code runs in
// SkyStream and in larpstream, whatever their native helpers offer.
import { cbc, gcm } from "@noble/ciphers/aes.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function utf8Bytes(text) {
    return new TextEncoderLite().encode(String(text));
}

export function utf8Text(bytes) {
    return new TextEncoderLite().decode(bytes);
}

/** Base64 or base64url (with or without padding) -> bytes. */
export function base64Bytes(text) {
    const clean = String(text || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        buffer = (buffer << 6) | B64.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    return new Uint8Array(out);
}

export function bytesBase64(bytes, url) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
        out += i + 2 < bytes.length ? B64[n & 63] : "=";
    }
    return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

export function hexBytes(hex) {
    const clean = String(hex).replace(/[^0-9a-f]/gi, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}

export function bytesHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** A key of exactly `size` bytes: the text's bytes, zero-padded or cut. */
export function fixedKey(text, size) {
    const bytes = typeof text === "string" ? utf8Bytes(text) : text;
    const out = new Uint8Array(size);
    out.set(bytes.subarray(0, size));
    return out;
}

/** AES-GCM with the IV in front and the tag at the end (WebCrypto layout) -> text. */
export function aesGcmDecrypt(key, data, ivLength = 12) {
    return utf8Text(gcm(key, data.subarray(0, ivLength)).decrypt(data.subarray(ivLength)));
}

export function aesCbcDecrypt(key, iv, data) {
    return utf8Text(cbc(key, iv).decrypt(data));
}

export function aesCbcEncrypt(key, iv, text) {
    return cbc(key, iv).encrypt(utf8Bytes(text));
}

export function md5Hex(text) {
    return bytesHex(md5(utf8Bytes(text)));
}

export function sha256Hex(text) {
    return bytesHex(sha256(utf8Bytes(text)));
}

/** UTF-8 without relying on TextEncoder/TextDecoder, which some plugin engines lack. */
class TextEncoderLite {
    encode(text) {
        const out = [];
        for (let i = 0; i < text.length; i++) {
            let code = text.charCodeAt(i);
            if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
                code = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
            }
            if (code < 0x80) out.push(code);
            else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
            else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
            else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
        return new Uint8Array(out);
    }

    decode(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length;) {
            const b = bytes[i++];
            let code;
            if (b < 0x80) code = b;
            else if (b < 0xe0) code = ((b & 31) << 6) | (bytes[i++] & 63);
            else if (b < 0xf0) code = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
            else code = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
            out += String.fromCodePoint(code);
        }
        return out;
    }
}
