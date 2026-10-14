import { USER_AGENT, empty, parseJson, isHttp, languageName } from "../util.js";

const API = "https://core.vidzee.wtf";
const PLAYER = "https://player.vidzee.wtf";
/** Servers, with their display names; "v4" has one stream per audio language. */
const SERVERS = [["dcloud", "Dcloud"], ["doppler", "Doppler"], ["ipcloud", "IPcloud"], ["tik", "TCloud"],
    ["v6:English", "Server English"], ["v6:Hindi", "Server Hindi"]];

export default {
    id: "vidzee",
    name: "Vidzee",
    anime: false,
    async run(data, http) {
        if (!data.tmdb) return empty();
        const path = data.type === "movie" ? "movie/" + data.tmdb : "tv/" + data.tmdb + "/" + data.season + "/" + data.episode;
        const headers = { "User-Agent": USER_AGENT, "Origin": PLAYER, "Referer": PLAYER + "/" };

        const [languages, subs] = await Promise.all([
            http.get(API + "/streams/languages/" + path, headers).then(res => (parseJson(res.body) || {}).languages || []),
            http.get(API + "/subs/" + path, headers).then(res => parseJson(res.body))
        ]);
        const servers = SERVERS.concat(languages.map(lang => ["v4:" + lang, "Acme (" + lang + ")"]));

        const streams = [];
        await Promise.all(servers.map(async ([server, label]) => {
            // Without `e=1` the API answers in clear.
            const json = parseJson((await http.get(API + "/streams/" + path + "?s=" + encodeURIComponent(server), headers)).body);
            if (!json || !isHttp(json.url)) return;
            const extra = json.headers || {};
            const referer = extra.Referer || extra.referer || PLAYER + "/";
            streams.push({
                url: json.url,
                source: "Vidzee " + label,
                quality: "",
                headers: Object.assign({ "Referer": referer, "Origin": PLAYER }, extra)
            });
        }));
        streams.sort((a, b) => a.source.localeCompare(b.source));

        const subtitles = (Array.isArray(subs) ? subs : []).filter(s => s && isHttp(s.file || s.url))
            .map(s => ({ url: s.file || s.url, label: languageName(s.label || s.lang), lang: s.lang || "" }));
        return { streams, subtitles };
    }
};
