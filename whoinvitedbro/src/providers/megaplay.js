import { USER_AGENT, empty, parseJson, isHttp, languageName } from "../util.js";
import { decPost } from "../encdec.js";

const BASE = "https://megaplay.buzz";

/** MegaPlay, the player behind HiAnime and its clones: looked up by MyAnimeList id, sub and dub. */
export default {
    id: "megaplay",
    name: "MegaPlay",
    anime: true,
    async run(data, http) {
        if (!data.mal) return empty();
        const episode = data.type === "movie" ? 1 : data.episode;
        const headers = { "User-Agent": USER_AGENT, "Origin": BASE, "Referer": BASE + "/" };
        const streams = [];
        const subtitles = [];
        await Promise.all(["sub", "dub"].map(async version => {
            const page = (await http.get(BASE + "/stream/mal/" + data.mal + "/" + episode + "/" + version, headers)).body || "";
            const id = /<title>File (\d+) - MegaPlay<\/title>/.exec(page);
            if (!id) return;
            const sources = parseJson((await http.get(BASE + "/stream/getSources?id=" + id[1] + "&platform=OTHER", headers)).body);
            const decrypted = sources && sources.enc ? await decPost(http, "dec-megaplay", { text: sources.enc }) : null;
            if (!decrypted || !isHttp(decrypted.file)) return;
            streams.push({ url: decrypted.file, source: "MegaPlay (" + (version === "dub" ? "Dub" : "Sub") + ")", quality: "", headers: { "Referer": BASE + "/", "Origin": BASE }, dubbed: version === "dub" });
            for (const track of sources.tracks || []) {
                if (track && isHttp(track.file) && track.kind !== "thumbnails") subtitles.push({ url: track.file, label: languageName(track.label), lang: "" });
            }
        }));
        return { streams, subtitles };
    }
};
