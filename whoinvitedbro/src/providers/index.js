// Every source, in display order: the most reliable first. Anime-only sources run for anime,
// the others for everything else; subtitle sources run for all.
import bingebang from "./bingebang.js";
import vidrock from "./vidrock.js";
import vidfast from "./vidfast.js";
import vidup from "./vidup.js";
import videasy from "./videasy.js";
import vidzee from "./vidzee.js";
import rivestream from "./rivestream.js";
import vaplayer from "./vaplayer.js";
import lmscript from "./lmscript.js";
import framex from "./framex.js";
import kisskh from "./kisskh.js";
import animex from "./animex.js";
import megaplay from "./megaplay.js";
import opensubtitles from "./opensubtitles.js";

export const SOURCES = [
    bingebang, vidrock, vidfast, vidup, videasy, vidzee, rivestream, vaplayer, lmscript, framex, kisskh,
    animex, megaplay,
    opensubtitles
];

export function sourcesFor(data, all = SOURCES) {
    return all.filter(source => source.subtitles || Boolean(source.anime) === Boolean(data.anime));
}
