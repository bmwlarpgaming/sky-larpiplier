// Pure HTML parsing for movix: no DOM, no network, testable with node.
// Movix is a Laravel/Livewire site: listings are grids of poster cards, a title is
// `/movie/<slug>` or `/tv-show/<slug>`, an episode `/episode/<slug>/<season>-<episode>`, and
// every film or episode page lists its players in an inline `videos = [...]` array.

/** Home rows: path under the site and label, in display order. The first one is the carousel. */
export const HOME_ROWS = [
    ["trending", "Tendances"],
    ["movies", "Derniers films"],
    ["tv-shows", "Dernières séries"],
    ["top-imdb", "Top IMDb"],
    ["genre/action", "Action"],
    ["genre/aventure", "Aventure"],
    ["genre/animation", "Animation"],
    ["genre/comedie", "Comédie"],
    ["genre/crime", "Crime"],
    ["genre/drame", "Drame"],
    ["genre/familial", "Familial"],
    ["genre/fantastique", "Fantastique"],
    ["genre/horreur", "Horreur"],
    ["genre/mystere", "Mystère"],
    ["genre/romance", "Romance"],
    ["genre/science-fiction", "Science-fiction"],
    ["genre/thriller", "Thriller"],
    ["genre/documentaire", "Documentaire"],
    ["genre/guerre", "Guerre"],
    ["genre/western", "Western"]
];

/** Audio versions, best first. */
export const VERSIONS = ["VF", "VFQ", "VOSTFR", "VO"];

// ------------------------------------------------------------------ text

export function decodeEntities(value) {
    return String(value || "")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

export function textOf(html) {
    return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function attr(tag, name) {
    const match = new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i").exec(tag || "");
    return match ? decodeEntities(match[2] !== undefined ? match[2] : match[3]) : "";
}

/** Lowercase letters and digits, accents removed: for comparing titles. */
export function titleKey(value) {
    let s = String(value || "").toLowerCase();
    try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (_) {
        // Engines without Unicode normalization: keep accents.
    }
    return s.replace(/[^a-z0-9]+/g, "");
}

/** TMDB image at a larger size: w300 posters become w500, backdrops become w1280. */
export function largeImage(url, size) {
    return String(url || "").replace(/(\/t\/p\/)(?:w|h)\d+(?:_and_h\d+_bestv2)?(\/)/i, "$1" + (size || "w500") + "$2");
}

function score(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ------------------------------------------------------------------- URLs

/** "https://movix.zip/tv-show/from" -> { type: "series", slug: "from" }. */
export function parseTitleUrl(url) {
    const match = /\/(movie|tv-show)\/([^/?#]+)/.exec(String(url || ""));
    return match ? { type: match[1] === "movie" ? "movie" : "series", slug: match[2] } : null;
}

export function episodeUrl(base, slug, season, episode) {
    return base + "/episode/" + slug + "/" + season + "-" + episode;
}

// ----------------------------------------------------------------- cards

/** Poster cards of a listing or search page: { title, url, posterUrl, type, score }. */
export function cards(html) {
    const out = [];
    const seen = new Set();
    const pattern = /<a[^>]*href="(https?:\/\/[^"]+\/(movie|tv-show)\/[^"]+)"[^>]*>\s*<picture>\s*(<img[^>]*>)([\s\S]*?)<\/a>/g;
    for (const match of String(html || "").matchAll(pattern)) {
        const url = match[1];
        const title = attr(match[3], "alt");
        if (!title || seen.has(url)) continue;
        seen.add(url);
        const image = attr(match[3], "data-src") || attr(match[3], "src");
        const rating = /<span[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/span>/.exec(match[4]);
        out.push({
            title,
            url,
            posterUrl: image.startsWith("data:") ? "" : largeImage(image),
            type: match[2] === "movie" ? "movie" : "series",
            score: rating ? score(rating[1]) : undefined
        });
    }
    return out;
}

/** Search results: exact titles first, then titles starting with the query, then the site's order. */
export function rankByQuery(list, query) {
    const q = titleKey(query);
    const rank = card => {
        const key = titleKey(card.title);
        if (key === q) return 0;
        if (key.startsWith(q)) return 1;
        return 2;
    };
    return list.map((card, i) => ({ card, i, r: rank(card) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.card);
}

// ----------------------------------------------------------------- pages

/** What a film or series page shows: { title, description, posterUrl, bannerUrl, year, ... }. */
export function detail(html) {
    const page = String(html || "");
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page);
    const title = textOf((heading ? heading[1] : "").replace(/<span[\s\S]*$/, ""));
    // The facts follow the heading: runtime, year, then the rating.
    const after = heading ? page.slice(heading.index + heading[0].length, heading.index + heading[0].length + 1500) : "";
    const spans = Array.from(after.matchAll(/<span[^>]*>([^<]*)<\/span>/g), m => textOf(m[1])).filter(Boolean);
    const runtime = spans.map(s => /^(\d+)\s*min$/.exec(s)).find(Boolean);
    const year = spans.map(s => /^((?:19|20)\d{2})$/.exec(s)).find(Boolean);
    const rating = spans.map(s => /^(\d+(?:\.\d+)?)$/.exec(s)).find(m => m && parseFloat(m[1]) <= 10);
    const meta = name => attr((new RegExp('<meta[^>]*property="og:' + name + '"[^>]*>').exec(page) || [])[0], "content");
    const poster = /<img[^>]*src="(https:\/\/image\.tmdb\.org\/t\/p\/w\d+\/[^"]+)"/.exec(page);
    const trailer = /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/.exec(page);
    const genres = Array.from(new Set(Array.from(page.matchAll(/<a[^>]*href="[^"]*\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/g), m => textOf(m[1]))))
        .filter(name => name && name.length < 30);
    return {
        title,
        description: meta("description") || undefined,
        posterUrl: poster ? largeImage(poster[1]) : "",
        bannerUrl: meta("image") ? largeImage(meta("image"), "w1280") : undefined,
        year: year ? parseInt(year[1], 10) : undefined,
        duration: runtime ? parseInt(runtime[1], 10) : undefined,
        score: rating ? score(rating[1]) : undefined,
        tags: genres,
        trailer: trailer ? "https://www.youtube.com/watch?v=" + trailer[1] : undefined
    };
}

/** Season numbers of a series page (its season menu), in order. */
export function seasons(html) {
    const numbers = Array.from(String(html || "").matchAll(/wire:click="updateSeason\('\d+'\)"[\s\S]*?>\s*Saison\s+(\d+)\s*</g), m => parseInt(m[1], 10));
    const current = /"season_number":"?(\d+)/.exec(decodeEntities(html));
    if (current) numbers.push(parseInt(current[1], 10));
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

/** Episodes of a season, as listed on any of its episode pages: [{ season, episode, name, url }]. */
export function seasonEpisodes(html, slug, season) {
    const out = [];
    const seen = new Set();
    const pattern = new RegExp('<a[^>]*href="(https?://[^"]+/episode/' + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '/' + season + '-(\\d+))"[^>]*>([\\s\\S]*?)</a>', "g");
    for (const match of String(html || "").matchAll(pattern)) {
        const number = parseInt(match[2], 10);
        if (seen.has(number)) continue;
        seen.add(number);
        const parts = Array.from(match[3].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g), m => textOf(m[1])).filter(Boolean);
        const name = parts.find(p => !/^Épisode\s*#?\d+$/i.test(p));
        out.push({ season, episode: number, name: name || "Épisode " + number, url: match[1] });
    }
    return out.sort((a, b) => a.episode - b.episode);
}

/** The players of a film or episode page: [{ version, link, embedType }]. */
export function videos(html) {
    const match = /(?:const|let|var)\s+videos\s*=\s*(\[[\s\S]*?\]);/.exec(String(html || ""));
    if (!match) return [];
    let list;
    try {
        list = JSON.parse(match[1]);
    } catch (_) {
        return [];
    }
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter(v => v && /^https?:\/\//.test(v.link || "") && !seen.has(v.link) && seen.add(v.link))
        .map(v => ({ version: versionOf(v.version), link: v.link, embedType: v.embed_type || "iframe" }));
}

/** "TRUEFRENCH", "FRENCH" and "VFF" are all the French dub. */
export function versionOf(value) {
    const version = String(value || "VF").trim().toUpperCase();
    return /FRENCH|^VFF$/.test(version) ? "VF" : version;
}

// --------------------------------------------------------------- players

/** Mirrors of trakx.lol that no longer answer: the same player ids work on trakx. */
const DEAD_MIRRORS = /^https?:\/\/(?:[a-z]+\.)?(?:kakaflix\.lol|flixeo\.xyz)\//i;
/** Uqload's other domains only redirect to uqload.vc, some without the video's path. */
const UQLOAD_MIRRORS = /^https?:\/\/(?:www\.)?uqload\.[a-z]+\//i;
/** Hosts behind a captcha or a Cloudflare challenge, and empty players: not worth a request. */
const UNPLAYABLE = /^https?:\/\/(?:[^/]+\.)?(?:dood\.[a-z]+|playmogo\.com|byse[a-z]*\.com|multiup\.us)\//i;
/** trakx.lol players that only lead to those hosts (moon is Byse, doo* is Dood) or nowhere. */
const UNPLAYABLE_TRAKX = /^https:\/\/trakx\.lol\/(?:moon|doo|viper|sydney)[^/]*\//i;

/** The address to load for one of the site's players, or null when it cannot play here. */
export function playerUrl(link) {
    const url = String(link || "").replace(DEAD_MIRRORS, "https://trakx.lol/").replace(UQLOAD_MIRRORS, "https://uqload.vc/");
    if (!/^https?:\/\//.test(url) || UNPLAYABLE.test(url) || UNPLAYABLE_TRAKX.test(url)) return null;
    return url;
}
