import { USER_AGENT, empty, parseJson, isHttp } from "../util.js";

const API = "https://streamdata.vaplayer.ru/api.php";
const REFERER = "https://nextgencloudfabric.com/";

export default {
    id: "vaplayer",
    name: "Vaplayer",
    anime: false,
    async run(data, http) {
        if (!data.tmdb) return empty();
        const url = data.type === "movie"
            ? API + "?tmdb=" + data.tmdb + "&type=movie"
            : API + "?tmdb=" + data.tmdb + "&type=tv&season=" + data.season + "&episode=" + data.episode;
        const json = parseJson((await http.get(url, { "User-Agent": USER_AGENT, "Referer": REFERER })).body) || {};
        const urls = ((json.data || {}).stream_urls) || [];
        return {
            streams: urls.filter(isHttp).map((u, i) => ({ url: u, source: "Vaplayer " + (i + 1), quality: "", headers: { "Referer": REFERER } })),
            subtitles: (json.default_subs || []).filter(s => s && s.url)
                .map(s => ({ url: s.url, label: s.lang || s.code || "Unknown", lang: s.code || "" }))
        };
    }
};
