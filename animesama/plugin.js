import {
    LANGUAGES,
    HOME_SECTIONS,
    catalogCards,
    episodeCards,
    carouselSlides,
    section,
    planningId,
    uniqueWatchable,
    rankByQuery,
    bannerFromThumb,
    detail,
    seasonLabel,
    slugOf,
    seriesUrl,
    episodeLists,
    episodeCount,
    episodeLinks,
    episodeUrl,
    parseEpisodeUrl,
    episodesJsUrl,
    playerName,
    isUnsupportedPlayer,
    withUnpacked,
    voeSources,
    vidhideLinks,
    sendvidSource,
    sibnetSource,
    mediaUrls,
    isHls,
    highestHlsQuality,
    originOf,
    normalize,
    coverLookupTitle,
    anilistQuery,
    anilistResults
} from "./src/parser.js";

(function() {
    const SEARCH_PAGES = 3;
    const SOURCE_TIMEOUT_MS = 15000;
    const EPISODES_CONCURRENCY = 8;
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const CACHE_MAX_ENTRIES = 120;
    const MISSING_PAGE = "";
    const ANILIST_URL = "https://graphql.anilist.co";
    const ANILIST_BATCH = 40;
    const ANILIST_TIMEOUT_MS = 6000;
    const MIN_VIDEO_BYTES = 2 * 1024 * 1024;
    // Direct HLS first; Voe and Sendvid are slower to start.
    const PLAYER_ORDER = ["Vidmoly", "VidHide", "Voe", "Sendvid", "Sibnet"];

    function baseUrl() {
        return String(manifest.baseUrl || "https://anime-sama.to").replace(/\/+$/, "");
    }

    function siteHeaders() {
        return { "Referer": baseUrl() + "/" };
    }

    function statusOf(res) {
        return res && (res.status || res.statusCode);
    }

    // Small LRU cache: reopening a series or starting an episode reuses its episodes.js files.
    const pageCache = new Map();

    function cacheGet(url) {
        const entry = pageCache.get(url);
        if (!entry) return undefined;
        if (Date.now() - entry.at > CACHE_TTL_MS) {
            pageCache.delete(url);
            return undefined;
        }
        pageCache.delete(url);
        pageCache.set(url, entry);
        return entry.body;
    }

    function cachePut(url, body) {
        pageCache.delete(url);
        pageCache.set(url, { body, at: Date.now() });
        while (pageCache.size > CACHE_MAX_ENTRIES) pageCache.delete(pageCache.keys().next().value);
    }

    async function getPage(url, useCache = true) {
        if (useCache) {
            const cached = cacheGet(url);
            if (cached === MISSING_PAGE) throw new Error("Anime-Sama a répondu 404");
            if (cached !== undefined) return cached;
        }
        const res = await http_get(url, siteHeaders());
        const status = statusOf(res);
        const body = res && typeof res.body === "string" ? res.body : String(res || "");
        if (status !== 200) {
            // Most series have no VF for some seasons: remember the 404s too.
            if (useCache && status === 404) cachePut(url, MISSING_PAGE);
            throw new Error("Anime-Sama a répondu " + status);
        }
        if (useCache) cachePut(url, body);
        return body;
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

    /** Runs `task` over `items` with at most `limit` requests in flight, keeping the order. */
    async function mapLimited(items, limit, task) {
        const results = new Array(items.length);
        let next = 0;
        const worker = async () => {
            while (next < items.length) {
                const i = next++;
                results[i] = await task(items[i], i).catch(() => null);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return results;
    }

    // ------------------------------------------------------------- artwork

    // Anime-Sama only has landscape thumbnails: portrait covers come from AniList.
    // Results are kept for the whole session.
    const artworkCache = new Map();

    async function fetchArtworkBatch(titles) {
        const res = await withTimeout(
            http_post(ANILIST_URL, { "Content-Type": "application/json", "Accept": "application/json" },
                JSON.stringify({ query: anilistQuery(titles) })),
            ANILIST_TIMEOUT_MS,
            null
        );
        // AniList answers 404 when some titles are missing but still sends the others.
        return res ? anilistResults(res.body, titles.length) : null;
    }

    async function loadArtwork(titles) {
        const missing = [];
        const keys = new Set();
        for (const title of titles) {
            const key = normalize(coverLookupTitle(title));
            if (key && !artworkCache.has(key) && !keys.has(key)) {
                keys.add(key);
                missing.push(coverLookupTitle(title));
            }
        }
        const batches = [];
        for (let i = 0; i < missing.length; i += ANILIST_BATCH) batches.push(missing.slice(i, i + ANILIST_BATCH));
        const answers = await Promise.all(batches.map(batch => fetchArtworkBatch(batch).catch(() => null)));
        batches.forEach((batch, b) => {
            // Not cached when AniList was unreachable, so the next screen tries again.
            if (answers[b]) batch.forEach((title, i) => artworkCache.set(normalize(title), answers[b][i]));
        });
    }

    function artworkFor(title) {
        return artworkCache.get(normalize(coverLookupTitle(title))) || null;
    }

    /** The title, then up to two alternate titles in latin script (e.g. "Hokuto no Ken" for "Ken le Survivant"). */
    function lookupNames(card) {
        return [card.title].concat((card.altTitles || []).filter(name => /[a-z]/i.test(name)).slice(0, 2));
    }

    function cardArtwork(card) {
        return lookupNames(card).map(artworkFor).find(Boolean) || null;
    }

    /** Looks up every card by title, then the ones AniList missed by their alternate titles. */
    async function loadCardArtwork(cards) {
        await loadArtwork(cards.map(card => card.title));
        const missed = cards.filter(card => !cardArtwork(card));
        const retry = [].concat(...missed.map(card => lookupNames(card).slice(1)));
        if (retry.length) await loadArtwork(retry);
    }

    function toItem(card) {
        const art = cardArtwork(card);
        const description = card.synopsis || [card.info, card.language].filter(Boolean).join(" · ");
        return new MultimediaItem({
            title: card.title,
            url: card.url,
            posterUrl: (art && art.cover) || card.thumb || card.banner,
            bannerUrl: card.banner || bannerFromThumb(card.thumb) || (art && art.banner) || undefined,
            type: "anime",
            description: description || undefined,
            tags: card.genres && card.genres.length ? card.genres : undefined,
            headers: siteHeaders()
        });
    }

    // ---------------------------------------------------------------- home

    async function getHome(cb) {
        try {
            // Not cached: refreshing the home page must show the newest episodes.
            const html = await getPage(baseUrl() + "/", false);
            const rows = [{ label: "Trending", cards: uniqueWatchable(carouselSlides(html, baseUrl())) }];
            rows.push({
                label: "Sorties du jour",
                cards: uniqueWatchable(episodeCards(section(html, planningId(new Date())), baseUrl()))
            });
            for (const row of HOME_SECTIONS) {
                const part = section(html, row.id);
                const cards = row.kind === "episodes" ? episodeCards(part, baseUrl()) : catalogCards(part, baseUrl());
                rows.push({ label: row.label, cards: uniqueWatchable(cards) });
            }
            await loadCardArtwork([].concat(...rows.map(row => row.cards)));
            const data = {};
            for (const row of rows) {
                if (row.cards.length) data[row.label] = row.cards.map(toItem);
            }
            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Anime-Sama est indisponible" });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: String(e && e.message || e) });
        }
    }

    // -------------------------------------------------------------- search

    function searchUrl(query, page) {
        return baseUrl() + "/catalogue/?search=" + encodeURIComponent(query.trim()) + (page > 1 ? "&page=" + page : "");
    }

    function lastSearchPage(html) {
        let last = 1;
        for (const m of String(html).matchAll(/[?&]page=(\d+)/g)) last = Math.max(last, parseInt(m[1], 10));
        return last;
    }

    async function search(query, cb) {
        try {
            if (!query || !query.trim()) return cb({ success: true, data: [] });
            const first = await getPage(searchUrl(query, 1));
            const pages = [];
            for (let page = 2; page <= Math.min(lastSearchPage(first), SEARCH_PAGES); page++) pages.push(page);
            const others = await Promise.all(pages.map(page => getPage(searchUrl(query, page)).catch(() => "")));
            const cards = rankByQuery(uniqueWatchable([first].concat(others)
                .reduce((all, html) => all.concat(catalogCards(html, baseUrl())), [])), query);
            await loadCardArtwork(cards);
            cb({ success: true, data: cards.map(toItem) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message || e) });
        }
    }

    // ---------------------------------------------------------------- load

    async function playerLists(slug, folder, language) {
        try {
            return episodeLists(await getPage(episodesJsUrl(baseUrl(), slug, folder, language)));
        } catch (_) {
            return [];
        }
    }

    async function load(url, cb) {
        try {
            const slug = slugOf(url);
            if (!slug) return cb({ success: false, errorCode: "NOT_FOUND", message: "Lien Anime-Sama invalide" });
            const pageUrl = seriesUrl(baseUrl(), slug);
            const info = detail(await getPage(pageUrl), pageUrl);
            if (!info) return cb({ success: false, errorCode: "NOT_FOUND", message: "Fiche Anime-Sama introuvable" });

            // Every season is tried in VOSTFR and in VF: the page does not say which exist.
            const jobs = [];
            info.seasons.forEach(season => LANGUAGES.forEach(language => jobs.push({ season, language })));
            const [lists] = await Promise.all([
                mapLimited(jobs, EPISODES_CONCURRENCY, job => playerLists(slug, job.season.folder, job.language.path)),
                loadCardArtwork([info])
            ]);
            const art = cardArtwork(info);
            const posterUrl = (art && art.cover) || info.thumb;

            const episodes = [];
            jobs.forEach((job, j) => {
                const count = episodeCount(lists[j] || []);
                const isFilm = /^film/i.test(job.season.folder);
                for (let index = 0; index < count; index++) {
                    const number = job.season.firstEpisode + index;
                    episodes.push(new Episode({
                        name: isFilm ? "Film " + (index + 1) : "Épisode " + number,
                        url: episodeUrl(baseUrl(), slug, job.season.folder, job.language.path, index),
                        season: job.season.number,
                        episode: isFilm ? index + 1 : number,
                        description: seasonLabel(job.season.name),
                        dubStatus: job.language.dubStatus,
                        posterUrl: posterUrl || undefined,
                        headers: siteHeaders()
                    }));
                }
            });

            const description = info.altTitles.length
                ? info.synopsis + (info.synopsis ? "\n\n" : "") + "Autres titres : " + info.altTitles.join(", ")
                : info.synopsis;

            cb({
                success: true,
                data: new MultimediaItem({
                    title: info.title,
                    url: pageUrl,
                    posterUrl,
                    bannerUrl: bannerFromThumb(info.thumb) || (art && art.banner) || undefined,
                    type: "anime",
                    year: info.year || undefined,
                    description,
                    tags: info.genres,
                    status: info.ongoing === true ? "ongoing" : (info.ongoing === false ? "completed" : undefined),
                    trailers: info.trailerUrl ? [new Trailer({ url: info.trailerUrl })] : [],
                    headers: siteHeaders(),
                    episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------- streams

    function stream(url, label, headers) {
        return new StreamResult({ url, source: label, headers });
    }

    /** Highest resolution of a playlist, 0 when it has none, or null when it cannot be loaded. */
    async function hlsQuality(url, headers) {
        const res = await withTimeout(http_get(url, headers), 4000, null);
        if (statusOf(res) !== 200 || !/#EXTM3U/.test(res.body || "")) return null;
        return highestHlsQuality(res.body) || 0;
    }

    /** Player name and media URLs of a player page, most reliable first. */
    function playerMedia(link, html, pageUrl) {
        if (/sendvid\.com/i.test(link)) {
            const mp4 = sendvidSource(html);
            return { name: "Sendvid", urls: mp4 ? [mp4] : [] };
        }
        // Voe changes domains constantly: recognize it by its page instead.
        const voe = voeSources(html);
        if (voe) return { name: "Voe", urls: voe };
        const vidhide = vidhideLinks(withUnpacked(html), pageUrl);
        if (vidhide.length) return { name: "VidHide", urls: vidhide };
        return { name: playerName(link), urls: mediaUrls(html) };
    }

    function headerValue(res, name) {
        const headers = (res && res.headers) || {};
        const key = Object.keys(headers).find(k => k.toLowerCase() === name);
        return key ? String(headers[key]) : "";
    }

    /**
     * False when a video file is missing or is a placeholder: dead Sendvid videos answer
     * with a 36 KB clip of the Sendvid logo instead of an error. Only two bytes are requested.
     */
    async function videoUsable(url, headers) {
        const res = await withTimeout(http_get(url, Object.assign({}, headers, { "Range": "bytes=0-1" })), 4000, undefined);
        // No answer in time: keep the link rather than hide a slow but working server.
        if (res === undefined) return true;
        const status = statusOf(res);
        if (status !== 200 && status !== 206) return false;
        const total = /\/(\d+)\s*$/.exec(headerValue(res, "content-range"));
        const size = total ? parseInt(total[1], 10) : (status === 200 ? parseInt(headerValue(res, "content-length"), 10) : NaN);
        return !(size > 0 && size < MIN_VIDEO_BYTES);
    }

    async function loadPlayer(link, language) {
        if (isUnsupportedPlayer(link)) return [];
        const res = await http_get(link, siteHeaders());
        if (statusOf(res) !== 200) return [];
        const html = res.body || "";

        if (/sibnet\.ru/i.test(link)) {
            const mp4 = sibnetSource(html);
            const headers = { "Referer": link };
            return mp4 && await videoUsable(mp4, headers) ? [stream(mp4, "Sibnet · " + language + " · MP4", headers)] : [];
        }

        const pageUrl = res.finalUrl || res.url || link;
        const origin = originOf(pageUrl);
        const headers = { "Referer": origin + "/", "Origin": origin };
        const media = playerMedia(link, html, pageUrl);
        const qualities = await Promise.all(media.urls.map(url =>
            isHls(url) ? hlsQuality(url, headers) : videoUsable(url, headers).then(ok => ok ? 0 : null)
        ));
        // Links that cannot be loaded (expired, a CDN blocked by the network's DNS, a dead video) are dropped.
        const usable = media.urls.filter((url, i) => qualities[i] !== null);
        return usable.map((mediaUrl, i) => {
            // Several links of one player become "VidHide", "VidHide 2", …
            const name = i ? media.name + " " + (i + 1) : media.name;
            const height = qualities[media.urls.indexOf(mediaUrl)];
            const quality = height ? height + "p" : (isHls(mediaUrl) ? "" : "MP4");
            return stream(mediaUrl, [name, language, quality].filter(Boolean).join(" · "), headers);
        });
    }

    async function loadStreams(url, cb) {
        try {
            const ref = parseEpisodeUrl(url);
            if (!ref) return cb({ success: false, errorCode: "NOT_FOUND", message: "Épisode introuvable" });
            const lists = await playerLists(ref.slug, ref.folder, ref.language);
            const links = episodeLinks(lists, ref.index);
            if (!links.length) return cb({ success: false, errorCode: "NOT_FOUND", message: "Aucun lecteur pour cet épisode" });
            const language = (LANGUAGES.find(l => l.path === ref.language) || { label: ref.language.toUpperCase() }).label;
            const found = await Promise.all(links.map(link =>
                withTimeout(loadPlayer(link, language), SOURCE_TIMEOUT_MS, [])
            ));
            const seen = new Set();
            const data = [];
            for (const item of [].concat(...found)) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    data.push(item);
                }
            }
            const rank = item => {
                const i = PLAYER_ORDER.indexOf(item.source.split(/[ ·]/)[0]);
                return i < 0 ? PLAYER_ORDER.length : i;
            };
            data.sort((a, b) => rank(a) - rank(b));
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
