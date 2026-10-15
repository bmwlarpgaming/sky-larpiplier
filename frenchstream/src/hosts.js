// Video hosts of French-Stream. Each resolver turns an embed page into playable streams; pages
// are passed in, so everything here is pure and testable with node.
import { unpackedScripts, withUnpacked } from "../../shared/packer.js";

/** Placeholders the site and its hosts hand out instead of the video (decoys for scrapers). */
export function isPlayableMediaUrl(url) {
    const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(String(url || ""));
    if (!match) return false;
    const host = match[1].toLowerCase();
    return !/(^|\.)fstream\.top$/.test(host) && !/\/troll\//i.test(match[2]);
}

export function hostOf(url) {
    const match = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
    return match ? match[1].toLowerCase() : "";
}

/** "fsvid.lol" -> "Fsvid", the name shown for a host. */
export function hostName(url) {
    const host = hostOf(url);
    if (/fsvid/.test(host)) return "Fsvid";
    if (/uqload/.test(host)) return "Uqload";
    if (/vidzy/.test(host)) return "Vidzy";
    const name = host.replace(/^www\./, "").split(".")[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "French-Stream";
}

// ------------------------------------------------------------- Fsvid, Vidzy

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Latin1(text) {
    const clean = String(text || "").replace(/[^A-Za-z0-9+/]/g, "");
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        buffer = (buffer << 6) | B64.indexOf(char);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return out;
}

/**
 * Fsvid and Vidzy write their source as `(function(s){…})("<base64>")`: the decoded text is
 * reversed and XORed with `(base + i * step + H + BC) & 255`, where H is the sum of the page's
 * hostname characters and BC the width of a measuring element, `(1in + A px) - B px`.
 * The constants change between hosts and over time: they are read from the script.
 */
export function decodeObfuscatedSource(script, hostname) {
    const source = String(script || "");
    const encoded = /\}\)\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/.exec(source);
    const key = /\(\s*0x([0-9a-f]+)\s*\+\s*i\s*\*\s*(\d+)\s*\+\s*H\s*\+\s*BC\s*\)/i.exec(source);
    const outer = /width:\s*calc\(\s*1in\s*\+\s*(\d+)px\s*\)/i.exec(source);
    const inner = /width:\s*calc\(\s*100%\s*-\s*(\d+)px\s*\)/i.exec(source);
    if (!encoded || !key) return null;
    // 1in is 96 CSS pixels.
    const measured = outer && inner ? 96 + parseInt(outer[1], 10) - parseInt(inner[1], 10) : 0;
    let hash = 0;
    for (const char of String(hostname || "")) hash = (hash + char.charCodeAt(0)) & 255;
    const base = parseInt(key[1], 16);
    const step = parseInt(key[2], 10);
    const reversed = base64Latin1(encoded[1]).split("").reverse().join("");
    let out = "";
    for (let i = 0; i < reversed.length; i++) {
        out += String.fromCharCode(reversed.charCodeAt(i) ^ ((base + i * step + hash + measured) & 255));
    }
    return /^https?:\/\//.test(out) && isPlayableMediaUrl(out) ? out : null;
}

// ------------------------------------------------------------------ others

const MEDIA = /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\\\s<>]*)?/gi;

/** Uqload (jwplayer in a packed script) and similar hosts: the first real video address. */
export function directSource(html) {
    for (const match of withUnpacked(html).replace(/\\\//g, "/").matchAll(MEDIA)) {
        if (isPlayableMediaUrl(match[0])) return match[0];
    }
    return null;
}

/** The video address of an embed page, whichever scheme its host uses. */
export function sourceOf(html, embedUrl) {
    const hostname = hostOf(embedUrl);
    const scripts = [String(html || "")].concat(unpackedScripts(html));
    for (const script of scripts) {
        if (/function\(s\)/.test(script)) {
            const decoded = decodeObfuscatedSource(script, hostname);
            if (decoded) return decoded;
        }
    }
    return directSource(html);
}
