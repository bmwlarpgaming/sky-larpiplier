// Catalog and metadata, from AIOMetadata (a public Stremio metadata service backed by TMDB,
// TVDB and MAL, the one StreamPlay uses): no API key. Pure functions, testable with node.

export const AIO_BASE = "https://aiometadata.elfhosted.com/stremio/b7cb164b-074b-41d5-b458-b3a834e197bb";

/** Home rows read from AIOMetadata catalogs. The first one is the hero carousel. */
export const HOME_ROWS = [
    { label: "Trending", catalogs: [["movie", "tmdb.trending"], ["series", "tmdb.trending"]] },
    { label: "Popular Movies", catalogs: [["movie", "tmdb.top"]] },
    { label: "Popular TV Shows", catalogs: [["series", "tmdb.top"]] },
    { label: "Airing Today", catalogs: [["series", "tmdb.airing_today"]] },
    { label: "Airing Anime", catalogs: [["anime", "mal.airing"]] },
    { label: "Top Rated Movies", catalogs: [["movie", "tmdb.top_rated"]] },
    { label: "Top Rated TV Shows", catalogs: [["series", "tmdb.top_rated"]] },
    { label: "Popular Anime", catalogs: [["anime", "mal.most_popular"]] },
    { label: "Top Anime", catalogs: [["anime", "mal.top_anime"]] }
];

/** Search catalogs: movies, series, then anime (whose results carry MAL/Kitsu ids). */
export const SEARCH_CATALOGS = [
    ["movie", "search.movie"],
    ["series", "search.series"],
    ["anime.series", "search.anime_series"],
    ["anime.movie", "search.anime_movie"]
];

export function catalogUrl(base, type, catalog, extra) {
    const suffix = extra ? "/" + Object.entries(extra).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&") : "";
    return base + "/catalog/" + type + "/" + catalog + suffix + ".json";
}

export function metaUrl(base, type, id) {
    return base + "/meta/" + type + "/" + encodeURIComponent(id) + ".json";
}

// ------------------------------------------------------------------ item URLs

/** Item URL kept by the app: "movie/tt1375666", "series/mal:52991". */
export function itemUrl(type, id) {
    return (type === "movie" ? "movie" : "series") + "/" + id;
}

export function parseItemUrl(url) {
    const match = /^(movie|series)\/(.+)$/.exec(String(url || ""));
    return match ? { type: match[1], id: match[2] } : null;
}

// --------------------------------------------------------------------- cards

export function yearOf(value) {
    const match = /(\d{4})/.exec(String(value || ""));
    return match ? parseInt(match[1], 10) : null;
}

function score(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** "2h28min", "48min", "24 min" -> minutes. */
export function runtimeMinutes(value) {
    const text = String(value || "");
    const hours = /(\d+)\s*h/.exec(text);
    const minutes = /(\d+)\s*min/.exec(text);
    const total = (hours ? parseInt(hours[1], 10) * 60 : 0) + (minutes ? parseInt(minutes[1], 10) : 0);
    return total || null;
}

/** Anime: MAL/Kitsu/AniList ids, or Japanese animation. */
export function isAnime(meta) {
    if (/^(mal|kitsu|anilist|anidb):/.test(meta.id || "") || meta._malId || meta._anilistId) return true;
    const genres = (meta.genres || []).map(g => String(g).toLowerCase());
    const country = String(meta.country || "").toLowerCase();
    return genres.includes("animation") && /^(jp|jpn|japan)$/.test(country);
}

/** A catalog entry as a card: { title, url, posterUrl, type, year, score, description, bannerUrl }. */
export function cardFromMeta(meta) {
    if (!meta || !meta.id || !meta.name) return null;
    const type = meta.type === "movie" ? "movie" : "series";
    return {
        title: meta.name,
        url: itemUrl(type, meta.id),
        posterUrl: meta.poster || "",
        bannerUrl: meta.background || undefined,
        type: type === "movie" ? "movie" : (isAnime(meta) ? "anime" : "series"),
        year: yearOf(meta.releaseInfo || meta.year),
        score: score(meta.imdbRating),
        description: meta.description || undefined
    };
}

/** Several catalogs interleaved (trending movies and shows), without duplicates. */
export function interleave(lists) {
    const out = [];
    const seen = new Set();
    const longest = Math.max(0, ...lists.map(list => list.length));
    for (let i = 0; i < longest; i++) {
        for (const list of lists) {
            const card = list[i];
            if (card && !seen.has(card.url)) {
                seen.add(card.url);
                out.push(card);
            }
        }
    }
    return out;
}

export function normalize(value) {
    let s = String(value || "");
    try {
        s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    } catch (_) {
        // Engines without Unicode normalization: keep accents.
    }
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Search results: exact titles first, then titles starting with the query, then the services' order. */
export function rankByQuery(cards, query) {
    const q = normalize(query);
    const rank = card => {
        const title = normalize(card.title);
        if (title === q) return 0;
        if (title.startsWith(q)) return 1;
        return 2;
    };
    return cards.map((card, i) => ({ card, i, r: rank(card) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.card);
}

// ------------------------------------------------------------------- details

/**
 * What the sources need to find a title: ids, titles, season and episode.
 * `type` is "movie" or "tv"; `anime` routes the title to the anime sources.
 */
export function linkData(meta, video) {
    const anime = isAnime(meta);
    const data = {
        type: meta.type === "movie" ? "movie" : "tv",
        tmdb: parseInt(meta._tmdbId || meta.moviedb_id, 10) || null,
        imdb: meta.imdb_id || meta._imdbId || (/^tt\d+$/.test(meta.id) ? meta.id : null),
        title: meta.name,
        year: yearOf(meta.year || meta.releaseInfo),
        anime
    };
    if (anime) {
        data.mal = parseInt(meta._malId, 10) || null;
        data.anilist = parseInt(meta._anilistId, 10) || null;
    }
    if (video) {
        data.season = video.season;
        data.episode = video.episode;
        data.airDate = video.released ? String(video.released).slice(0, 10) : null;
    }
    return data;
}

function isUpcoming(released, now) {
    const time = Date.parse(released || "");
    return Number.isFinite(time) && time > now;
}

/** Episodes of a series, in season order; specials (season 0) last. */
export function episodesFromMeta(meta, now) {
    const videos = (meta.videos || []).filter(v => Number.isFinite(v.season) && Number.isFinite(v.episode));
    videos.sort((a, b) => ((a.season || 1000) - (b.season || 1000)) || (a.episode - b.episode));
    return videos.map(video => ({
        name: (video.title || video.name || "Episode " + video.episode) + (isUpcoming(video.released, now) ? " • Upcoming" : ""),
        url: JSON.stringify(linkData(meta, video)),
        season: video.season,
        episode: video.episode,
        posterUrl: video.thumbnail || undefined,
        description: video.overview || undefined,
        airDate: video.released ? String(video.released).slice(0, 10) : undefined,
        runtime: runtimeMinutes(video.runtime) || undefined
    }));
}

/** Everything the title page shows, except episodes. */
export function detailFromMeta(meta) {
    const extras = meta.app_extras || {};
    const status = String(meta.status || "").toLowerCase();
    return {
        title: meta.name,
        posterUrl: meta.poster || "",
        bannerUrl: meta.background || undefined,
        logoUrl: meta.logo || undefined,
        type: meta.type === "movie" ? "movie" : (isAnime(meta) ? "anime" : "series"),
        year: yearOf(meta.year || meta.releaseInfo),
        score: score(meta.imdbRating),
        duration: runtimeMinutes(meta.runtime) || undefined,
        description: meta.description || undefined,
        tags: (meta.genres || []).map(String),
        status: /ended|canceled|cancelled|released/.test(status) ? "completed"
            : (/continuing|returning|airing|production/.test(status) ? "ongoing" : undefined),
        contentRating: extras.certification || undefined,
        cast: (extras.cast || []).filter(c => c && c.name).slice(0, 30)
            .map(c => ({ name: c.name, role: c.character || undefined, image: c.photo || undefined })),
        trailers: (meta.trailers || []).map(t => t.ytId || t.source).filter(Boolean)
            .map(id => "https://www.youtube.com/watch?v=" + id),
        syncData: {
            imdb: meta.imdb_id || meta._imdbId || undefined,
            tmdb: meta._tmdbId || undefined,
            mal: meta._malId || undefined,
            anilist: meta._anilistId || undefined
        }
    };
}
