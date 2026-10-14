import { sha256 } from "@noble/hashes/sha2.js";
import { USER_AGENT, empty, parseJson, isHttp, qualityLabel, simplify, languageName } from "../util.js";
import { base64Bytes, utf8Bytes, utf8Text } from "../crypto.js";

const BASE = "https://bingebang.st";
const SECRET = "9e2b7c41a0f6d85b3c1e7a94f25d0b86";

/**
 * The player's answers: base64url(nonce[16] + data), data XORed with a keystream of
 * sha256(key + nonce + counter) blocks, key = sha256(SECRET + ticket).
 */
export function decrypt(enc, ticket) {
    const key = sha256(utf8Bytes(SECRET + ticket));
    const bytes = base64Bytes(enc);
    if (bytes.length <= 16) return null;
    const nonce = bytes.subarray(0, 16);
    const data = bytes.subarray(16);
    const out = new Uint8Array(data.length);
    for (let offset = 0, counter = 0; offset < data.length; counter++) {
        const block = new Uint8Array(key.length + nonce.length + 4);
        block.set(key, 0);
        block.set(nonce, key.length);
        block.set([counter >>> 24 & 255, counter >>> 16 & 255, counter >>> 8 & 255, counter & 255], key.length + nonce.length);
        const stream = sha256(block);
        const length = Math.min(32, data.length - offset);
        for (let i = 0; i < length; i++) out[offset + i] = data[offset + i] ^ stream[i];
        offset += length;
    }
    return parseJson(utf8Text(out));
}

/** The player page's settings: `var k=[…],d=[…]` is `d` XORed with `k`. */
export function playerConfig(html) {
    const match = /var k=\[([\d,]+)\],d=\[([\d,]+)\]/.exec(String(html || ""));
    if (!match) return null;
    const k = match[1].split(",").filter(Boolean).map(Number);
    const d = match[2].split(",").filter(Boolean).map(Number);
    const text = utf8Text(Uint8Array.from(d, (b, i) => b ^ k[i % k.length]));
    const ticket = /ticket:\s*"([^"]+)"/.exec(text);
    const imdb = /imdb:\s*"([^"]+)"/.exec(text);
    return ticket ? { ticket: ticket[1], imdb: imdb ? imdb[1] : null } : null;
}

/** Search results for a title: same name, closest year first. */
export function candidates(results, data) {
    const title = simplify(data.title);
    return (results || [])
        .filter(r => r && r.play_url && [r.title, r.name, r.original_title, r.original_name].some(t => simplify(t) === title))
        .sort((a, b) => Math.abs((a.year || 0) - (data.year || 0)) - Math.abs((b.year || 0) - (data.year || 0)));
}

export default {
    id: "bingebang",
    name: "BingeBang",
    anime: false,
    async run(data, http) {
        if (!data.title) return empty();
        const headers = { "User-Agent": USER_AGENT, "Referer": BASE + "/", "Origin": BASE };
        const kind = data.type === "movie" ? "movie" : "tv";
        const search = parseJson((await http.get(BASE + "/api/search/" + kind + "?query=" + encodeURIComponent(data.title) + "&page=1", headers)).body) || {};

        // Several titles can share a name: the one whose player page has the same IMDb id.
        for (const result of candidates(search.results, data).slice(0, 3)) {
            const page = result.play_url + (kind === "movie" ? "" : "/" + data.season + "/" + data.episode);
            const config = playerConfig((await http.get(BASE + page, headers)).body);
            if (!config || (data.imdb && config.imdb && config.imdb !== data.imdb)) continue;

            const api = Object.assign({}, headers, { "X-BB-Player": "1", "X-BB-Ticket": config.ticket, "Referer": BASE + page });
            const list = decrypt((parseJson((await http.get(BASE + "/api/player/sources", api)).body) || {}).enc || "", config.ticket);
            const servers = (list && list.servers) || [];
            const streams = [];
            const subtitles = [];
            await Promise.all(servers.map(async server => {
                const src = server.source_url || server.sourceUrl;
                if (!src) return;
                const resolved = decrypt((parseJson((await http.get(BASE + "/api/player/resolve?src=" + encodeURIComponent(src), api)).body) || {}).enc || "", config.ticket);
                if (!resolved || !isHttp(resolved.url)) return;
                streams.push({
                    url: resolved.url,
                    source: "BingeBang " + (server.label || "Server"),
                    quality: qualityLabel(/4k|2160/i.test(server.quality || "") ? "4K" : /full hd|1080/i.test(server.quality || "") ? "1080p" : server.quality),
                    headers: { "Referer": BASE + "/", "Origin": BASE }
                });
                for (const sub of resolved.subtitles || []) {
                    if (sub && isHttp(sub.url)) subtitles.push({ url: sub.url, label: languageName(sub.label || sub.lang), lang: sub.lang || "" });
                }
            }));
            if (streams.length) return { streams, subtitles };
        }
        return empty();
    }
};
