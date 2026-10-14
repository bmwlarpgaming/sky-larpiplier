import { USER_AGENT, empty, parseJson, queryParams, qualityLabel, isHttp } from "../util.js";

const BASE = "https://www.rivestream.app";
/** Services listed last: their playlists only play in lenient players (Apogee's is malformed for iOS). */
const LAST = ["apogee"];
const KEY_WORKER = "https://rivestream.supe2372.workers.dev/";

/** The key list embedded in RiveStream's app bundle: `let c = ["…", …]`. */
export function keyList(js) {
    for (const match of String(js || "").matchAll(/let\s+c\s*=\s*(\[[^\]]*\])/g)) {
        const keys = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
        if (keys.length) return keys;
    }
    return [];
}

/**
 * A RiveStream source. Many go through a proxy (`…?url=<address>&headers=<json>`): the player
 * gets the real address and the headers instead, like StreamPlay does. The others still want a
 * Referer, any will do.
 */
export function toStream(source, service) {
    const raw = source && source.url;
    if (!raw) return null;
    const name = "RiveStream " + (source.source || service);
    const quality = qualityLabel(source.quality);
    const params = queryParams(raw);
    if (isHttp(params.url) && params.headers) {
        const headers = parseJson(params.headers) || {};
        const pick = key => headers[key] || headers[key.toLowerCase()];
        return {
            url: params.url,
            source: name,
            quality,
            headers: Object.fromEntries([["Referer", pick("Referer")], ["Origin", pick("Origin")]].filter(([, v]) => v))
        };
    }
    return { url: raw, source: name, quality, headers: { "Referer": BASE + "/", "Origin": BASE } };
}

/** RiveStream's secret key changes with its app: read the key list, then ask the key worker. */
async function secret(http, tmdb, cache) {
    if (!cache.keys) {
        const home = await http.get(BASE, { "User-Agent": USER_AGENT });
        const script = /src="([^"]*\/_app[^"]*\.js)"/.exec(home.body || "");
        if (!script) return null;
        const bundle = await http.get(BASE + script[1], { "User-Agent": USER_AGENT });
        cache.keys = keyList(bundle.body);
    }
    if (!cache.keys.length) return null;
    const res = await http.get(KEY_WORKER + "?input=" + tmdb + "&cList=" + cache.keys.join(","), {});
    const key = String(res.body || "").trim();
    return res.status === 200 && key && key.length < 100 ? key : null;
}

export default {
    id: "rivestream",
    name: "RiveStream",
    anime: false,
    async run(data, http, cache) {
        if (!data.tmdb) return empty();
        const headers = { "User-Agent": USER_AGENT };
        const [services, key] = await Promise.all([
            http.get(BASE + "/api/backendfetch?requestID=VideoProviderServices&secretKey=rive", headers)
                .then(res => (parseJson(res.body) || {}).data || []),
            secret(http, data.tmdb, cache.rivestream || (cache.rivestream = {}))
        ]);
        if (!key) return empty();
        const lists = await Promise.all(services.map(async service => {
            const url = data.type === "movie"
                ? BASE + "/api/backendfetch?requestID=movieVideoProvider&id=" + data.tmdb + "&service=" + service + "&secretKey=" + key
                : BASE + "/api/backendfetch?requestID=tvVideoProvider&id=" + data.tmdb + "&season=" + data.season +
                    "&episode=" + data.episode + "&service=" + service + "&secretKey=" + key;
            const res = await http.get(url, headers);
            const sources = ((parseJson(res.body) || {}).data || {}).sources || [];
            const streams = sources.map(source => toStream(source, service)).filter(Boolean);
            if (LAST.includes(service)) streams.forEach(stream => { stream.last = true; });
            return streams;
        }));
        return { streams: [].concat(...lists), subtitles: [] };
    }
};
