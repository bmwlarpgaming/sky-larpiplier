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
import { USER_AGENT, parseJson, firstPlaylistEntry, languageName, languageCode, simplify, origin } from "./src/util.js";

(function() {
    const SOURCE_TIMEOUT_MS = 20000;
    const PROBE_TIMEOUT_MS = 8000;
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
     * The search result for `title`: same title first, then a TV series (the same year also has
     * ONA spin-offs, "Sousou no Frieren: ●● no Mahou" next to Frieren), then AniList's order.
     */
    function pickAnime(list, title) {
        const key = simplify(title);
        const rank = media => {
            const names = [media.title && media.title.english, media.title && media.title.romaji].map(simplify);
            return (names.includes(key) ? 0 : 2) + (media.format === "TV" ? 0 : 1);
        };
        return list.map((media, i) => ({ media, i, r: rank(media) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.media)[0] || null;
    }

    /**
     * The AniList and MyAnimeList ids the anime sources look up. Later seasons are separate
     * entries there: find the one that aired that year. A first season keeps its own ids and
     * only gets the missing ones.
     */
    async function resolveAnimeSeason(data) {
        if (!data.anime || !data.season) return data;
        const laterSeason = data.season > 1;
        // A first season only needs the ids, which IMDb-based entries do not carry.
        if (!laterSeason && data.mal && data.anilist) return data;
        const year = yearOf(data.airDate) || data.year;
        if (!year) return data;
        const query = "query ($search: String, $year: Int) { Page(perPage: 5) { media(search: $search, type: ANIME, " +
            "seasonYear: $year, format_in: [TV, ONA], sort: [SEARCH_MATCH]) { id idMal format title { romaji english } } } }";
        const res = await http.post(ANILIST_URL, { "Content-Type": "application/json", "Accept": "application/json" },
            JSON.stringify({ query, variables: { search: data.title, year } }));
        const media = pickAnime(((((parseJson(res.body) || {}).data || {}).Page || {}).media || []), data.title);
        if (!media) return data;
        if (!laterSeason) return Object.assign({}, data, { anilist: data.anilist || media.id, mal: data.mal || media.idMal || null });
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

    function isOk(res) {
        return Boolean(res) && res.status >= 200 && res.status < 300;
    }

    /**
     * Width of the best rendition, 0 when the playlist has none, null when the stream does not
     * load. Some hosts still list playlists whose segments are gone (HTTP 502): the first
     * segment is fetched too.
     */
    async function probePlaylist(stream) {
        const headers = Object.assign({ "User-Agent": USER_AGENT }, stream.headers);
        const get = url => http.get(url, headers);
        return withTimeout((async () => {
            const res = await get(stream.url);
            if (!isOk(res) || !/#EXTM3U/.test(res.body)) return null;
            let max = 0;
            for (const m of res.body.matchAll(/RESOLUTION\s*=\s*(\d+)x\d+/gi)) max = Math.max(max, parseInt(m[1], 10));
            let media = { url: stream.url, body: res.body };
            if (/#EXT-X-STREAM-INF/.test(res.body)) {
                const variant = firstPlaylistEntry(res.body, stream.url);
                const variantRes = variant ? await get(variant) : null;
                if (!isOk(variantRes) || !/#EXTM3U/.test(variantRes.body)) return null;
                media = { url: variant, body: variantRes.body };
            }
            const segment = firstPlaylistEntry(media.body, media.url);
            if (segment && !isOk(await http.get(segment, Object.assign({ "Range": "bytes=0-1023" }, headers)))) return null;
            return max;
        })(), PROBE_TIMEOUT_MS, null);
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

    /** The Referer and Origin a source's streams are loaded with, if any. */
    function siteHeaders(streams) {
        const headers = ((streams || []).find(stream => stream.headers && stream.headers.Referer) || {}).headers;
        if (!headers) return undefined;
        const out = { "Referer": headers.Referer };
        if (headers.Origin) out.Origin = headers.Origin;
        return out;
    }

    function isSubtitleText(text) {
        const clean = String(text || "").replace(/^\uFEFF/, "").trimStart();
        return clean.startsWith("WEBVTT") || /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(clean);
    }

    /** Probes one subtitle per host and returns the set of origins that serve valid WebVTT/SRT. */
    async function workingSubtitleHosts(subtitles) {
        const samples = new Map();
        for (const sub of subtitles) {
            const host = origin(sub.url);
            if (!host) continue;
            const current = samples.get(host);
            if (!current || (sub.lang === "en" && current.lang !== "en")) samples.set(host, sub);
        }
        const ok = new Set();
        await Promise.all([...samples.entries()].map(async ([host, sub]) => {
            const headers = Object.assign({ "User-Agent": USER_AGENT }, sub.headers);
            const res = await withTimeout(http.get(sub.url, headers), PROBE_TIMEOUT_MS, null);
            if (isOk(res) && isSubtitleText(res.body)) ok.add(host);
        }));
        return ok;
    }

    const MAX_SUBTITLES = 30;

    /** One subtitle per language (full tracks before SDH), English first; at most MAX_SUBTITLES. */
    function oneSubtitlePerLanguage(subtitles) {
        const ordered = subtitles.map((sub, i) => ({ sub, i }))
            .sort((a, b) => (a.sub.sdh ? 1 : 0) - (b.sub.sdh ? 1 : 0) || a.i - b.i)
            .map(x => x.sub);
        const seen = new Set();
        const unique = ordered.filter(sub => {
            const key = String(sub.lang || sub.label || "").toLowerCase();
            if (!sub.url || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const english = sub => /^en(g|glish)?\b/i.test(sub.label || sub.lang || "") ? 0 : 1;
        return unique.map((sub, i) => ({ sub, i })).sort((a, b) => english(a.sub) - english(b.sub) || a.i - b.i)
            .slice(0, MAX_SUBTITLES).map(({ sub }) => ({
                url: sub.url,
                label: sub.label,
                lang: sub.lang,
                headers: sub.headers
            }));
    }

    async function loadStreams(url, cb) {
        try {
            const data = await resolveAnimeSeason(await linkDataFor(url));
            const cache = loadStreams.cache || (loadStreams.cache = {});
            const results = await Promise.all(sourcesFor(data, SOURCES).map(source =>
                withTimeout(Promise.resolve().then(() => source.run(data, http, cache)), SOURCE_TIMEOUT_MS, null)
                    .then(result => result || { streams: [], subtitles: [] })
            ));

            // Every source names languages its own way ("French", "Français", "fre"): the code, when
            // known, names the track in English. Skip forced-only tracks so they do not shadow full
            // subtitles. A source's subtitles come from its own site, which may refuse them without
            // its Referer.
            const rawSubtitles = [].concat(...results.map(result =>
                (result.subtitles || [])
                    .filter(sub => sub && !/\bforced\b/i.test((sub.label || "") + " " + (sub.lang || "") + " " + (sub.url || "")))
                    .map(sub => {
                        const code = languageCode(sub.lang) || languageCode(sub.label);
                        return Object.assign({}, sub, {
                            label: code ? languageName(code) : languageName(sub.label || sub.lang),
                            lang: code,
                            sdh: /\b(sdh|hi|cc)\b/i.test((sub.label || "") + " " + (sub.url || "")),
                            headers: sub.headers || siteHeaders(result.streams)
                        });
                    })));
            const candidates = [];
            const seen = new Set();
            for (const result of results) {
                for (const stream of result.streams || []) {
                    if (!stream.url || seen.has(stream.url)) continue;
                    seen.add(stream.url);
                    candidates.push(stream);
                }
            }

            // Drop playlists and subtitle hosts that do not load (expired, dead DNS, or blocked).
            const [checked, liveSubHosts] = await Promise.all([
                Promise.all(candidates.map(async stream => {
                    if (isFile(stream.url)) return stream;
                    const width = await probePlaylist(stream);
                    if (width === null) return null;
                    if (!stream.quality && width) stream.quality = widthLabel(width);
                    return stream;
                })),
                workingSubtitleHosts(rawSubtitles)
            ]);
            const subtitles = oneSubtitlePerLanguage(rawSubtitles.filter(sub => liveSubHosts.has(origin(sub.url))));

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
