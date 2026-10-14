// Helpers shared by the sources.
//
// Every source is `{ id, name, anime, run(data, http, cache) }`:
// - `data` is the title's link data (see meta.js `linkData`), with `season`/`episode` for a show;
// - `http.get(url, headers)` / `http.post(url, headers, body)` resolve to `{ status, body }` and
//   never throw (status 0 on network errors);
// - `cache` is an object kept between calls, for tokens and key lists;
// - `run` resolves to `{ streams: [{ url, source, quality, headers, dubbed?, last? }],
//   subtitles: [{ url, label, lang }] }` (`last`: list the stream after all the others).
// `anime` is true for anime-only sources, false for the rest; subtitle sources say `subtitles: true`.

export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export const empty = () => ({ streams: [], subtitles: [] });

export function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

export function decode(value) {
    try {
        return decodeURIComponent(value);
    } catch (_) {
        return value;
    }
}

/** Query parameters of a URL, decoded once. */
export function queryParams(url) {
    const out = {};
    const query = String(url || "").split("?").slice(1).join("?");
    for (const pair of query.split("&")) {
        if (!pair) continue;
        const i = pair.indexOf("=");
        out[decode(i < 0 ? pair : pair.slice(0, i))] = decode(i < 0 ? "" : pair.slice(i + 1));
    }
    return out;
}

/** "1080p", "4K HDR", "2160p", 720 -> a short quality label. */
export function qualityLabel(text) {
    const value = String(text || "");
    if (/2160|4k/i.test(value)) return /hdr/i.test(value) ? "4K HDR" : "4K";
    const match = /(\d{3,4})p?/i.exec(value);
    return match && parseInt(match[1], 10) >= 240 ? match[1] + "p" : "";
}

/** "https://a.b/c/d" -> "https://a.b". */
export function origin(url) {
    const match = /^(https?:\/\/[^/?#]+)/i.exec(String(url || ""));
    return match ? match[1] : "";
}

export function isHttp(url) {
    return /^https?:\/\//i.test(String(url || ""));
}

/** Lowercase letters and digits only, for comparing titles. */
export function simplify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const LANGUAGES = {
    en: "English", eng: "English", fr: "French", fre: "French", fra: "French", es: "Spanish", spa: "Spanish",
    spn: "Spanish", de: "German", ger: "German", deu: "German", it: "Italian", ita: "Italian", pt: "Portuguese",
    por: "Portuguese", pob: "Portuguese (Brazil)", "pt-br": "Portuguese (Brazil)", ru: "Russian", rus: "Russian",
    ar: "Arabic", ara: "Arabic", tr: "Turkish", tur: "Turkish", ja: "Japanese", jpn: "Japanese", ko: "Korean",
    kor: "Korean", zh: "Chinese", chi: "Chinese", zho: "Chinese", nl: "Dutch", dut: "Dutch", nld: "Dutch",
    pl: "Polish", pol: "Polish", sv: "Swedish", swe: "Swedish", no: "Norwegian", nor: "Norwegian", da: "Danish",
    dan: "Danish", fi: "Finnish", fin: "Finnish", el: "Greek", gre: "Greek", ell: "Greek", he: "Hebrew",
    heb: "Hebrew", hi: "Hindi", hin: "Hindi", id: "Indonesian", ind: "Indonesian", vi: "Vietnamese",
    vie: "Vietnamese", th: "Thai", tha: "Thai", cs: "Czech", cze: "Czech", ces: "Czech", hu: "Hungarian",
    hun: "Hungarian", ro: "Romanian", rum: "Romanian", ron: "Romanian", fa: "Persian", per: "Persian",
    fas: "Persian", uk: "Ukrainian", ukr: "Ukrainian", bg: "Bulgarian", bul: "Bulgarian", hr: "Croatian",
    hrv: "Croatian", ms: "Malay", may: "Malay", msa: "Malay"
};

/** "eng", "en", "English" -> "English". */
export function languageName(code) {
    const value = String(code || "").trim();
    return LANGUAGES[value.toLowerCase()] || value || "Unknown";
}

/** Runs `fn` on every item, at most `limit` at a time; failures give `undefined`. */
export async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = await fn(items[i], i);
            } catch (_) {
                results[i] = undefined;
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
