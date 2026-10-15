// Video hosts shared by the plugins of this repository. Each resolver turns an embed page into
// video addresses; pages are passed in, so everything here is pure and testable with node.
import { unpackedScripts, withUnpacked } from "./packer.js";

/** Placeholders the site and its hosts hand out instead of the video (decoys for scrapers). */
export function isPlayableMediaUrl(url) {
    const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(String(url || ""));
    if (!match) return false;
    const host = match[1].toLowerCase();
    return !/(^|\.)(fstream\.top|test-videos\.co\.uk)$/.test(host) && !/\/troll\//i.test(match[2]);
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
    if (/lulu|livavid/.test(host)) return "Lulustream";
    if (/vidara/.test(host)) return "Vidara";
    const name = host.replace(/^www\./, "").split(".")[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "French-Stream";
}

// ------------------------------------------------------------- Fsvid, Vidzy

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 to a binary string; does not rely on the runtime having atob. */
export function base64Decode(input) {
    const clean = String(input || "").replace(/[^A-Za-z0-9+/]/g, "");
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const ch of clean) {
        buffer = (buffer << 6) | B64.indexOf(ch);
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
    const reversed = base64Decode(encoded[1]).split("").reverse().join("");
    let out = "";
    for (let i = 0; i < reversed.length; i++) {
        out += String.fromCharCode(reversed.charCodeAt(i) ^ ((base + i * step + hash + measured) & 255));
    }
    return /^https?:\/\//.test(out) && isPlayableMediaUrl(out) ? out : null;
}

// --------------------------------------------------------------------- Voe

function rot13(value) {
    return value.replace(/[a-z]/gi, c => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
}

/**
 * Voe hides its sources in a JSON string: rot13, junk markers, base64,
 * every character shifted by 3, reversed, then base64 again.
 */
export function voeSources(html) {
    const script = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/i.exec(html || "");
    if (!script) return null;
    try {
        const parsed = JSON.parse(script[1].trim());
        let s = rot13(Array.isArray(parsed) ? String(parsed[0]) : String(parsed));
        for (const junk of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) s = s.split(junk).join("");
        s = base64Decode(s);
        s = Array.from(s, c => String.fromCharCode(c.charCodeAt(0) - 3)).reverse().join("");
        const data = JSON.parse(base64Decode(s));
        const out = [];
        if (data.source) out.push(data.source);
        if (data.direct_access_url) out.push(data.direct_access_url);
        return out.length ? out : null;
    } catch (_) {
        return null;
    }
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
    // Voe pages also carry a sample video for scrapers: its own sources come first.
    const voe = voeSources(html);
    return voe ? voe[0] : directSource(html);
}

/** Where a "Redirecting..." page (Voe's mirrors) sends the browser, or null. */
export function scriptRedirect(html) {
    const match = /location\.(?:href\s*=|replace\()\s*['"](https?:\/\/[^'"]+)['"]/.exec(String(html || ""));
    return match ? match[1] : null;
}

/** Vidara and its mirrors load the video with a POST to `/api/stream` carrying the embed's code. */
export function isVidaraPage(html) {
    return /aboutlink\s*:\s*"https:\/\/vidara\./.test(String(html || "")) && /\/api\/stream/.test(html);
}

export function vidaraRequest(embedUrl) {
    const match = /^(https?:\/\/[^/?#]+)\/e\/([A-Za-z0-9]+)/.exec(String(embedUrl || ""));
    return match ? { url: match[1] + "/api/stream", body: JSON.stringify({ filecode: match[2], device: "web", codecs: [] }) } : null;
}
