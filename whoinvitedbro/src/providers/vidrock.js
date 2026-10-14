import { USER_AGENT, empty, parseJson, isHttp, qualityLabel } from "../util.js";
import { aesGcmDecrypt, base64Bytes, hexBytes } from "../crypto.js";

const BASE = "https://vidrock.ru";
// Key of the player's link encryption (AES-GCM, IV in front), public in its script.
const KEY = hexBytes("7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f");

export function decryptLink(value) {
    try {
        const url = aesGcmDecrypt(KEY, base64Bytes(value));
        return isHttp(url) ? url : null;
    } catch (_) {
        return null;
    }
}

export default {
    id: "vidrock",
    name: "Vidrock",
    anime: false,
    async run(data, http) {
        if (!data.tmdb) return empty();
        const path = data.type === "movie" ? "movie/" + data.tmdb : "tv/" + data.tmdb + "/" + data.season + "/" + data.episode;
        const headers = { "User-Agent": USER_AGENT, "Origin": BASE, "Referer": BASE + "/" };
        const servers = parseJson((await http.get(BASE + "/api/" + path, headers)).body) || {};
        const streams = [];
        await Promise.all(Object.entries(servers).map(async ([server, info]) => {
            const url = info && info.url && decryptLink(info.url);
            if (!url) return;
            const lang = info.language && info.language !== "English" ? " " + info.language : "";
            if (url.includes("/playlist/")) {
                // A JSON list of files, one per resolution.
                const list = parseJson((await http.get(url, headers)).body) || [];
                for (const file of list) {
                    if (file && isHttp(file.url)) {
                        streams.push({ url: file.url, source: "Vidrock " + server + lang, quality: qualityLabel(file.resolution), headers: { "Origin": BASE, "Referer": BASE + "/" } });
                    }
                }
                return;
            }
            streams.push({ url, source: "Vidrock " + server + lang, quality: "", headers: { "Origin": BASE, "Referer": BASE + "/" } });
        }));
        return { streams, subtitles: [] };
    }
};
