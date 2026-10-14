import { USER_AGENT, empty, parseJson, qualityLabel, simplify } from "../util.js";

const SITE = "https://animex.one";
const GRAPHQL = "https://graphql.animex.one/graphql";
const API = "https://pp.animex.one/rest/api";

/** The Animex entry of a title: the one with the same AniList/MAL id, else by name. */
export function match(items, data) {
    const list = items || [];
    const title = simplify(data.title);
    return list.find(it => data.anilist && it.anilistId === data.anilist)
        || list.find(it => data.mal && it.malId === data.mal)
        || list.find(it => [it.titleEnglish, it.titleRomaji].some(t => simplify(t) === title))
        || null;
}

export default {
    id: "animex",
    name: "Animex",
    anime: true,
    async run(data, http) {
        if (!data.title) return empty();
        const headers = { "Origin": SITE, "Referer": SITE + "/", "User-Agent": USER_AGENT, "Content-Type": "application/json" };
        const query = "query FastSearch($query: String, $limit: Int) { catalogAnime(filter: { query: $query }, limit: $limit) " +
            "{ items { id anilistId malId titleRomaji titleEnglish format } } }";
        const search = await http.post(GRAPHQL, headers, JSON.stringify({ query, variables: { query: data.title, limit: 10 } }));
        const anime = match((((parseJson(search.body) || {}).data || {}).catalogAnime || {}).items, data);
        if (!anime) return empty();

        const episode = data.type === "movie" ? 1 : data.episode;
        const servers = parseJson((await http.get(API + "/servers?id=" + anime.id + "&epNum=" + episode, headers)).body) || {};
        const requests = [];
        for (const [type, list] of [["sub", servers.subProviders], ["dub", servers.dubProviders]]) {
            for (const provider of list || []) requests.push({ type, provider });
        }
        const results = await Promise.all(requests.map(async ({ type, provider }) => {
            const res = await http.get(API + "/sources?id=" + anime.id + "&epNum=" + episode + "&type=" + type + "&providerId=" + provider.id, headers);
            const json = parseJson(res.body) || {};
            const referer = (json.headers || {}).Referer || SITE + "/";
            const label = type === "dub" ? "Dub" : "Sub";
            return {
                streams: (json.sources || []).filter(s => s && s.url).map(s => ({
                    url: s.url,
                    source: "Animex " + provider.id.charAt(0).toUpperCase() + provider.id.slice(1) + " (" + label + ")",
                    quality: qualityLabel(s.quality),
                    headers: { "Referer": referer },
                    dubbed: type === "dub"
                })),
                subtitles: (json.tracks || []).filter(t => t && (t.url || t.file) && t.kind !== "thumbnails")
                    .map(t => ({ url: t.url || t.file, label: t.label || t.lang || "Unknown", lang: t.lang || "" }))
            };
        }));
        return {
            streams: [].concat(...results.map(r => r.streams)),
            subtitles: [].concat(...results.map(r => r.subtitles))
        };
    }
};
