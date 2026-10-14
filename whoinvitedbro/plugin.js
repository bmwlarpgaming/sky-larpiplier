import {
    AIO_BASE,
    HOME_ROWS,
    SEARCH_CATALOGS,
    catalogUrl,
    metaUrl,
    parseItemUrl,
    cardFromMeta,
    interleave,
    rankByQuery,
    detailFromMeta,
    episodesFromMeta,
    linkData,
    normalize,
    yearOf
} from "./src/meta.js";
import { SOURCES, sourcesFor } from "./src/providers/index.js";
import { USER_AGENT, parseJson } from "./src/util.js";

(function() {
    const SOURCE_TIMEOUT_MS = 20000;
    const PROBE_TIMEOUT_MS = 6000;
    const META_TTL_MS = 30 * 60 * 1000;
    const ANILIST_URL = "https://graphql.anilist.co";

    // ----------------------------------------------------------------- HTTP

    function status(res) {
        return res && (res.status || res.statusCode) || 0;
    }

    function body(res) {
        return res && typeof res.body === "string" ? res.body : String(res || "");
    }

    /** The client handed to the sources: `{ status, body }`, never throws. */
    const http = {
        async get(url, headers) {
            try {
                const res = await http_get(url, headers || {});
                return { status: status(res), body: body(res) };
            } catch (e) {
                return { status: 0, body: "" };
            }
        },
        async post(url, headers, data) {
            try {
                const res = await http_post(url, headers || {}, data == null ? "" : data);
                return { status: status(res), body: body(res) };
            } catch (e) {
                return { status: 0, body: "" };
            }
        }
    };

    async function getJson(url) {
        const res = await http.get(url, { "Accept": "application/json", "User-Agent": USER_AGENT });
        if (res.status !== 200) throw new Error("The metadata service answered " + res.status);
        return JSON.parse(res.body);
    }

    function withTimeout(promise, ms, fallback) {
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(fallback), ms);
            promise.then(
                value => { clearTimeout(timer); resolve(value); },
                () => { clearTimeout(timer); resolve(fallback); }
            );
        });
    }

    /** Full metadata of a title, kept a while: loading streams needs it again. */
    const metaCache = new Map();

    async function getMeta(type, id) {
        const key = type + "/" + id;
        const cached = metaCache.get(key);
        if (cached && Date.now() - cached.at < META_TTL_MS) return cached.meta;
        const json = await getJson(metaUrl(AIO_BASE, type, id));
        if (!json || !json.meta) throw new Error("Title not found");
        metaCache.set(key, { meta: json.meta, at: Date.now() });
        return json.meta;
    }

    // ------------------------------------------------------------ catalog

    function toItem(card) {
        return new MultimediaItem({
            title: card.title,
            url: card.url,
            posterUrl: card.posterUrl,
            bannerUrl: card.bannerUrl,
            type: card.type,
            year: card.year || undefined,
            score: card.score || undefined,
            description: card.description
        });
    }

    async function catalogCards(type, catalog, extra) {
        const json = await getJson(catalogUrl(AIO_BASE, type, catalog, extra));
        return (json.metas || []).map(cardFromMeta).filter(Boolean);
    }

    async function getHome(cb) {
        try {
            const rows = await Promise.all(HOME_ROWS.map(async row => {
                const lists = await Promise.all(row.catalogs.map(([type, catalog]) =>
                    catalogCards(type, catalog).catch(() => [])));
                return { label: row.label, cards: interleave(lists) };
            }));
            const data = {};
            for (const row of rows) {
                if (row.cards.length) data[row.label] = row.cards.map(toItem);
            }
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "The catalog is unavailable" });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: String(e && e.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const text = String(query || "").trim();
            if (!text) return cb({ success: true, data: [] });
            const lists = await Promise.all(SEARCH_CATALOGS.map(([type, catalog]) =>
                catalogCards(type, catalog, { search: text }).catch(() => [])));
            // Anime results duplicate the series ones under MAL/Kitsu ids: keep the first title.
            const seen = new Set();
            const cards = [].concat(...lists).filter(card => {
                const key = normalize(card.title) + "|" + (card.year || "");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            cb({ success: true, data: rankByQuery(cards, text).map(toItem) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const ref = parseItemUrl(url);
            if (!ref) return cb({ success: false, errorCode: "NOT_FOUND", message: "Invalid link" });
            const meta = await getMeta(ref.type, ref.id);
            const detail = detailFromMeta(meta);
            cb({
                success: true,
                data: new MultimediaItem({
                    title: detail.title,
                    url,
                    posterUrl: detail.posterUrl,
                    bannerUrl: detail.bannerUrl,
                    logoUrl: detail.logoUrl,
                    type: detail.type,
                    year: detail.year || undefined,
                    score: detail.score || undefined,
                    duration: detail.duration,
                    description: detail.description,
                    tags: detail.tags,
                    status: detail.status,
                    contentRating: detail.contentRating,
                    cast: detail.cast.map(c => new Actor(c)),
                    trailers: detail.trailers.map(u => new Trailer({ url: u })),
                    syncData: detail.syncData,
                    episodes: ref.type === "movie" ? [] : episodesFromMeta(meta, Date.now()).map(e => new Episode(e))
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------- streams

    /**
     * Later anime seasons are separate entries on AniList and MyAnimeList: find the one that
     * aired that year, so the anime sources look up the right ids.
     */
    async function resolveAnimeSeason(data) {
        if (!data.anime || !data.season || data.season <= 1) return data;
        const year = yearOf(data.airDate);
        if (!year) return data;
        const query = "query ($search: String, $year: Int) { Page(perPage: 5) { media(search: $search, type: ANIME, " +
            "seasonYear: $year, format_in: [TV, ONA], sort: [SEARCH_MATCH]) { id idMal title { romaji english } } } }";
        const res = await http.post(ANILIST_URL, { "Content-Type": "application/json", "Accept": "application/json" },
            JSON.stringify({ query, variables: { search: data.title, year } }));
        const media = ((((parseJson(res.body) || {}).data || {}).Page || {}).media || [])[0];
        if (!media) return data;
        return Object.assign({}, data, {
            anilist: media.id,
            mal: media.idMal || null,
            title: (media.title && (media.title.english || media.title.romaji)) || data.title,
            originalTitle: data.title,
            // The anime sources number episodes per season entry.
            season: 1
        });
    }

    /** Link data of an episode (JSON) or of a movie (its item URL). */
    async function linkDataFor(url) {
        if (String(url).trim().startsWith("{")) return JSON.parse(url);
        const ref = parseItemUrl(url);
        if (!ref) throw new Error("Invalid link");
        return linkData(await getMeta(ref.type, ref.id));
    }

    function isFile(url) {
        return /\.(mp4|mkv|avi|m4v)(\?|$)/i.test(url);
    }

    /** Width of the best rendition, 0 when the playlist has none, null when it does not load. */
    async function probePlaylist(stream) {
        const res = await withTimeout(http.get(stream.url, Object.assign({ "User-Agent": USER_AGENT }, stream.headers)), PROBE_TIMEOUT_MS, null);
        if (!res || res.status < 200 || res.status >= 300 || !/#EXTM3U/.test(res.body)) return null;
        let max = 0;
        for (const m of res.body.matchAll(/RESOLUTION\s*=\s*(\d+)x\d+/gi)) max = Math.max(max, parseInt(m[1], 10));
        return max;
    }

    /** By width: films are wider than 16:9, so 1920×800 is a 1080p release. */
    function widthLabel(width) {
        if (width >= 3200) return "4K";
        if (width >= 1700) return "1080p";
        if (width >= 1100) return "720p";
        if (width >= 760) return "480p";
        return width ? "360p" : "";
    }

    /** "Vidrock Atlas", "Vidrock Atlas" -> "Vidrock Atlas", "Vidrock Atlas #2". */
    function uniqueLabels(labels) {
        const counts = {};
        return labels.map(label => {
            counts[label] = (counts[label] || 0) + 1;
            return counts[label] > 1 ? label + " #" + counts[label] : label;
        });
    }

    const MAX_SUBTITLES = 30;

    /** One subtitle per language, English first, then in the order found; at most MAX_SUBTITLES. */
    function oneSubtitlePerLanguage(subtitles) {
        const seen = new Set();
        const unique = subtitles.filter(sub => {
            const key = String(sub.label || sub.lang || "").toLowerCase();
            if (!sub.url || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const english = sub => /^en(g|glish)?\b/i.test(sub.label || sub.lang || "") ? 0 : 1;
        return unique.map((sub, i) => ({ sub, i })).sort((a, b) => english(a.sub) - english(b.sub) || a.i - b.i)
            .slice(0, MAX_SUBTITLES).map(x => x.sub);
    }

    async function loadStreams(url, cb) {
        try {
            const data = await resolveAnimeSeason(await linkDataFor(url));
            const cache = loadStreams.cache || (loadStreams.cache = {});
            const results = await Promise.all(sourcesFor(data, SOURCES).map(source =>
                withTimeout(Promise.resolve().then(() => source.run(data, http, cache)), SOURCE_TIMEOUT_MS, null)
                    .then(result => result || { streams: [], subtitles: [] })
            ));

            const subtitles = oneSubtitlePerLanguage([].concat(...results.map(r => r.subtitles || [])));
            const candidates = [];
            const seen = new Set();
            for (const result of results) {
                for (const stream of result.streams || []) {
                    if (!stream.url || seen.has(stream.url)) continue;
                    seen.add(stream.url);
                    candidates.push(stream);
                }
            }

            // Drop playlists that do not load (expired, rate limited, or blocked by the network).
            const checked = await Promise.all(candidates.map(async stream => {
                if (isFile(stream.url)) return stream;
                const width = await probePlaylist(stream);
                if (width === null) return null;
                if (!stream.quality && width) stream.quality = widthLabel(width);
                return stream;
            }));

            // Stable sort: streams flagged `last` go after every other one.
            const usable = checked.filter(Boolean).sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0));
            const labels = uniqueLabels(usable.map(stream => [stream.source, stream.quality].filter(Boolean).join(" · ")));
            cb({
                success: true,
                data: usable.map((stream, i) => new StreamResult({
                    url: stream.url,
                    source: labels[i],
                    quality: stream.quality || undefined,
                    headers: Object.assign({ "User-Agent": USER_AGENT }, stream.headers),
                    subtitles: subtitles.length ? subtitles : undefined
                }))
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
