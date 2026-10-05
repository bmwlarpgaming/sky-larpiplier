import {
    CATEGORIES,
    POPULAR_PATH,
    KIND,
    cards,
    groupCards,
    rankByQuery,
    lastPage,
    detail,
    counterpartUrl,
    sources,
    extractMediaUrls,
    checkedLinkType,
    highestHlsQuality,
    qualityFromUrl,
    streamtapeUrl,
    mailRuId,
    cookieValue,
    sameAnime,
    slug,
    originOf,
    normalize,
    coverLookupTitle,
    coverFallbackTitle,
    anilistQuery,
    anilistResults
} from "./src/parser.js";

(function() {
    const SEARCH_PAGES = 5;
    const SOURCE_TIMEOUT_MS = 20000;
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const CACHE_MAX_ENTRIES = 40;
    const MISSING_PAGE = "";
    const ANILIST_URL = "https://graphql.anilist.co";
    const ANILIST_BATCH = 40;
    const ANILIST_TIMEOUT_MS = 6000;

    function baseUrl() {
        return String(manifest.baseUrl || "https://voir-anime.to").replace(/\/+$/, "");
    }

    // Poster requests without a Referer are rejected with a 403.
    function siteHeaders() {
        return { "Referer": baseUrl() + "/" };
    }

    // Small LRU cache of page HTML: reopening an anime or repeating a search is instant.
    // Kept short so new episodes show up quickly.
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
        return entry.html;
    }

    function cachePut(url, html) {
        pageCache.delete(url);
        pageCache.set(url, { html, at: Date.now() });
        while (pageCache.size > CACHE_MAX_ENTRIES) pageCache.delete(pageCache.keys().next().value);
    }

    async function getPage(url, useCache = true) {
        if (useCache) {
            const cached = cacheGet(url);
            if (cached === MISSING_PAGE) throw new Error("Voiranime a répondu 404");
            if (cached !== undefined) return cached;
        }
        const res = await http_get(url, siteHeaders());
        const status = res && (res.status || res.statusCode);
        const body = res && typeof res.body === "string" ? res.body : String(res || "");
        if (status !== 200) {
            // Remember missing pages too: slug guesses often hit a 404.
            if (useCache && status === 404) cachePut(url, MISSING_PAGE);
            throw new Error("Voiranime a répondu " + status);
        }
        if (useCache) cachePut(url, body);
        return body;
    }

    async function tryDetail(url) {
        try {
            return detail(await getPage(url), url);
        } catch (_) {
            return null;
        }
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

    function pagedUrl(path, page) {
        const [pathPart, query] = path.split("?");
        const suffix = query ? "?" + query : "";
        if (page <= 1) return baseUrl() + pathPart + suffix;
        return baseUrl() + pathPart.replace(/\/+$/, "") + "/page/" + page + "/" + suffix;
    }

    // ------------------------------------------------------------- artwork

    // voir-anime.to rejects image requests without its own Referer, and SkyStream
    // loads posters without the item headers. Artwork therefore comes from AniList,
    // whose CDN has no such check. Results are kept for the whole session.
    const artworkCache = new Map();

    /** Artwork per title, or null for the whole batch when AniList is unreachable. */
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

    async function fetchArtwork(titles) {
        const found = new Map();
        const batches = [];
        for (let i = 0; i < titles.length; i += ANILIST_BATCH) batches.push(titles.slice(i, i + ANILIST_BATCH));
        const answers = await Promise.all(batches.map(batch => fetchArtworkBatch(batch).catch(() => null)));
        batches.forEach((batch, b) => {
            if (answers[b]) batch.forEach((title, i) => found.set(title, answers[b][i]));
        });
        return found;
    }

    /** Looks up the artwork of every title not cached yet, in batched requests. */
    async function loadArtwork(titles) {
        const missing = [];
        for (const title of titles) {
            const key = normalize(coverLookupTitle(title));
            if (key && !artworkCache.has(key) && !missing.some(t => normalize(coverLookupTitle(t)) === key)) missing.push(title);
        }
        if (!missing.length) return;
        const first = await fetchArtwork(missing.map(coverLookupTitle));
        // Second pass with the franchise name for titles AniList did not find.
        const retry = missing.filter(t => first.get(coverLookupTitle(t)) === null && coverFallbackTitle(t));
        const second = retry.length ? await fetchArtwork(retry.map(coverFallbackTitle)) : new Map();
        for (const title of missing) {
            const answer = first.get(coverLookupTitle(title));
            // Not cached when AniList was unreachable, so the next screen tries again.
            if (answer === undefined) continue;
            artworkCache.set(normalize(coverLookupTitle(title)), answer || second.get(coverFallbackTitle(title)) || null);
        }
    }

    function artworkFor(title) {
        return artworkCache.get(normalize(coverLookupTitle(title))) || null;
    }

    function toItem(card, withBanner) {
        const languages = [card.hasSub ? "VOSTFR" : null, card.hasDub ? "VF" : null].filter(Boolean);
        const art = artworkFor(card.title);
        return new MultimediaItem({
            title: card.title,
            url: card.url,
            posterUrl: (art && art.cover) || card.posterUrl,
            bannerUrl: (withBanner && art && art.banner) || undefined,
            type: card.kind === KIND.MOVIE ? "movie" : "anime",
            year: card.year || undefined,
            description: languages.join(" + "),
            headers: siteHeaders()
        });
    }

    function toEpisodes(info, dubStatus, posterUrl) {
        return info.episodes.map((ref, index) => {
            const number = ref.number || index + 1;
            return new Episode({
                name: ref.name || ("Épisode " + number),
                url: ref.url,
                season: 1,
                episode: number,
                dubStatus,
                posterUrl: posterUrl || undefined,
                headers: siteHeaders()
            });
        });
    }

    // ---------------------------------------------------------------- home

    async function getHome(cb) {
        try {
            // "Trending" is the app's hero carousel: use the most viewed animes.
            const rows = [{ path: POPULAR_PATH, label: "Trending" }].concat(CATEGORIES);
            const pages = await Promise.all(rows.map(row =>
                // Not cached: refreshing the home page must show the newest episodes.
                getPage(pagedUrl(row.path, 1), false).catch(() => null)
            ));
            const grouped = pages.map(html => html ? groupCards(cards(html, baseUrl())) : []);
            await loadArtwork([].concat(...grouped).map(card => card.title));
            const data = {};
            rows.forEach((row, i) => {
                const items = grouped[i].map(card => toItem(card, row.label === "Trending"));
                if (items.length) data[row.label] = items;
            });
            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Voiranime est indisponible" });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e && e.stack || e) });
        }
    }

    // -------------------------------------------------------------- search

    function searchPageUrl(query, page) {
        const prefix = page <= 1 ? baseUrl() + "/" : baseUrl() + "/page/" + page + "/";
        // Sorting by views puts the main series before its spin-offs and films.
        return prefix + "?s=" + encodeURIComponent(query.trim()) + "&post_type=wp-manga&m_orderby=views";
    }

    /**
     * Fetches the search result pages in parallel, plus the pages whose slug matches the query.
     * The slug lookup finds exact titles that the views-sorted results bury (e.g. "Air").
     */
    async function searchCards(query, maxPages) {
        const s = slug(query);
        const exact = s
            ? Promise.all([baseUrl() + "/anime/" + s + "/", baseUrl() + "/anime/" + s + "-vf/"].map(tryDetail))
            : Promise.resolve([]);
        const first = await getPage(searchPageUrl(query, 1));
        const last = Math.min(lastPage(first), maxPages);
        const others = [];
        for (let page = 2; page <= last; page++) {
            others.push(getPage(searchPageUrl(query, page)).catch(() => ""));
        }
        const all = cards(first, baseUrl());
        for (const html of await Promise.all(others)) all.push(...cards(html, baseUrl()));
        for (const found of await exact) {
            if (found) {
                all.push({
                    title: found.title, url: found.url, posterUrl: found.posterUrl,
                    isDub: found.isDub, kind: found.kind, year: found.year
                });
            }
        }
        const unique = [];
        const seen = new Set();
        for (const card of all) {
            if (!seen.has(card.url)) {
                seen.add(card.url);
                unique.push(card);
            }
        }
        return rankByQuery(unique, query);
    }

    async function search(query, cb) {
        try {
            if (!query || !query.trim()) return cb({ success: true, data: [] });
            const grouped = groupCards(await searchCards(query, SEARCH_PAGES));
            await loadArtwork(grouped.map(card => card.title));
            cb({ success: true, data: grouped.map(card => toItem(card, false)) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message || e) });
        }
    }

    // ---------------------------------------------------------------- load

    /** Finds the other language page (VF <-> VOSTFR) when its slug cannot be guessed. */
    async function findCounterpart(info) {
        try {
            const html = await getPage(searchPageUrl(info.title, 1));
            const match = cards(html, baseUrl()).find(card =>
                card.isDub !== info.isDub && card.url !== info.url && sameAnime(card.title, info.title)
            );
            if (!match) return null;
            const found = await tryDetail(match.url);
            return found && found.isDub !== info.isDub ? found : null;
        } catch (_) {
            return null;
        }
    }

    async function load(url, cb) {
        try {
            // The other language page is usually the same slug with or without "-vf":
            // fetch it at the same time as the requested page.
            const isDubUrl = /-vf$/.test(url.split("?")[0].replace(/\/+$/, ""));
            const guessUrl = counterpartUrl(url, isDubUrl);
            const [info, guessed] = await Promise.all([
                getPage(url).then(html => detail(html, url)),
                guessUrl ? tryDetail(guessUrl) : Promise.resolve(null)
            ]);
            if (!info) return cb({ success: false, errorCode: "NOT_FOUND", message: "Fiche Voiranime introuvable" });

            const counterpart = guessed && guessed.isDub !== info.isDub ? guessed : await findCounterpart(info);
            const pair = [info, counterpart].filter(Boolean);
            const sub = pair.find(x => !x.isDub) || null;
            const dub = pair.find(x => x.isDub) || null;
            const main = sub || info;

            const synonyms = main.synonyms.filter(name => !sameAnime(name, main.title));
            // The card's title first, so the details show the same poster as the catalog.
            const lookups = [main.title].concat(synonyms.filter(name => /[a-z]/i.test(name)));
            await loadArtwork(lookups);
            const art = lookups.map(artworkFor).find(Boolean) || null;
            const posterUrl = (art && art.cover) || main.posterUrl || (dub && dub.posterUrl) || "";

            const episodes = []
                .concat(sub ? toEpisodes(sub, "subbed", posterUrl) : [])
                .concat(dub ? toEpisodes(dub, "dubbed", posterUrl) : []);

            const plot = main.plot || (dub && dub.plot) || "";
            const description = synonyms.length ? plot + (plot ? "\n\n" : "") + "Autres titres : " + synonyms.join(", ") : plot;
            const trailer = main.trailerUrl || (dub && dub.trailerUrl);

            cb({
                success: true,
                data: new MultimediaItem({
                    title: main.title,
                    url,
                    posterUrl,
                    bannerUrl: (art && art.banner) || undefined,
                    type: "anime",
                    year: main.year || (dub && dub.year) || undefined,
                    description,
                    tags: main.genres.length ? main.genres : (dub ? dub.genres : []),
                    status: main.ongoing === true ? "ongoing" : (main.ongoing === false ? "completed" : undefined),
                    trailers: trailer ? [new Trailer({ url: trailer })] : [],
                    headers: siteHeaders(),
                    episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------- streams

    function qualityLabel(quality) {
        return quality ? quality + "p" : "";
    }

    function stream(url, label, headers) {
        return new StreamResult({ url, source: label, headers });
    }

    async function hlsQuality(url, headers) {
        const res = await withTimeout(http_get(url, headers), 4000, null);
        return res && (res.status || res.statusCode) === 200 ? highestHlsQuality(res.body) : null;
    }

    async function loadMailRu(source, language) {
        const id = mailRuId(source.url);
        if (!id) return [];
        const res = await http_get("https://my.mail.ru/+/video/meta/" + id, { "Referer": source.url });
        if (!res || (res.status || res.statusCode) !== 200) return [];
        const meta = JSON.parse(res.body);
        const key = cookieValue(res.headers && (res.headers["set-cookie"] || res.headers["Set-Cookie"]), "video_key");
        const headers = { "Referer": source.url };
        if (key) headers["Cookie"] = "video_key=" + key;
        return (meta.videos || []).map(video => {
            const url = String(video.url || "").startsWith("//") ? "https:" + video.url : String(video.url || "");
            if (!checkedLinkType(url, "video")) return null;
            return stream(url, [source.label, language, video.key].filter(Boolean).join(" · "), headers);
        }).filter(Boolean);
    }

    async function loadPlayerPage(source, pageUrl, language) {
        const res = await http_get(source.url, { "Referer": pageUrl });
        if (!res || (res.status || res.statusCode) !== 200) return [];
        const html = res.body || "";
        // Byse (Filemoon) players are gated by a captcha and cannot be resolved.
        if (html.includes("Byse Frontend")) return [];

        const origin = originOf(source.url);
        const headers = { "Referer": origin + "/", "Origin": origin };

        const tape = /streamtape|tapecontent|watchadsontape|shavetape/i.test(source.url) ? streamtapeUrl(html) : null;
        if (tape) return [stream(tape, [source.label, language].join(" · "), headers)];

        const results = [];
        for (const mediaUrl of extractMediaUrls(html)) {
            const type = checkedLinkType(mediaUrl, /\.m3u8/i.test(mediaUrl) ? "m3u8" : "video");
            if (!type) continue;
            const quality = type === "m3u8" ? (await hlsQuality(mediaUrl, headers)) || qualityFromUrl(mediaUrl) : qualityFromUrl(mediaUrl);
            results.push(stream(mediaUrl, [source.label, language, qualityLabel(quality)].filter(Boolean).join(" · "), headers));
        }
        return results;
    }

    async function loadSource(source, pageUrl, language) {
        if (/(^|\.)mail\.ru\//i.test(source.url.replace(/^https?:\/\//, ""))) return loadMailRu(source, language);
        return loadPlayerPage(source, pageUrl, language);
    }

    async function loadStreams(url, cb) {
        try {
            const res = await http_get(url, siteHeaders());
            if (!res || (res.status || res.statusCode) !== 200) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Épisode introuvable" });
            }
            const language = /\/anime\/[^/]+-vf\/|-vf\/?$/.test(url.split("?")[0]) ? "VF" : "VOSTFR";
            const players = sources(res.body);
            const lists = await Promise.all(players.map(source =>
                withTimeout(loadSource(source, url, language), SOURCE_TIMEOUT_MS, [])
            ));
            const seen = new Set();
            const data = [];
            for (const item of [].concat(...lists)) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    data.push(item);
                }
            }
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
