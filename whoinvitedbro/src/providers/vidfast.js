import { USER_AGENT, empty, isHttp } from "../util.js";
import { encGet, decPost } from "../encdec.js";

/**
 * Players built on the same engine (VidFast, VidUp): a token in the page, two handshakes through
 * enc-dec.app for the API endpoints and their CSRF token, then encrypted server and stream lists.
 */
export function csrfPlayer(id, name, BASE, codec) {
    return {
    id,
    name,
    anime: false,
    async run(data, http) {
        if (!data.tmdb) return empty();
        const page = data.type === "movie" ? BASE + "/movie/" + data.tmdb : BASE + "/tv/" + data.tmdb + "/" + data.season + "/" + data.episode + "/";
        // The page itself must not look like an XHR: it then answers with an empty shell.
        const pageHeaders = { "User-Agent": USER_AGENT, "Referer": BASE + "/" };
        const headers = Object.assign({ "X-Requested-With": "XMLHttpRequest" }, pageHeaders);
        const token = /\\?"(?:en|token)\\?"\s*:\s*\\?"([^\\"]+)\\?"/.exec((await http.get(page, pageHeaders)).body || "");
        if (!token) return empty();

        // Two handshakes give the servers and stream endpoints, each with its CSRF token.
        const stage1 = await encGet(http, "enc-" + codec, { text: token[1], stage: 1 });
        if (!stage1 || !stage1.stage1) return empty();
        const handshake = (await http.post(stage1.stage1, Object.assign({}, headers, { "X-CSRF-Token": stage1.token }), "")).body;
        const stage2 = handshake && await encGet(http, "enc-" + codec, { text: handshake, stage: 2 });
        if (!stage2 || !stage2.servers) return empty();
        const apiHeaders = Object.assign({}, headers, { "X-CSRF-Token": stage2.token });

        const encrypted = (await http.post(stage2.servers, apiHeaders, "")).body;
        const servers = encrypted ? await decPost(http, "dec-" + codec, { text: encrypted }) : null;
        if (!Array.isArray(servers)) return empty();

        const streams = [];
        const subtitles = [];
        await Promise.all(servers.map(async (server, i) => {
            if (!server || !server.data) return;
            const body = (await http.post(stage2.stream + "/" + server.data, apiHeaders, "")).body;
            const stream = body ? await decPost(http, "dec-" + codec, { text: body }) : null;
            if (!stream || !isHttp(stream.url)) return;
            streams.push({ url: stream.url, source: name + " " + (server.name || "Server " + (i + 1)), quality: "", headers: { "Referer": BASE + "/", "Origin": BASE } });
            for (const track of stream.tracks || []) {
                if (track && isHttp(track.file) && track.label) subtitles.push({ url: track.file, label: track.label, lang: "" });
            }
        }));
        streams.sort((a, b) => a.source.localeCompare(b.source));
        return { streams, subtitles };
    }
    };
}

export default csrfPlayer("vidfast", "VidFast", "https://vidfast.vc", "vidfast");
