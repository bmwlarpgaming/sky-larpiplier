// enc-dec.app: a free public service that encrypts and decrypts the tokens of several players
// (VidFast, Videasy, Cinejoy…), kept up to date by its author as the players change.
// See https://github.com/smy778/EncDecEndpoints for its endpoints.
import { parseJson } from "./util.js";

export const ENC_DEC = "https://enc-dec.app/api";

/** The `result` of an enc-dec.app answer, or null. */
export function result(res) {
    const json = parseJson(res && res.body);
    return json && json.status === 200 ? json.result : null;
}

export async function encGet(http, path, params) {
    const query = Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    return result(await http.get(ENC_DEC + "/" + path + "?" + query, {}));
}

export async function decPost(http, path, body) {
    return result(await http.post(ENC_DEC + "/" + path, { "Content-Type": "application/json" }, JSON.stringify(body)));
}
