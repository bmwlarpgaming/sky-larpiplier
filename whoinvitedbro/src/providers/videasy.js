import { USER_AGENT, empty, parseJson, isHttp, qualityLabel, mapLimit, languageName } from "../util.js";
import { decPost } from "../encdec.js";

const API = "https://api.wecollege.net";
const PLAYER = "https://player.videasy.to";
/** Servers and their audio language. */
const SERVERS = [
    ["miami", ""], ["boise", ""], ["vegas", ""], ["reno", ""], ["oakland", ""], ["seattle", ""], ["phoenix", ""],
    ["atlanta", ""], ["portland", ""], ["austin", ""], ["dallas", ""], ["tampa", ""], ["orlando", ""],
    ["munich", "German"], ["berlin", "German"], ["paris", "French"], ["delhi", "Hindi"], ["cancun", "Spanish"]
];

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export default {
    id: "videasy",
    name: "Videasy",
    anime: false,
    async run(data, http) {
        if (!data.tmdb || !data.title) return empty();
        const headers = { "User-Agent": USER_AGENT, "Origin": PLAYER, "Referer": PLAYER + "/", "Accept": "*/*" };
        const seed = (parseJson((await http.get(API + "/seed?mediaId=" + data.tmdb, headers)).body) || {}).seed;
        if (!seed) return empty();

        const title = encodeURIComponent(encodeURIComponent(data.title));
        const query = "title=" + title + "&mediaType=" + (data.type === "movie" ? "movie" : "tv") + "&year=" + (data.year || "") +
            (data.type === "movie" ? "" : "&episodeId=" + data.episode + "&seasonId=" + data.season) +
            "&tmdbId=" + data.tmdb + "&imdbId=" + (data.imdb || "") + "&enc=2&seed=" + encodeURIComponent(seed);

        const streams = [];
        const subtitles = [];
        await mapLimit(SERVERS, 6, async ([server, language]) => {
            const extra = server === "munich" ? "&language=german" : "";
            const encrypted = (await http.get(API + "/" + server + "/sources?" + query + extra, headers)).body;
            if (!encrypted || encrypted.length < 20 || encrypted.charAt(0) === "{") return;
            const result = await decPost(http, "dec-videasy", { text: encrypted, id: String(data.tmdb), seed });
            if (!result) return;
            const name = "Videasy " + capitalize(server) + (language ? " (" + language + ")" : "");
            for (const source of result.sources || []) {
                if (source && isHttp(source.url)) {
                    streams.push({ url: source.url, source: name, quality: qualityLabel(source.quality), headers: { "Origin": PLAYER, "Referer": PLAYER + "/" } });
                }
            }
            for (const sub of result.subtitles || []) {
                if (sub && isHttp(sub.url)) subtitles.push({ url: sub.url, label: languageName(sub.language || sub.lang || sub.label), lang: sub.lang || "" });
            }
        });
        return { streams, subtitles };
    }
};
