// Pure HTML/JSON parsing for french-stream: no DOM, no network, testable with node.
// French-Stream is a DataLife Engine site: cards are `div.short`, a title page is
// `/index.php?newsid=<id>`, and players come from its JSON endpoints (film_api.php for movies,
// ep-data.php for the episodes of a season page).

/** Home rows: path under the site and label, in display order. The first one is the carousel. */
export const HOME_ROWS = [
    ["films/top-film", "Top Films"],
    ["films", "Derniers Films"],
    ["s-tv", "Dernières Séries"],
    ["sries-du-moment", "Séries du moment"],
    ["s-tv/netflix-series-", "Nouveautés Netflix"],
    ["s-tv/series-disney-plus", "Nouveautés Disney+"],
    ["s-tv/series-apple-tv", "Nouveautés Apple TV+"],
    ["s-tv/serie-amazon-prime-videos", "Nouveautés Prime Video"],
    ["films/actions", "Films Action"],
    ["films/comedies", "Films Comédie"],
    ["films/epouvante-horreurs", "Films Épouvante & Horreur"],
    ["films/science-fictions", "Films Science-fiction"],
    ["films/fantastiques", "Films Fantastique"],
    ["action-serie-", "Séries Action"],
    ["comedie-serie-", "Séries Comédie"],
    ["policier-series-", "Séries Policier"],
    ["science-fiction-series-", "Séries Science-fiction"],
    ["fantastique-series-", "Séries Fantastique"],
    ["horreur-serie-", "Séries Horreur"],
    ["documentaire-serie-", "Séries Documentaire"],
    ["k-drama-", "K-Drama"]
];

/** Audio versions, best first: French dub, Quebec dub, then subtitled. */
export const VERSIONS = ["VF", "VFQ", "VOSTFR"];

// ------------------------------------------------------------------ text

export function decodeEntities(value) {
    return String(value || "")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
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

export function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ""));
}

export function resolveUrl(base, value) {
    if (!value) return "";
    try {
        return new URL(value, base + "/").href;
    } catch (_) {
        return value;
    }
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

/**
 * The site's anti-robot page sets a cookie with JavaScript, then reloads: the cookie it sets
 * (`fsschal=…`), or null when the page is not that check.
 */
export function verificationCookie(html) {
    const match = /document\.cookie\s*=\s*["']fsschal=([^;"']+)/i.exec(String(html || ""));
    return match ? "fsschal=" + match[1].trim() : null;
}

// ---------------------------------------------------------------- titles

const SEASON = /\s*[-–—]?\s*saison\s+(\d+)\b/i;
const LANGUAGE_SUFFIX = /\s*(?:\[(?:VF|VOSTFR?|VFQ|VFF)(?:\s*\+\s*(?:VF|VOSTFR?|VFQ|VFF))*]|(?:VF|VOSTFR?|VFQ|VFF)(?:\s*\+\s*(?:VF|VOSTFR?|VFQ|VFF))*)\s*$/i;
const YEAR_SUFFIX = /(?:\s*[-–—]\s*(?:\((?:19|20)\d{2}\)|(?:19|20)\d{2})|\s+\((?:19|20)\d{2}\))\s*$/;

export function seasonNumber(title) {
    const match = SEASON.exec(title || "");
    return match ? parseInt(match[1], 10) : null;
}

/** "Breaking Bad - Saison 2 [VF]" -> "Breaking Bad". */
export function normalizeTitle(title) {
    return String(title || "").trim()
        .replace(LANGUAGE_SUFFIX, "")
        .replace(SEASON, "")
        .replace(YEAR_SUFFIX, "")
        .replace(LANGUAGE_SUFFIX, "")
        .trim()
        .replace(/[-–—\s]+$/, "")
        .trim();
}

export function yearOf(value) {
    const all = String(value || "").match(/\b(?:19|20)\d{2}\b/g);
    return all ? parseInt(all[all.length - 1], 10) : null;
}

/** The site id of a title page URL: `?newsid=123` or `/123-title.html`. */
export function contentId(url) {
    const match = /[?&]newsid=(\d+)/.exec(url || "") || /\/(\d+)-[^/]*\.html/.exec(url || "");
    return match ? match[1] : null;
}

/** TMDB image at a larger size: w400 posters become w780. */
export function largeImage(url) {
    return String(url || "").replace(/(\/t\/p\/)(?:w|h)\d+(?:_and_h\d+_bestv2)?(\/)/i, "$1w780$2");
}

// ----------------------------------------------------------------- cards

/** Title cards of a listing or search page: { title, url, posterUrl, type, year, version }. */
export function cards(html, base) {
    const out = [];
    const seen = new Set();
    for (const block of String(html || "").split(/<div class="short">/).slice(1)) {
        const poster = /<a[^>]*class="short-poster[^"]*"[^>]*>/.exec(block);
        if (!poster) continue;
        const url = resolveUrl(base, attr(poster[0], "href"));
        // The visible title first: `alt` breaks on titles with quotes (El Camino : Un film "Breaking Bad").
        const title = textOf((/<div class="short-title">([\s\S]*?)<\/div>/.exec(block) || [])[1]) || attr(poster[0], "alt");
        if (!url || !title || seen.has(url)) continue;
        seen.add(url);
        const img = /<img[^>]*>/.exec(block);
        let image = img ? attr(img[0], "src") : "";
        if (!image || image.startsWith("data:")) image = img ? attr(img[0], "data-src") : "";
        const version = textOf((/<span class="film-version">([\s\S]*?)<\/span>/.exec(block) || [])[1]);
        const series = seasonNumber(title) !== null || /class="mli-eps"/.test(block);
        out.push({
            title: series ? normalizeTitle(title) : title,
            url,
            posterUrl: image ? resolveUrl(base, image) : "",
            type: series ? "series" : "movie",
            season: seasonNumber(title),
            year: yearOf(textOf((/<span class="date">([\s\S]*?)<\/span>/.exec(block) || [])[1])) || undefined,
            version
        });
    }
    return out;
}

/** Seasons of a show are separate pages: one card per show, the latest season's page. */
export function uniqueShows(list) {
    const out = [];
    const byShow = new Map();
    for (const card of list) {
        if (card.type !== "series") {
            out.push(card);
            continue;
        }
        const key = titleKey(card.title);
        const known = byShow.get(key);
        if (!known) {
            byShow.set(key, card);
            out.push(card);
        } else if ((card.season || 0) > (known.season || 0)) {
            Object.assign(known, card);
        }
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

const DESCRIPTION_BOILERPLATE = /^\s*r[ée]sum[ée]\s+(?:du\s+film|de\s+la\s+s[ée]rie)\s+.*?\bsans\s+inscription\b\s*/i;

/** What a title page shows: { title, season, year, description, tags, contentRating, duration, isSeries, ... }. */
export function detail(html) {
    const page = String(html || "");
    const heading = /<h1[^>]*id="s-title"[^>]*>([\s\S]*?)<\/h1>/.exec(page);
    const rawTitle = textOf(heading ? heading[1] : (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page) || [])[1]);
    const siteTitle = rawTitle.replace(/\s*-\s*(?:19|20)\d{2}\s*$/, "").trim();
    const facts = ((/<div class="facts">([\s\S]*?)<\/div>/.exec(page)) || [])[1] || "";
    const fact = name => textOf((new RegExp('<span class="' + name + '">([\\s\\S]*?)</span>').exec(facts) || [])[1]);
    const description = textOf((/<div class="fdesc[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(page) || [])[1])
        .replace(DESCRIPTION_BOILERPLATE, "").trim();
    const seriesData = /<div[^>]*id="serie-data"[^>]*>/.exec(page);
    const tag = /xfname=tagz&amp;xf=([sf]-\d+)/.exec(page) || /xfname=tagz&xf=([sf]-\d+)/.exec(page);
    const runtime = /(\d+)\s*min/.exec(fact("runtime"));
    return {
        siteTitle,
        title: normalizeTitle(siteTitle),
        season: seasonNumber(siteTitle),
        year: yearOf(rawTitle) || yearOf(fact("release")) || null,
        description: description || undefined,
        tags: fact("genres").split(",").map(s => s.trim()).filter(Boolean),
        contentRating: fact("certification") || undefined,
        duration: runtime ? parseInt(runtime[1], 10) : undefined,
        isSeries: Boolean(seriesData) || seasonNumber(siteTitle) !== null,
        newsId: seriesData ? attr(seriesData[0], "data-newsid") : null,
        posterUrl: seriesData ? attr(seriesData[0], "data-affiche") : "",
        trailer: seriesData ? attr(seriesData[0], "data-trailer") : "",
        /** "s-1396" for shows, "f-27205" for movies: the TMDB id the site groups seasons by. */
        tag: tag ? tag[1] : null
    };
}

/** Other seasons of a show, from `get_seasons.php`: [{ season, url }], same show only. */
export function seasonRefs(items, base, title) {
    const key = titleKey(normalizeTitle(title));
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
        const season = seasonNumber(item && item.title);
        if (!season || titleKey(normalizeTitle(item.title)) !== key || !item.full_url) continue;
        out.push({ season, url: resolveUrl(base, item.full_url) });
    }
    return out;
}

// --------------------------------------------------------------- players

/** Player links of a movie (`film_api.php`): { VF: [...], VFQ: [...], VOSTFR: [...] }. */
export function movieLinks(json) {
    const links = { VF: [], VFQ: [], VOSTFR: [] };
    const players = (json && json.players) || {};
    for (const name of Object.keys(players).sort()) {
        const player = players[name] || {};
        for (const [field, version] of [["default", "VF"], ["vff", "VF"], ["vfq", "VFQ"], ["vostfr", "VOSTFR"]]) {
            const url = String(player[field] || "").trim();
            if (isHttpUrl(url) && !links[version].includes(url)) links[version].push(url);
        }
    }
    return links;
}

/** What a movie's `film_api.php` says about it: poster, backdrop, trailer and cast. */
export function movieMeta(json) {
    const meta = (json && json.meta) || {};
    const cast = [];
    for (const m of String(meta.bkp || "").matchAll(/"?([^"\\]+?) \(([^)]*)\) - (https?:\/\/[^"\\\s]+)/g)) {
        cast.push({ name: m[1].replace(/^[\s,]+/, "").trim(), role: m[2].trim() || undefined, image: m[3] });
    }
    return {
        posterUrl: largeImage(meta.affiche),
        bannerUrl: meta.affiche2 ? String(meta.affiche2).replace(/w\d+_and_h\d+_bestv2/, "original") : undefined,
        trailer: meta.trailer || undefined,
        tag: meta.tagz || null,
        cast
    };
}

/**
 * Episodes of a season page (`ep-data.php`): [{ episode, name, description, posterUrl, links }],
 * `links` by version ({ VF: [...], VOSTFR: [...] }).
 */
export function seasonEpisodes(json) {
    const byEpisode = new Map();
    for (const [group, version] of [["vf", "VF"], ["vostfr", "VOSTFR"]]) {
        const episodes = (json && json[group]) || {};
        for (const key of Object.keys(episodes)) {
            const number = parseInt(key, 10);
            if (!(number > 0)) continue;
            const urls = Object.values(episodes[key] || {}).map(u => String(u || "").trim()).filter(isHttpUrl);
            if (!urls.length) continue;
            if (!byEpisode.has(number)) byEpisode.set(number, { episode: number, links: {} });
            byEpisode.get(number).links[version] = Array.from(new Set(urls));
        }
    }
    const info = (json && json.info) || {};
    return Array.from(byEpisode.values()).sort((a, b) => a.episode - b.episode).map(item => {
        const about = info[String(item.episode)] || {};
        return {
            episode: item.episode,
            name: about.title ? String(about.title).trim() : "Épisode " + item.episode,
            description: about.synopsis ? String(about.synopsis).trim() : undefined,
            posterUrl: about.poster ? largeImage(about.poster) : undefined,
            links: item.links
        };
    });
}
