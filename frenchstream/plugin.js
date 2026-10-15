import {
    HOME_ROWS,
    VERSIONS,
    cards,
    uniqueShows,
    rankByQuery,
    detail,
    seasonRefs,
    contentId,
    movieLinks,
    movieMeta,
    seasonEpisodes,
    largeImage,
    titleKey,
    verificationCookie
} from "./src/parser.js";
import { sourceOf, hostName, hostOf, isPlayableMediaUrl } from "./src/hosts.js";

(function() {
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    const HOST_TIMEOUT_MS = 15000;
    const PROBE_TIMEOUT_MS = 6000;
    const SEASON_CONCURRENCY = 4;
    /** Hosts that only send placeholders or need a browser: not worth a request. */
    const SKIPPED_HOSTS = /(^|\.)(trakx\.lol|multiup\.us)$/;

    function baseUrl() {
        return String(manifest.baseUrl || "https://french-stream.net").replace(/\/+$/, "");
    }

    /** The anti-robot check's cookie, once the site asked for it. */
    let siteCookie = null;

    function siteHeaders() {
        const headers = { "User-Agent": USER_AGENT, "Referer": baseUrl() + "/" };
        if (siteCookie) headers["Cookie"] = siteCookie;
        return headers;
    }

    function statusOf(res) {
        return res && (res.status || res.statusCode) || 0;
    }

    function bodyOf(res) {
        return res && typeof res.body === "string" ? res.body : String(res || "");
    }

    async function fetchOnce(url, headers) {
        try {
            const res = await http_get(url, headers);
            return { status: statusOf(res), body: bodyOf(res) };
        } catch (e) {
            return { status: 0, body: "" };
        }
    }

    /** A request to the site (or `headers` for another host), passing its anti-robot check. */
    async function get(url, headers) {
        const res = await fetchOnce(url, headers || siteHeaders());
        const cookie = !headers && verificationCookie(res.body);
        if (!cookie) return res;
        siteCookie = cookie;
        return fetchOnce(url, siteHeaders());
    }

    async function getPage(url) {
        const res = await get(url);
        if (res.status !== 200) throw new Error("French-Stream a répondu " + (res.status || "sans réponse"));
        return res.body;
    }

    async function getJson(url) {
        // Answers that are not JSON (an error page, the anti-robot check) give null.
        const res = await get(url);
        try {
            return res.status === 200 ? JSON.parse(res.body) : null;
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

    async function mapLimited(items, limit, fn) {
        const results = new Array(items.length);
        let next = 0;
        async function worker() {
            while (next < items.length) {
                const i = next++;
                results[i] = await fn(items[i], i).catch(() => undefined);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return results;
    }

    function toItem(card) {
        return new MultimediaItem({
            title: card.title,
            url: card.url,
            posterUrl: card.posterUrl,
            type: card.type,
            year: card.year,
            headers: siteHeaders()
        });
    }

    // --------------------------------------------------------------- home

    async function getHome(cb) {
        try {
            const pages = await Promise.all(HOME_ROWS.map(([path]) =>
                get(baseUrl() + "/" + path).then(res => res.status === 200 ? res.body : "")));
            const data = {};
            HOME_ROWS.forEach(([, label], i) => {
                const list = uniqueShows(cards(pages[i], baseUrl()));
                if (list.length) data[label] = list.map(toItem);
            });
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "French-Stream est indisponible" });
            }
            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "SITE_OFFLINE", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------- search

    async function search(query, cb) {
        try {
            const text = String(query || "").trim();
            if (!text) return cb({ success: true, data: [] });
            const html = await getPage(baseUrl() + "/?do=search&subaction=search&story=" + encodeURIComponent(text));
            cb({ success: true, data: rankByQuery(uniqueShows(cards(html, baseUrl())), text).map(toItem) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message || e) });
        }
    }

    // --------------------------------------------------------------- load

    /** Every season page of a show: the site's season list, else a search, plus the current page. */
    async function seasonPages(info, url) {
        let refs = [];
        const newsId = info.newsId || contentId(url);
        if (info.tag && newsId) {
            const list = await getJson(baseUrl() + "/engine/ajax/get_seasons.php?serie_tag=" +
                encodeURIComponent(info.tag) + "&news_id=" + encodeURIComponent(newsId));
            refs = seasonRefs(list, baseUrl(), info.title);
        }
        if (!refs.length) {
            const html = (await get(baseUrl() + "/?do=search&subaction=search&story=" + encodeURIComponent(info.title))).body;
            refs = cards(html, baseUrl())
                .filter(card => card.type === "series" && card.season && titleKey(card.title) === titleKey(info.title))
                .map(card => ({ season: card.season, url: card.url }));
        }
        const all = refs.concat([{ season: info.season || 1, url }]);
        const bySeason = new Map(all.map(ref => [ref.season, ref]));
        return Array.from(bySeason.values()).sort((a, b) => a.season - b.season);
    }

    async function seasonEpisodeList(ref) {
        const id = contentId(ref.url);
        const json = id ? await getJson(baseUrl() + "/ep-data.php?id=" + id) : null;
        return seasonEpisodes(json).map(item => Object.assign({ season: ref.season }, item));
    }

    async function load(url, cb) {
        try {
            const html = await getPage(url);
            const info = detail(html);
            if (!info.siteTitle) throw new Error("Fiche French-Stream introuvable");

            if (!info.isSeries) {
                const id = contentId(url);
                const api = id ? await getJson(baseUrl() + "/engine/ajax/film_api.php?id=" + id) : null;
                const meta = movieMeta(api);
                return cb({
                    success: true,
                    data: new MultimediaItem({
                        title: info.title,
                        url,
                        posterUrl: meta.posterUrl || "",
                        bannerUrl: meta.bannerUrl,
                        type: "movie",
                        year: info.year || undefined,
                        description: info.description,
                        tags: info.tags,
                        contentRating: info.contentRating,
                        duration: info.duration,
                        cast: meta.cast.map(c => new Actor(c)),
                        trailers: meta.trailer ? [new Trailer({ url: "https://www.youtube.com/watch?v=" + meta.trailer })] : [],
                        syncData: meta.tag && meta.tag.startsWith("f-") ? { tmdb: meta.tag.slice(2) } : undefined,
                        headers: siteHeaders()
                    })
                });
            }

            const refs = await seasonPages(info, url);
            const seasons = await mapLimited(refs, SEASON_CONCURRENCY, seasonEpisodeList);
            const poster = largeImage(info.posterUrl);
            // One entry per version: the apps show a VF/VOSTFR switch.
            const episodes = [];
            for (const item of [].concat(...seasons.filter(Boolean))) {
                for (const [version, dubStatus] of [["VF", "dubbed"], ["VOSTFR", "subbed"]]) {
                    const links = item.links[version];
                    if (!links || !links.length) continue;
                    episodes.push(new Episode({
                        name: item.name,
                        url: JSON.stringify({ version, links }),
                        season: item.season,
                        episode: item.episode,
                        description: item.description,
                        posterUrl: item.posterUrl || poster || undefined,
                        dubStatus,
                        headers: siteHeaders()
                    }));
                }
            }
            cb({
                success: true,
                data: new MultimediaItem({
                    title: info.title,
                    url,
                    posterUrl: poster,
                    type: "series",
                    year: info.year || undefined,
                    description: info.description,
                    tags: info.tags,
                    contentRating: info.contentRating,
                    duration: info.duration,
                    trailers: info.trailer ? [new Trailer({ url: "https://www.youtube.com/watch?v=" + info.trailer })] : [],
                    syncData: info.tag && info.tag.startsWith("s-") ? { tmdb: info.tag.slice(2) } : undefined,
                    episodes,
                    headers: siteHeaders()
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------ streams

    /** The players to try: an episode's (JSON) or a movie's (from its film_api.php). */
    async function playerLinks(url) {
        if (String(url).trim().startsWith("{")) {
            const data = JSON.parse(url);
            return { [data.version]: data.links || [] };
        }
        const id = contentId(url);
        if (!id) throw new Error("Lien French-Stream invalide");
        return movieLinks(await getJson(baseUrl() + "/engine/ajax/film_api.php?id=" + id));
    }

    /** Width of the best rendition of a playlist, 0 when it has none, null when it does not load. */
    async function probe(url, headers) {
        const res = await withTimeout(get(url, headers), PROBE_TIMEOUT_MS, null);
        if (!res || res.status < 200 || res.status >= 300 || !/#EXTM3U/.test(res.body)) return null;
        let max = 0;
        for (const m of res.body.matchAll(/RESOLUTION\s*=\s*(\d+)x\d+/gi)) max = Math.max(max, parseInt(m[1], 10));
        return max;
    }

    function widthLabel(width) {
        if (width >= 3200) return "4K";
        if (width >= 1700) return "1080p";
        if (width >= 1100) return "720p";
        if (width >= 760) return "480p";
        return width ? "360p" : "";
    }

    async function resolve(version, embed) {
        if (SKIPPED_HOSTS.test(hostOf(embed))) return null;
        const res = await get(embed, { "User-Agent": USER_AGENT, "Referer": baseUrl() + "/" });
        if (res.status !== 200) return null;
        const media = sourceOf(res.body, embed);
        if (!media || !isPlayableMediaUrl(media)) return null;
        const origin = (/^(https?:\/\/[^/]+)/.exec(embed) || [])[1];
        const headers = { "User-Agent": USER_AGENT, "Referer": embed, "Origin": origin };
        let quality = "";
        if (/\.m3u8/i.test(media)) {
            const width = await probe(media, headers);
            if (width === null) return null;
            quality = widthLabel(width);
        }
        return { version, host: hostName(embed), url: media, quality, headers };
    }

    async function loadStreams(url, cb) {
        try {
            const links = await playerLinks(url);
            const jobs = [];
            for (const version of VERSIONS) {
                for (const embed of links[version] || []) jobs.push([version, embed]);
            }
            const results = await Promise.all(jobs.map(([version, embed]) =>
                withTimeout(resolve(version, embed), HOST_TIMEOUT_MS, null)));
            const seen = new Set();
            const streams = results.filter(Boolean).filter(s => !seen.has(s.url) && seen.add(s.url))
                .map(s => new StreamResult({
                    url: s.url,
                    source: [s.version, s.host, s.quality].filter(Boolean).join(" · "),
                    quality: s.quality || undefined,
                    headers: s.headers
                }));
            if (!streams.length) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "Aucun lecteur disponible pour ce titre" });
            }
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && e.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
