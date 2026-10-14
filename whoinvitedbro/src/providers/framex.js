import { USER_AGENT, empty, parseJson, isHttp, qualityLabel, mapLimit } from "../util.js";

const API = "https://api.framextv.tech/api/stream";
const SITE = "https://framextv.tech";
/**
 * FrameX's providers. It has about twenty names, but each falls back to another backend when its
 * own has nothing, and they land on these few: asking the others only repeats them, slowly.
 */
const PROVIDERS = ["super_barbarian", "bowler", "miner", "headhunter"];

function title(server) {
    return String(server || "").replace(/\b\w/g, c => c.toUpperCase());
}

export default {
    id: "framex",
    name: "FrameX",
    anime: false,
    async run(data, http) {
        if (!data.tmdb) return empty();
        const query = "type=" + (data.type === "movie" ? "movie" : "tv") + "&id=" + data.tmdb +
            (data.type === "movie" ? "" : "&season=" + data.season + "&episode=" + data.episode);
        const headers = { "User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*", "Referer": SITE + "/" };
        const seen = new Set();
        const streams = [];
        await mapLimit(PROVIDERS, 4, async provider => {
            const json = parseJson((await http.get(API + "?" + query + "&provider=" + provider, headers)).body);
            if (!json || !json.success) return;
            for (const source of json.sources || []) {
                if (!source || !isHttp(source.url) || seen.has(source.url) || source.type === "dash" || /\.mpd(\?|$)/.test(source.url)) continue;
                seen.add(source.url);
                const extra = source.headers || {};
                streams.push({
                    url: source.url,
                    source: "FrameX " + (source.server || title(json.provider || provider)),
                    quality: qualityLabel(source.quality),
                    headers: Object.keys(extra).length ? extra : { "Referer": SITE + "/" }
                });
            }
        });
        // Its subtitles are OpenSubtitles', already offered.
        return { streams, subtitles: [] };
    }
};
