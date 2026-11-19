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

/** `value` (absolute, root-relative or relative) against the address of the page it is in. */
export function resolveUrl(base, value) {
    const v = String(value || "").trim();
    if (isHttp(v)) return v;
    if (v.startsWith("//")) return (/^(https?:)/i.exec(base) || ["", "https:"])[1] + v;
    if (v.startsWith("/")) return origin(base) + v;
    return String(base).replace(/[?#].*$/, "").replace(/[^/]*$/, "") + v;
}

/** The first address (a variant or a segment) listed by an HLS playlist, absolute. */
export function firstPlaylistEntry(playlist, base) {
    const line = String(playlist || "").split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith("#"));
    return line ? resolveUrl(base, line) : null;
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
    por: "Portuguese", pob: "Portuguese (Brazil)", spl: "Spanish (Latin America)", ru: "Russian", rus: "Russian",
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

/** Other spellings of the regional variants, as sources write them. */
const LANGUAGE_ALIASES = {
    "pt-br": "pob", "pt_br": "pob", "portuguese-br": "pob", "portuguese (brazil)": "pob", "brazilian": "pob",
    "es-419": "spl", "es-la": "spl", "es-mx": "spl", "spanish-latam": "spl", "spanish (latin america)": "spl", "latino": "spl"
};

/** BCP 47 codes of the regional variants; the others use their two-letter key. */
const REGIONAL_CODES = { "Portuguese (Brazil)": "pt-BR", "Spanish (Latin America)": "es-419" };

/** "eng", "en", "English", "portuguese-br" -> "English", "Portuguese (Brazil)". */
export function languageName(code) {
    const value = String(code || "").trim();
    const key = value.toLowerCase();
    const name = LANGUAGES[LANGUAGE_ALIASES[key] || key] ||
        Object.values(LANGUAGES).find(known => known.toLowerCase() === key);
    if (name) return name;
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unknown";
}

/** "eng", "English", "portuguese-br" -> "en", "en", "pt-BR"; "" when unknown. */
export function languageCode(value) {
    const name = languageName(value);
    if (REGIONAL_CODES[name]) return REGIONAL_CODES[name];
    return Object.keys(LANGUAGES).find(key => key.length === 2 && LANGUAGES[key] === name) || "";
}

/** `promise`, or `fallback` once `ms` have passed: one slow request must not hold back a whole source. */
export function withTimeout(promise, ms, fallback) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(fallback), ms);
        Promise.resolve(promise).then(
            value => { clearTimeout(timer); resolve(value); },
            () => { clearTimeout(timer); resolve(fallback); }
        );
    });
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
