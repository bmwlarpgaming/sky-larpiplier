import { USER_AGENT, empty, parseJson, languageName } from "../util.js";

const BASE = "https://opensubtitles-v3.strem.io";

/** OpenSubtitles through its Stremio addon: one subtitle per language, the best rated first. */
export default {
    id: "opensubtitles",
    name: "OpenSubtitles",
    subtitles: true,
    async run(data, http) {
        if (!data.imdb) return empty();
        const url = data.type === "movie"
            ? BASE + "/subtitles/movie/" + data.imdb + ".json"
            : BASE + "/subtitles/series/" + data.imdb + ":" + data.season + ":" + data.episode + ".json";
        const list = ((parseJson((await http.get(url, { "User-Agent": USER_AGENT })).body) || {}).subtitles) || [];
        const seen = new Set();
        const subtitles = [];
        for (const sub of list) {
            if (!sub.url || seen.has(sub.lang)) continue;
            seen.add(sub.lang);
            subtitles.push({ url: sub.url, label: languageName(sub.lang), lang: sub.lang });
        }
        return { streams: [], subtitles };
    }
};
