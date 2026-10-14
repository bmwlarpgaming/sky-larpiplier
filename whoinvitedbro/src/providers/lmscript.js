import { USER_AGENT, empty, parseJson, isHttp, qualityLabel, simplify } from "../util.js";

const BASE = "https://lmscript.xyz";

/** Movies only: the search result with the same TMDB id, else the same title and year. */
export function pick(items, data) {
    const list = items || [];
    return list.find(it => data.tmdb && it.tmdb_prefix === data.tmdb)
        || list.find(it => simplify(it.title) === simplify(data.title) && (!data.year || it.year === data.year))
        || null;
}

export default {
    id: "lmscript",
    name: "LMScript",
    anime: false,
    async run(data, http) {
        if (data.type !== "movie" || !data.title) return empty();
        const url = BASE + "/v1/movies?filters%5Bq%5D=" + encodeURIComponent(data.title) + "&expand=streams";
        const movie = pick((parseJson((await http.get(url, { "User-Agent": USER_AGENT, "Accept": "application/json" })).body) || {}).items, data);
        if (!movie || !movie.streams) return empty();
        return {
            streams: Object.entries(movie.streams).filter(([, u]) => isHttp(u))
                .map(([quality, u]) => ({ url: u, source: "LMScript", quality: qualityLabel(quality), headers: { "Referer": BASE + "/" } })),
            subtitles: []
        };
    }
};
