// Pure parsing helpers for voir-anime.to (WordPress "Madara" theme).
// No DOM: the SkyStream JS engine only offers a limited HTML API, and the site
// markup is regular enough for targeted regular expressions.

export const CATEGORIES = [
    { path: "/", label: "Derniers épisodes" },
    { path: "/?filter=dubbed", label: "Derniers épisodes VF" },
    { path: "/nouveaux-ajouts/", label: "Nouveaux ajouts" },
    { path: "/anime-genre/action/", label: "Action" },
    { path: "/anime-genre/adventure/", label: "Aventure" },
    { path: "/anime-genre/comedy/", label: "Comédie" },
    { path: "/anime-genre/drama/", label: "Drame" },
    { path: "/anime-genre/fantasy/", label: "Fantasy" },
    { path: "/anime-genre/romance/", label: "Romance" },
    { path: "/anime-genre/sci-fi/", label: "Science-fiction" },
    { path: "/anime-genre/slice-of-life/", label: "Tranche de vie" },
    { path: "/anime-genre/supernatural/", label: "Surnaturel" },
    { path: "/anime-genre/sports/", label: "Sport" }
];

// Sorting by views puts the main series before its spin-offs and films.
export const POPULAR_PATH = "/?s=&post_type=wp-manga&m_orderby=views";

export const KIND = { SERIES: "series", MOVIE: "movie", OVA: "ova", UNKNOWN: "unknown" };

const DUB_SUFFIX = /\s*\(VF\)\s*$/i;
const THUMB_SIZE = /-\d+x\d+(\.[a-z0-9]+)(\?.*)?$/i;
const YEAR = /\b(19|20)\d{2}\b/;
const MEDIA = /https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi;

const NAMED_ENTITIES = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
        if (code[0] === "#") {
            const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : match;
        }
        const named = NAMED_ENTITIES[code.toLowerCase()];
        return named === undefined ? match : named;
    });
}

export function textOf(html) {
    return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function attr(tag, name) {
    const match = new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag || "");
    return match ? decodeEntities(match[2]).trim() : "";
}

export function isHttpUrl(value) {
    return /^https?:\/\//i.test(value || "");
}

export function originOf(url) {
    const match = /^(https?:\/\/[^/?#]+)/i.exec(url || "");
    return match ? match[1] : "";
}

export function pathOf(url) {
    const match = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(url || "");
    return match ? match[1] || "/" : String(url || "").split(/[?#]/)[0];
}

export function resolveUrl(base, value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (isHttpUrl(v)) return v;
    if (v.startsWith("//")) return "https:" + v;
    if (v.startsWith("/")) return originOf(base) + v;
    return "";
}

export function normalize(value) {
    let s = String(value || "");
    try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (_) {
        // Engines without Unicode normalization: keep accents.
    }
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** WordPress slug of a title, e.g. "Naruto: Shippuuden" -> "naruto-shippuuden". */
export function slug(value) {
    return normalize(value).replace(/ /g, "-");
}

export function isDubTitle(title) {
    return DUB_SUFFIX.test(title || "");
}

export function baseTitle(title) {
    return String(title || "").replace(DUB_SUFFIX, "").trim();
}

export function sameAnime(left, right) {
    return normalize(baseTitle(left)) === normalize(baseTitle(right));
}

export function isAnimeUrl(url) {
    return isHttpUrl(url) && /^\/anime\/[^/]+\/?$/.test(pathOf(url));
}

function isDubUrl(url) {
    return /-vf$/.test(String(url || "").split("?")[0].replace(/\/+$/, ""));
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Value of a "summary-heading / summary-content" pair, e.g. "Type" -> "TV". */
export function summaryValue(html, heading) {
    const re = new RegExp(
        "<div class=\"summary-heading\">\\s*<h5>\\s*" + escapeRegex(heading) +
        "\\s*</h5>\\s*</div>\\s*<div class=\"summary-content[^\"]*\"[^>]*>([\\s\\S]*?)</div>",
        "i"
    );
    const match = re.exec(html || "");
    if (!match) return null;
    const value = textOf(match[1]).replace(/,\s*$/, "").trim();
    return value || null;
}

export function kindOf(type) {
    const value = String(type || "").trim().toUpperCase();
    if (!value) return KIND.UNKNOWN;
    if (value.includes("MOVIE") || value.includes("FILM")) return KIND.MOVIE;
    if (value.includes("OVA") || value.includes("OAV") || value.includes("SPECIAL")) return KIND.OVA;
    if (value.includes("TV") || value.includes("ONA")) return KIND.SERIES;
    return KIND.UNKNOWN;
}

/** Picks the largest image, then strips the WordPress thumbnail suffix to get the original. */
export function posterFromImg(imgTag, base) {
    if (!imgTag) return "";
    let best = "";
    let bestWidth = -1;
    for (const name of ["srcset", "data-srcset"]) {
        for (const entry of attr(imgTag, name).split(",")) {
            const parts = entry.trim().split(/\s+/);
            const src = resolveUrl(base, parts[0]);
            const width = parseInt((parts[1] || "").replace(/w$/, ""), 10) || 0;
            if (src && width > bestWidth) {
                best = src;
                bestWidth = width;
            }
        }
    }
    const raw = best || resolveUrl(base, attr(imgTag, "data-src")) || resolveUrl(base, attr(imgTag, "src"));
    return raw ? raw.replace(THUMB_SIZE, "$1$2") : "";
}

/** Splits a page into the blocks starting at each match of `startRe`. */
function blocks(html, startRe) {
    const starts = [];
    const re = new RegExp(startRe.source, "gi");
    let m;
    while ((m = re.exec(html)) !== null) starts.push(m.index);
    return starts.map((start, i) => html.slice(start, i + 1 < starts.length ? starts[i + 1] : start + 12000));
}

/** Parses both the listing grid and the search result layout. */
export function cards(html, base) {
    const seen = new Set();
    const out = [];
    for (const block of blocks(html || "", /class="(?:page-item-detail|row c-tabs-item__content)/)) {
        const titleMatch = /class="post-title[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const thumbMatch = /<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"/i.exec(block);
        const url = resolveUrl(base, decodeEntities((titleMatch || thumbMatch || [])[1] || ""));
        if (!isAnimeUrl(url) || seen.has(url)) continue;
        const rawTitle = titleMatch ? textOf(titleMatch[2]) : decodeEntities(thumbMatch[2]).trim();
        if (!rawTitle) continue;
        seen.add(url);
        const imgMatch = /<img\b[^>]*>/i.exec(block);
        const releaseMatch = /mg_release[\s\S]*?<div class="summary-content[^"]*">([\s\S]*?)<\/div>/i.exec(block);
        const yearMatch = releaseMatch ? YEAR.exec(textOf(releaseMatch[1])) : null;
        out.push({
            title: baseTitle(rawTitle),
            url,
            posterUrl: posterFromImg(imgMatch && imgMatch[0], base),
            isDub: isDubTitle(rawTitle) || isDubUrl(url) || block.includes("manga-vf-flag"),
            kind: kindOf(summaryValue(block, "Type")),
            year: yearMatch ? parseInt(yearMatch[0], 10) : null
        });
    }
    return out;
}

/** Merges the VF and VOSTFR entries of a same anime, keeping the catalog order. */
export function groupCards(list) {
    const groups = new Map();
    for (const card of list) {
        const key = normalize(card.title);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
    }
    return Array.from(groups.values()).map(items => {
        const main = items.find(c => !c.isDub) || items[0];
        const known = items.find(c => c.kind !== KIND.UNKNOWN);
        const withYear = items.find(c => c.year);
        return {
            title: main.title,
            url: main.url,
            posterUrl: main.posterUrl || (items.find(c => c.posterUrl) || {}).posterUrl || "",
            kind: known ? known.kind : KIND.UNKNOWN,
            year: withYear ? withYear.year : null,
            hasSub: items.some(c => !c.isDub),
            hasDub: items.some(c => c.isDub)
        };
    });
}

/**
 * Puts exact title matches first, then titles starting with the query, then whole-word matches.
 * The site only sorts by views or date, so a short exact title like "Air" would be buried.
 * Array.prototype.sort is stable, so the site order is kept inside each group.
 */
export function rankByQuery(list, query) {
    const needle = normalize(query);
    if (!needle) return list;
    const score = card => {
        const title = normalize(card.title);
        if (title === needle) return 0;
        if (title.startsWith(needle + " ")) return 1;
        if ((" " + title + " ").includes(" " + needle + " ")) return 2;
        if (title.includes(needle)) return 3;
        return 4;
    };
    return list.map((card, index) => ({ card, index, s: score(card) }))
        .sort((a, b) => a.s - b.s || a.index - b.index)
        .map(entry => entry.card);
}

/** Highest page number linked from a paginated listing, 1 when there is no pagination. */
export function lastPage(html) {
    let max = 1;
    const re = /href="[^"]*\/page\/(\d+)\//g;
    let m;
    while ((m = re.exec(html || "")) !== null) max = Math.max(max, parseInt(m[1], 10));
    return max;
}

/** Episodes in ascending order; the site lists them newest first. */
export function episodes(html, base) {
    const seen = new Set();
    const out = [];
    const re = /<li class="wp-manga-chapter[^"]*">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        const url = resolveUrl(base, decodeEntities(m[1]));
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const label = textOf(m[2]);
        const sep = label.lastIndexOf(" - ");
        const suffix = sep >= 0 ? label.slice(sep + 3).trim() : "";
        const numberMatch = /^0*(\d+)/.exec(suffix);
        out.push({
            url,
            label,
            number: numberMatch ? parseInt(numberMatch[1], 10) : null,
            name: !suffix ? (label || null) : (/^\d+$/.test(suffix) ? null : suffix)
        });
    }
    return out.reverse();
}

export function detail(html, requestedUrl) {
    const page = html || "";
    if (!page.includes("profile-manga")) return null;
    const titleMatch = /<div class="post-title">\s*<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page);
    const rawTitle = titleMatch ? textOf(titleMatch[1]) : "";
    if (!rawTitle) return null;
    const canonicalMatch = /<link rel="canonical" href="([^"]+)"/i.exec(page);
    const canonical = canonicalMatch ? decodeEntities(canonicalMatch[1]) : "";
    const url = isAnimeUrl(canonical) ? canonical : requestedUrl;
    const ogImage = /<meta property="og:image" content="([^"]+)"/i.exec(page);
    const summaryImg = /class="summary_image"[\s\S]*?(<img\b[^>]*>)/i.exec(page);
    const status = summaryValue(page, "Status");
    const genresMatch = /<div class="genres-content">([\s\S]*?)<\/div>/i.exec(page);
    const genres = genresMatch
        ? Array.from(genresMatch[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)).map(g => textOf(g[1])).filter(Boolean)
        : [];
    const plotMatch = /<div class="summary__content[^"]*">([\s\S]*?)<\/div>/i.exec(page);
    let plot = null;
    if (plotMatch) {
        const paragraphs = plotMatch[1].split(/<\/p>/i).map(textOf).filter(Boolean);
        plot = paragraphs.join("\n\n") || null;
    }
    const trailerMatch = /youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/i.exec(page);
    const yearSource = summaryValue(page, "Start date") || summaryValue(page, "Année") || "";
    const yearMatch = YEAR.exec(yearSource);
    let ongoing = null;
    if (status) {
        if (/cours|ongoing/i.test(status)) ongoing = true;
        else if (/termin|complet/i.test(status)) ongoing = false;
    }
    const synonyms = [];
    for (const heading of ["Native", "Romaji", "Alternative"]) {
        for (const name of (summaryValue(page, heading) || "").split(",")) {
            const trimmed = name.trim();
            if (trimmed && !synonyms.includes(trimmed)) synonyms.push(trimmed);
        }
    }
    return {
        title: baseTitle(rawTitle),
        url,
        isDub: isDubTitle(rawTitle) || isDubUrl(url),
        kind: kindOf(summaryValue(page, "Type")),
        posterUrl: (ogImage && isHttpUrl(ogImage[1]) ? decodeEntities(ogImage[1]) : "") ||
            posterFromImg(summaryImg && summaryImg[1], url),
        plot,
        genres: Array.from(new Set(genres)),
        year: yearMatch ? parseInt(yearMatch[0], 10) : null,
        ongoing,
        trailerUrl: trailerMatch ? "https://www.youtube.com/watch?v=" + trailerMatch[1] : null,
        synonyms,
        episodes: episodes(page, url)
    };
}

/** Guesses the URL of the other language version, e.g. `/anime/x/` <-> `/anime/x-vf/`. */
export function counterpartUrl(url, isDub) {
    const clean = String(url || "").split("?")[0].replace(/\/+$/, "");
    if (!isAnimeUrl(clean + "/")) return null;
    if (isDub) return /-vf$/.test(clean) ? clean.slice(0, -3) + "/" : null;
    return clean + "-vf/";
}

/** Players of an episode page, in the site's order. */
export function sources(html) {
    const page = html || "";
    const out = [];
    const seen = new Set();
    const add = (label, src) => {
        const url = resolveUrl("https://voir-anime.to/", decodeEntities(src));
        if (!isHttpUrl(url) || seen.has(url)) return;
        seen.add(url);
        out.push({ label, url });
    };
    const scriptMatch = /thisChapterSources\s*=\s*(\{[\s\S]*?\})\s*;/.exec(page);
    if (scriptMatch) {
        try {
            const map = JSON.parse(scriptMatch[1]);
            for (const key of Object.keys(map)) {
                const srcMatch = /<iframe[^>]+src\s*=\s*["']([^"']+)/i.exec(String(map[key]));
                if (srcMatch) add(key.replace(/^LECTEUR/i, "").trim() || key, srcMatch[1]);
            }
        } catch (_) {
            // Fall through to the visible player.
        }
    }
    if (out.length === 0) {
        const frame = /class="chapter-video-frame"[\s\S]*?<iframe[^>]+src\s*=\s*["']([^"']+)/i.exec(page);
        if (frame) add("Lecteur", frame[1]);
    }
    return out;
}

const PACKER_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Decodes Dean Edwards' P.A.C.K.E.R. obfuscation (`eval(function(p,a,c,k,e,d)...`). */
export function unpackPacker(source) {
    const match = /\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/.exec(source || "");
    if (!match) return null;
    const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const radix = parseInt(match[2], 10);
    const words = match[4].split("|");
    const decode = word => {
        if (radix <= 36) return parseInt(word, radix);
        let n = 0;
        for (const ch of word) {
            const v = PACKER_ALPHABET.indexOf(ch);
            if (v < 0) return NaN;
            n = n * radix + v;
        }
        return n;
    };
    return payload.replace(/\b\w+\b/g, word => {
        const index = decode(word);
        return Number.isFinite(index) && index < words.length && words[index] ? words[index] : word;
    });
}

/** Direct media URLs found in a player page, including inside packed scripts. */
export function extractMediaUrls(html) {
    const page = html || "";
    const candidates = [page];
    const packedRe = /eval\(function\(p,a,c,k,e,[dr]\)[\s\S]*?\.split\('\|'\)[^)]*\)\)?/g;
    let m;
    while ((m = packedRe.exec(page)) !== null) {
        const unpacked = unpackPacker(m[0]);
        if (unpacked) candidates.push(unpacked);
    }
    const out = [];
    for (const content of candidates) {
        for (const found of content.replace(/\\\//g, "/").matchAll(MEDIA)) {
            const url = found[0].replace(/&amp;/g, "&");
            if (!out.includes(url)) out.push(url);
        }
    }
    return out;
}

/**
 * Checks a stream link. Returns "m3u8" or "video", or null when the link cannot play.
 * Hosts sometimes label plain .mp4 files as HLS, which makes players fail with
 * a malformed manifest error; YourUpload returns "/embed/novideo.mp4" for removed videos.
 */
export function checkedLinkType(url, declared) {
    if (!isHttpUrl(url) || /novideo/i.test(url)) return null;
    const path = pathOf(url);
    if (/\.m3u8$/i.test(path)) return "m3u8";
    if (/\.(mp4|mkv|webm)$/i.test(path)) return "video";
    return declared || null;
}

export function highestHlsQuality(manifest) {
    let max = 0;
    for (const m of String(manifest || "").matchAll(/RESOLUTION\s*=\s*\d+x(\d+)/gi)) {
        max = Math.max(max, parseInt(m[1], 10));
    }
    return max || null;
}

export function qualityFromUrl(url) {
    const match = /(?:^|[^0-9])(2160|1080|720|480|360)p?(?:[^0-9]|$)/.exec(url || "");
    return match ? parseInt(match[1], 10) : null;
}

/** Streamtape builds its URL from string pieces: `'//a' + ('xyz/b').substring(2)`. */
export function streamtapeUrl(html) {
    const line = /getElementById\(\s*'(?:robotlink|ideoooolink)'\s*\)\.innerHTML\s*=\s*([^;\n]+)/.exec(html || "");
    if (!line) return null;
    let result = "";
    for (const piece of line[1].split("+")) {
        const str = /'([^']*)'/.exec(piece);
        if (!str) continue;
        let value = str[1];
        for (const sub of piece.matchAll(/\.substring\((\d+)\)/g)) value = value.substring(parseInt(sub[1], 10));
        result += value;
    }
    if (!result) return null;
    const url = (result.startsWith("//") ? "https:" + result : result) + "&stream=1";
    return isHttpUrl(url) ? url : null;
}

/**
 * Title used to look up artwork. Language/version tags like "(JAP)" do not exist on AniList,
 * and AniList finds "Season 4" but not the site's "S4".
 */
export function coverLookupTitle(title) {
    return baseTitle(title)
        .replace(/\s*\((?:JAP|CN|KR|VOSTFR)\)\s*$/i, "")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\bS(\d+)$/i, "Season $1")
        .trim();
}

/** Franchise name used when the full title is not found, e.g. "Mononoke The Movie: Chapter III" -> "Mononoke The Movie". */
export function coverFallbackTitle(title) {
    const short = coverLookupTitle(title).split(/\s*(?::|\s[\u2013\u2014-]\s)\s*/)[0].trim();
    return short && short !== coverLookupTitle(title) && short.length >= 3 ? short : null;
}

/**
 * One AniList GraphQL query looking up several titles at once.
 * `Page { media }` is used instead of `Media`: a title that is not found gives
 * an empty list, while a missing `Media` fails the whole query.
 */
export function anilistQuery(titles) {
    const parts = titles.map((title, i) =>
        "a" + i + ": Page(perPage: 1) { media(search: " + JSON.stringify(title) +
        ", type: ANIME) { coverImage { extraLarge large } bannerImage } }"
    );
    return "query { " + parts.join(" ") + " }";
}

/** Artwork per title of an [anilistQuery] response, or null when the response is unusable. */
export function anilistResults(body, count) {
    let data;
    try {
        data = JSON.parse(body).data;
    } catch (_) {
        return null;
    }
    if (!data) return null;
    const out = [];
    for (let i = 0; i < count; i++) {
        const page = data["a" + i];
        const media = page && page.media && page.media[0];
        const cover = media && media.coverImage && (media.coverImage.extraLarge || media.coverImage.large);
        out.push(cover ? { cover, banner: media.bannerImage || null } : null);
    }
    return out;
}

/** Mail.ru metadata endpoint for an embed URL, e.g. `.../video/embed/123` -> id `123`. */
export function mailRuId(url) {
    const match = /video\/embed\/(\d+)/.exec(url || "");
    return match ? match[1] : null;
}

export function cookieValue(setCookie, name) {
    const list = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
    for (const cookie of list) {
        const match = new RegExp("(?:^|[;,\\s])" + name + "=([^;,\\s]+)").exec(String(cookie));
        if (match) return match[1];
    }
    return null;
}
