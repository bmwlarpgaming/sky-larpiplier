// Dean Edwards' P.A.C.K.E.R. obfuscation (`eval(function(p,a,c,k,e,d)...`), used by many video
// hosts to hide their source. Shared by the plugins of this repository.

const PACKER_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PACKED_SCRIPT = /eval\(function\(p,a,c,k,e,[dr]\)[\s\S]*?\.split\('\|'\)[^)]*\)\)?/g;

/** The unpacked source of a packed script, or null when it is not one. */
export function unpackPacker(source) {
    const match = /\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/.exec(source || "");
    if (!match) return null;
    const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const radix = parseInt(match[2], 10);
    const words = match[4].split("|");
    const decode = word => {
        if (radix <= 36) return parseInt(word, radix);
        let n = 0;
        for (const ch of word) {
            const v = PACKER_ALPHABET.indexOf(ch);
            if (v < 0) return NaN;
            n = n * radix + v;
        }
        return n;
    };
    return payload.replace(/\b\w+\b/g, word => {
        const index = decode(word);
        return Number.isFinite(index) && index < words.length && words[index] ? words[index] : word;
    });
}

/** Every packed script of a page, unpacked. */
export function unpackedScripts(html) {
    const out = [];
    for (const m of String(html || "").matchAll(PACKED_SCRIPT)) {
        const unpacked = unpackPacker(m[0]);
        if (unpacked) out.push(unpacked);
    }
    return out;
}

/** The page followed by every packed script it contains, unpacked. */
export function withUnpacked(html) {
    return [String(html || "")].concat(unpackedScripts(html)).join("\n");
}
