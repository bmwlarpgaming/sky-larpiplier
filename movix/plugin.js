import {
    HOME_ROWS,
    VERSIONS,
    cards,
    rankByQuery,
    detail,
    seasons,
    seasonEpisodes,
    videos,
    parseTitleUrl,
    episodeUrl,
    playerUrl
} from "./src/parser.js";
import {
    sourceOf,
    voeSources,
    scriptRedirect,
    isVidaraPage,
    vidaraRequest,
    hostName,
    isPlayableMediaUrl
} from "../shared/hosts.js";

(function() {
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    const HOST_TIMEOUT_MS = 15000;
    const PROBE_TIMEOUT_MS = 6000;
    const SEASON_CONCURRENCY = 4;

    function baseUrl() {
        return String(manifest.baseUrl || "https://movix.zip").replace(/\/+$/, "");
    }

    function siteHeaders() {
        return { "User-Agent": USER_AGENT, "Referer": baseUrl() + "/" };
    }

    function statusOf(res) {
        return res && (res.status || res.statusCode) || 0;
    }

    function bodyOf(res) {
        return res && typeof res.body === "string" ? res.body : String(res || "");
    }

    /** `{ status, body, url }`, `url` being where redirects ended when the app tells. */
    async function get(url, headers) {
        try {
            const res = await http_get(url, headers || siteHeaders());
            return { status: statusOf(res), body: bodyOf(res), url: res && (res.finalUrl || res.url) || url };
        } catch (e) {
            return { status: 0, body: "", url };
        }
    }

    async function post(url, headers, body) {
        try {
            const res = await http_post(url, headers, body);
            return { status: statusOf(res), body: bodyOf(res) };
        } catch (e) {
            return { status: 0, body: "" };
        }
    }

    async function getPage(url) {
        const res = await get(url);
        if (res.status !== 200) throw new Error("Movix a répondu " + (res.status || "sans réponse"));
        return res.body;
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
            score: card.score,
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
                const list = cards(pages[i]);
                if (list.length) data[label] = list.map(toItem);
            });
            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "SITE_OFFLINE", message: "Movix est indisponible" });
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
            const html = await getPage(baseUrl() + "/search/" + encodeURIComponent(text));
            cb({ success: true, data: rankByQuery(cards(html), text).map(toItem) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && e.message || e) });
        }
    }

    // --------------------------------------------------------------- load

    /** Episodes of a season, read from its first episode's page (it lists the whole season). */
    async function seasonEpisodeList(slug, season) {
        const res = await get(episodeUrl(baseUrl(), slug, season, 1));
        return res.status === 200 ? seasonEpisodes(res.body, slug, season) : [];
    }

    async function load(url, cb) {
        try {
            const ref = parseTitleUrl(url);
            if (!ref) throw new Error("Lien Movix invalide");
            const html = await getPage(url);
            const info = detail(html);
            if (!info.title) throw new Error("Fiche Movix introuvable");
            const common = {
                title: info.title,
                url,
                posterUrl: info.posterUrl,
                bannerUrl: info.bannerUrl,
                year: info.year,
                description: info.description,
                score: info.score,
                tags: info.tags,
                duration: info.duration,
                trailers: info.trailer ? [new Trailer({ url: info.trailer })] : [],
                headers: siteHeaders()
            };
            if (ref.type === "movie") {
                return cb({ success: true, data: new MultimediaItem(Object.assign({ type: "movie" }, common)) });
            }

            // The title page already lists its current season; the others come from their episode pages.
            const numbers = seasons(html);
            const lists = await mapLimited(numbers, SEASON_CONCURRENCY, season => {
                const listed = seasonEpisodes(html, ref.slug, season);
                return listed.length ? Promise.resolve(listed) : seasonEpisodeList(ref.slug, season);
            });
            const episodes = [].concat(...lists.filter(Boolean)).map(item => new Episode({
                name: item.name,
                url: item.url,
                season: item.season,
                episode: item.episode,
                posterUrl: info.posterUrl || undefined,
                headers: siteHeaders()
            }));
            cb({ success: true, data: new MultimediaItem(Object.assign({ type: "series", episodes }, common)) });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && e.message || e) });
        }
    }

    // ------------------------------------------------------------ streams

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

    /** The embed page, past the "Redirecting..." page Voe's mirrors put first. */
    async function embedPage(url) {
        const headers = { "User-Agent": USER_AGENT, "Referer": baseUrl() + "/" };
        const page = await get(url, headers);
        const next = page.status === 200 && page.body.length < 4000 && scriptRedirect(page.body);
        return next ? get(next, headers) : page;
    }

    /** Vidara's video and subtitles, from its `/api/stream` answer. */
    async function vidaraSource(embed) {
        const request = vidaraRequest(embed);
        if (!request) return null;
        const origin = (/^(https?:\/\/[^/]+)/.exec(embed) || [])[1];
        const res = await post(request.url, {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Referer": embed,
            "Origin": origin
        }, request.body);
        let data;
        try {
            data = JSON.parse(res.body);
        } catch (_) {
            return null;
        }
        if (!data || !data.streaming_url) return null;
        const subtitles = (data.subtitles || []).filter(s => s && s.type === 0 && s.file_path)
            .map(s => ({ url: s.file_path, label: s.language || "Français", lang: "fr" }));
        return { media: data.streaming_url, host: "Vidara", subtitles };
    }

    async function resolve(version, link) {
        const url = playerUrl(link);
        if (!url) return null;
        const page = await embedPage(url);
        if (page.status !== 200) return null;
        const embed = page.url;
        const found = isVidaraPage(page.body)
            ? await vidaraSource(embed)
            : { media: sourceOf(page.body, embed), host: voeSources(page.body) ? "Voe" : hostName(embed), subtitles: [] };
        if (!found || !found.media || !isPlayableMediaUrl(found.media)) return null;

        // Most hosts want their embed as Referer, a few refuse any other: try with, then without.
        const origin = (/^(https?:\/\/[^/]+)/.exec(embed) || [])[1];
        let headers = { "User-Agent": USER_AGENT, "Referer": embed, "Origin": origin };
        let quality = "";
        if (/\.m3u8/i.test(found.media)) {
            let width = await probe(found.media, headers);
            if (width === null) {
                headers = { "User-Agent": USER_AGENT };
                width = await probe(found.media, headers);
            }
            if (width === null) return null;
            quality = widthLabel(width);
        }
        return { version, host: found.host, url: found.media, quality, headers, subtitles: found.subtitles };
    }

    async function loadStreams(url, cb) {
        try {
            const html = await getPage(url);
            const players = videos(html);
            const rank = version => {
                const i = VERSIONS.indexOf(version);
                return i < 0 ? VERSIONS.length : i;
            };
            players.sort((a, b) => rank(a.version) - rank(b.version));
            const results = await Promise.all(players.map(p =>
                withTimeout(resolve(p.version, p.link), HOST_TIMEOUT_MS, null)));
            const seen = new Set();
            const streams = results.filter(Boolean).filter(s => !seen.has(s.url) && seen.add(s.url))
                .map(s => new StreamResult({
                    url: s.url,
                    source: [s.version, s.host, s.quality].filter(Boolean).join(" · "),
                    quality: s.quality || undefined,
                    headers: s.headers,
                    subtitles: s.subtitles.length ? s.subtitles : undefined
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
