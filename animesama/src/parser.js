// Pure HTML/JS parsing for anime-sama: no DOM, no network, testable with node.

export const LANGUAGES = [
    { path: "vostfr", label: "VOSTFR", dubStatus: "subbed" },
    { path: "vf", label: "VF", dubStatus: "dubbed" }
];

/** Home rows read from the container of the same id, in display order. */
export const HOME_SECTIONS = [
    { id: "containerAjoutsAnimes", label: "Derniers épisodes ajoutés", kind: "episodes" },
    { id: "containerSorties", label: "Derniers contenus sortis", kind: "catalog" },
    { id: "containerClassiques", label: "Les classiques", kind: "catalog" },
    { id: "containerPepites", label: "Découvrez des pépites", kind: "catalog" }
];

export const WEEK_DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

const NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…",
    eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
    ocirc: "ô", ucirc: "û", icirc: "î", iuml: "ï", euml: "ë", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", ndash: "–", mdash: "—"
};

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

export function normalize(value) {
    let s = String(value || "");
    try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (_) {
        // Engines without Unicode normalization: keep accents.
    }
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function originOf(url) {
    const match = /^(https?:\/\/[^/?#]+)/i.exec(url || "");
    return match ? match[1] : "";
}

export function hostOf(url) {
    return originOf(url).replace(/^https?:\/\//i, "").toLowerCase();
}

export function resolveUrl(base, value) {
    const v = decodeEntities(String(value || "").trim());
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith("//")) return "https:" + v;
    if (v.startsWith("/")) return originOf(base) + v;
    return base.replace(/[^/]*$/, "") + v;
}

/** Text of the first element whose opening tag matches `openTag`, up to its closing tag. */
function firstInner(html, openTag, closeTag) {
    const match = new RegExp(openTag + "([\\s\\S]*?)" + closeTag, "i").exec(html);
    return match ? match[1] : "";
}

function allInner(html, openTag, closeTag) {
    return [...html.matchAll(new RegExp(openTag + "([\\s\\S]*?)" + closeTag, "gi"))].map(m => m[1]);
}

/** Splits `html` into the blocks that start at each match of `marker`. */
function blocks(html, marker) {
    const starts = [...html.matchAll(marker)].map(m => m.index);
    return starts.map((start, i) => html.slice(start, i + 1 < starts.length ? starts[i + 1] : undefined));
}

// ------------------------------------------------------------------ urls

/** "one-piece" from any catalogue URL, absolute or relative. */
export function slugOf(url) {
    const match = /\/catalogue\/([^/?#]+)/i.exec(url || "");
    return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

export function seriesUrl(base, slug) {
    return base + "/catalogue/" + slug + "/";
}

/** The 16:9 artwork sits next to the thumbnail: contenu/thumb/x.webp -> contenu/x.jpg. */
export function bannerFromThumb(thumb) {
    if (!/\/contenu\/thumb\//.test(thumb || "")) return "";
    return thumb.replace("/contenu/thumb/", "/contenu/").replace(/\.webp(\?.*)?$/i, ".jpg");
}

export function isWatchable(types) {
    return types.length === 0 || types.some(type => /anime|film/i.test(type));
}

// ----------------------------------------------------------------- cards

/** Catalogue cards: catalogue pages, search and most home rows. */
export function catalogCards(html, base) {
    const out = [];
    for (const block of blocks(html || "", /<div class="[^"]*\bcatalog-card\b[^"]*">/g)) {
        const href = /<a[^>]+href="([^"]+)"/i.exec(block);
        const slug = href ? slugOf(href[1]) : "";
        if (!slug) continue;
        const img = /<img[^>]+src="([^"]+)"/i.exec(block);
        const typesRow = /Types[\s\S]*?<p class="info-value">([^<]*)<\/p>/i.exec(block);
        const types = typesRow ? decodeEntities(typesRow[1]).split(",").map(s => s.trim()).filter(Boolean) : [];
        out.push({
            slug,
            url: seriesUrl(base, slug),
            title: textOf(firstInner(block, "<h2[^>]*card-title[^>]*>", "</h2>")),
            altTitles: splitTitles(textOf(firstInner(block, "<p[^>]*alternate-titles[^>]*>", "</p>"))),
            thumb: img ? resolveUrl(base + "/", img[1]) : "",
            genres: allInner(block, "<span[^>]*genre-tag[^>]*>", "</span>").map(textOf).filter(Boolean),
            types
        });
    }
    return out;
}

/** Episode cards of the "latest episodes" and planning rows. */
export function episodeCards(html, base) {
    const out = [];
    for (const block of blocks(html || "", /<div class="[^"]*\banime-card-premium\b[^"]*">/g)) {
        const href = /<a[^>]+href="([^"]+)"/i.exec(block);
        const slug = href ? slugOf(href[1]) : "";
        if (!slug) continue;
        const img = /<img[^>]+class="[^"]*card-image[^"]*"[^>]*src="([^"]+)"|<img[^>]+src="([^"]+)"[^>]*class="[^"]*card-image/i.exec(block);
        const flag = /<img[^>]+class="flag-icon"[^>]*alt="([^"]*)"|<img[^>]+alt="([^"]*)"[^>]*title="(?:VF|VOSTFR|VA|VCN|VKR|VJ|VQC|VAR)"/i.exec(block);
        const badge = textOf(firstInner(block, "<span class=\"badge-text\">", "</span>"));
        out.push({
            slug,
            url: seriesUrl(base, slug),
            title: textOf(firstInner(block, "<h2[^>]*card-title[^>]*>", "</h2>")),
            altTitles: [],
            thumb: img ? resolveUrl(base + "/", img[1] || img[2]) : "",
            genres: [],
            types: badge ? [badge] : [],
            language: flag ? (flag[1] || flag[2] || "") : "",
            info: textOf(firstInner(block, "<div class=\"info-item episode\">", "</div>"))
        });
    }
    return out;
}

/** Slides of the home carousel, without the clones added for the infinite loop. */
export function carouselSlides(html, base) {
    const out = [];
    for (const block of blocks(html || "", /<div class="ak-slide"[^>]*>/g)) {
        if (/^<div class="ak-slide" aria-hidden="true"/.test(block)) continue;
        const href = /<a[^>]+href="([^"]+)"[^>]*class="ak-slide-cta"/i.exec(block);
        const slug = href ? slugOf(href[1]) : "";
        if (!slug) continue;
        const img = /<div class="ak-slide-bg">\s*<img[^>]+src="([^"]+)"/i.exec(block);
        out.push({
            slug,
            url: seriesUrl(base, slug),
            title: textOf(firstInner(block, "<h2[^>]*ak-slide-title[^>]*>", "</h2>")),
            altTitles: [],
            banner: img ? resolveUrl(base + "/", img[1]) : "",
            thumb: "",
            synopsis: textOf(firstInner(block, "<p[^>]*ak-slide-synopsis[^>]*>", "</p>")),
            genres: allInner(block, "<span[^>]*ak-genre-tag[^>]*>", "</span>").map(textOf).filter(Boolean),
            types: []
        });
    }
    return out;
}

/** HTML of one home row: from its container to the next one. */
export function section(html, id) {
    const page = html || "";
    const start = page.indexOf("id=\"" + id + "\"");
    if (start < 0) return "";
    const next = page.indexOf("id=\"container", start + id.length + 5);
    return page.slice(start, next < 0 ? undefined : next);
}

/** Id of the planning row for `date`, e.g. "containerVendredi". */
export function planningId(date) {
    return "container" + WEEK_DAYS[date.getDay()];
}

/** Keeps the first card of each series and drops scans. */
export function uniqueWatchable(list) {
    const seen = new Set();
    return list.filter(card => {
        if (seen.has(card.slug) || !isWatchable(card.types)) return false;
        seen.add(card.slug);
        return true;
    });
}

export function splitTitles(value) {
    return String(value || "").split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
}

/** Exact title matches first, then titles starting with the query, then the site's order. */
export function rankByQuery(list, query) {
    const q = normalize(query);
    const score = card => {
        const names = [card.title].concat(card.altTitles || []).map(normalize);
        if (names.includes(q)) return 0;
        if (names.some(n => n.startsWith(q + " ") || n.startsWith(q))) return 1;
        return 2;
    };
    return list.map((card, i) => ({ card, i, s: score(card) }))
        .sort((a, b) => a.s - b.s || a.i - b.i)
        .map(x => x.card);
}

// ---------------------------------------------------------------- detail

/** Drops HTML and block comments, plus lines commented out with "//". */
export function stripComments(source) {
    return String(source || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Season panels declared with panneauAnime("name", "saison1/vostfr").
 * "saisonN" folders keep N as season number, so seasons the site left empty do not shift
 * the others; films, OAVs and specials come after them, in page order.
 */
export function seasons(html) {
    const panels = [];
    const seen = new Set();
    // Inside a script, "<!--" comments out the rest of the line: the site hides seasons that way.
    for (const m of stripComments(html).matchAll(/panneauAnime\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g)) {
        const name = decodeEntities(m[1]).trim();
        const path = m[2].trim().replace(/^\/+|\/+$/g, "");
        const folder = path.split("/")[0];
        if (!folder || name === "nom" || seen.has(folder)) continue;
        seen.add(folder);
        const numbered = /^saison(\d+)$/i.exec(folder);
        panels.push({ name, folder, number: numbered ? parseInt(numbered[1], 10) : 0 });
    }
    let extra = panels.reduce((max, panel) => Math.max(max, panel.number), 0);
    let previousEnd = 0;
    return panels.map(panel => {
        const range = episodeRange(panel.name);
        // A range that ends before it starts is a typo on the site: continue the previous one.
        const firstEpisode = !range ? 1 : (range.end !== null && range.start > range.end ? previousEnd + 1 : range.start);
        previousEnd = range && range.end !== null && range.end >= firstEpisode ? range.end : 0;
        return { name: panel.name, folder: panel.folder, number: panel.number || ++extra, firstEpisode };
    });
}

/** "Saga 2 Alabasta [Episode 62 à 143]" covers episodes 62 to 143; the end may be unknown ("…"). */
export function episodeRange(name) {
    const match = /\[\s*[ée]pisodes?\s+(\d+)(?:\s*(?:à|a|-)\s*(\d+))?/i.exec(name || "");
    if (!match) return null;
    return { start: parseInt(match[1], 10), end: match[2] ? parseInt(match[2], 10) : null };
}

/** Short label of a season panel, without the episode range. */
export function seasonLabel(name) {
    return String(name || "").replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

function infoValue(html, label) {
    const match = new RegExp("<span class=\"info-lbl\">(?:<svg[\\s\\S]*?</svg>)?\\s*" + label +
        "\\s*</span>\\s*<span class=\"info-val[^\"]*\">([^<]*)</span>", "i").exec(html);
    return match ? decodeEntities(match[1]).trim() : "";
}

export function detail(html, url) {
    const page = html || "";
    const title = textOf(firstInner(page, "<h1[^>]*>", "</h1>"));
    if (!title) return null;
    const thumb = /src="([^"]*\/contenu\/thumb\/[^"]+)"/i.exec(page);
    const trailer = /id="bandeannonce"[^>]*src="([^"]+)"/i.exec(page);
    const youtube = trailer ? /youtube\.com\/embed\/([\w-]+)/.exec(trailer[1]) : null;
    const status = normalize(infoValue(page, "[ÉE]tat"));
    const year = parseInt(infoValue(page, "Ann[ée]e"), 10);
    const genresBlock = firstInner(page, "<div class=\"genres-wrap\">", "</div>");
    return {
        slug: slugOf(url),
        url,
        title,
        altTitles: splitTitles(textOf(firstInner(page, "<h2 id=\"titreAlter\"[^>]*>", "</h2>"))),
        synopsis: textOf(firstInner(page, "<p id=\"synopsisText\"[^>]*>", "</p>")),
        genres: allInner(genresBlock, "<span class=\"genre-pill\">", "</span>").map(textOf).filter(Boolean),
        thumb: thumb ? thumb[1] : "",
        trailerUrl: youtube ? "https://www.youtube.com/watch?v=" + youtube[1] : "",
        ongoing: status === "en cours" ? true : (status === "termine" ? false : null),
        year: Number.isFinite(year) ? year : null,
        seasons: seasons(page)
    };
}

/** Player lists of an episodes.js file, as `[[eps1 links], [eps2 links], …]`. */
export function episodeLists(source) {
    const lists = [];
    for (const m of stripComments(source).matchAll(/var\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]/g)) {
        const links = [...m[2].matchAll(/["']([^"']*)["']/g)].map(x => x[1].trim());
        lists.push({ index: parseInt(m[1], 10), links });
    }
    return lists.sort((a, b) => a.index - b.index).map(x => x.links);
}

export function episodeCount(lists) {
    return lists.reduce((max, links) => Math.max(max, links.length), 0);
}

/** Links of episode `index` (0-based) across every player, without blanks or duplicates. */
export function episodeLinks(lists, index) {
    const out = [];
    for (const links of lists) {
        const link = (links[index] || "").replace(/vidmoly\.(to|net)\b/gi, "vidmoly.biz");
        if (/^https?:\/\//i.test(link) && !out.includes(link)) out.push(link);
    }
    return out;
}

/** Episode URL stored in the app: the season page plus the 0-based index. */
export function episodeUrl(base, slug, folder, language, index) {
    return base + "/catalogue/" + slug + "/" + folder + "/" + language + "/#" + index;
}

export function parseEpisodeUrl(url) {
    const match = /^(https?:\/\/[^/]+)\/catalogue\/([^/]+)\/([^/]+)\/([^/#]+)\/?#(\d+)$/i.exec(url || "");
    if (!match) return null;
    return { base: match[1], slug: match[2], folder: match[3], language: match[4], index: parseInt(match[5], 10) };
}

export function episodesJsUrl(base, slug, folder, language) {
    return base + "/catalogue/" + slug + "/" + folder + "/" + language + "/episodes.js";
}

// --------------------------------------------------------------- players

const PLAYER_NAMES = [
    [/sibnet/, "Sibnet"],
    [/sendvid/, "Sendvid"],
    [/vidmoly|ansembed/, "Vidmoly"],
    [/smoothpre|minochinos|callistanise|vidhide|filelions/, "VidHide"],
    [/oneupload/, "OneUpload"],
    [/embed4me|lpayer/, "Lpayer"]
];

export function playerName(url) {
    const host = hostOf(url);
    for (const [re, name] of PLAYER_NAMES) if (re.test(host)) return name;
    return host.replace(/^www\./, "").split(".")[0] || "Lecteur";
}

/** Players that cannot be resolved without a browser. */
export function isUnsupportedPlayer(url) {
    return /(^|\.)embed4me\.com$/.test(hostOf(url));
}

const PACKER_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

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

/** The page followed by every packed script it contains, unpacked. */
export function withUnpacked(html) {
    const page = html || "";
    const parts = [page];
    for (const m of page.matchAll(/eval\(function\(p,a,c,k,e,[dr]\)[\s\S]*?\.split\('\|'\)[^)]*\)\)?/g)) {
        const unpacked = unpackPacker(m[0]);
        if (unpacked) parts.push(unpacked);
    }
    return parts.join("\n");
}

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

/**
 * VidHide pages list several playlists. "hls4" (relative to the player's domain) is last:
 * its segments are disguised as images, which AVPlayer rejects.
 */
export function vidhideLinks(unpacked, pageUrl) {
    const match = /links\s*=\s*(\{[^}]*\})/.exec(unpacked || "");
    if (!match) return [];
    let links;
    try {
        links = JSON.parse(match[1]);
    } catch (_) {
        return [];
    }
    return ["hls2", "hls3", "hls4"]
        .map(key => links[key] ? resolveUrl(pageUrl, links[key]) : "")
        .filter(Boolean);
}

/** Sendvid's signed MP4: the <source> tag, or the og:video meta. */
export function sendvidSource(html) {
    const match = /<source[^>]+src="([^"]+)"/i.exec(html || "") ||
        /<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/i.exec(html || "");
    return match ? decodeEntities(match[1]) : null;
}

/** Sibnet's player source, e.g. player.src([{src: "/v/abc/123.mp4", …}]). */
export function sibnetSource(html) {
    const match = /player\.src\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/.exec(html || "");
    return match ? resolveUrl("https://video.sibnet.ru/", match[1]) : null;
}

const MEDIA = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?(?=["'\s<>\\]|$)/gi;

/** Every .m3u8/.mp4 link of a player page, packed scripts included. */
export function mediaUrls(html) {
    const out = [];
    for (const found of withUnpacked(html).replace(/\\\//g, "/").matchAll(MEDIA)) {
        const url = found[0].replace(/&amp;/g, "&");
        // Voe pages carry a decoy sample video.
        if (/test-videos\.co\.uk|\/novideo/i.test(url)) continue;
        if (!out.includes(url)) out.push(url);
    }
    return out;
}

export function isHls(url) {
    return /\.m3u8(\?|$)|\/hls\d?\//i.test(url || "") && !/\.mp4(\?|$)/i.test(url || "");
}

export function highestHlsQuality(manifest) {
    let max = 0;
    for (const m of String(manifest || "").matchAll(/RESOLUTION\s*=\s*\d+x(\d+)/gi)) {
        max = Math.max(max, parseInt(m[1], 10));
    }
    return max || null;
}

// ---------------------------------------------------------------- artwork

/** Lookup title for AniList: drops season and arc suffixes. */
export function coverLookupTitle(title) {
    return String(title || "")
        .replace(/\s*\((?:VF|VOSTFR)\)\s*$/i, "")
        .replace(/\s+(?:saison|season)\s+\d+.*$/i, "")
        .trim();
}

export function anilistQuery(titles) {
    const parts = titles.map((title, i) =>
        "a" + i + ": Page(perPage: 1) { media(search: " + JSON.stringify(title) +
        ", type: ANIME) { coverImage { extraLarge large } bannerImage } }"
    );
    return "query { " + parts.join(" ") + " }";
}

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
