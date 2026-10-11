/* Shared by the search UI and its Node tests. No requests or dependencies. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.SiteSearch = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    var aliases = { js: "javascript", ts: "typescript", py: "python", cpp: "c++" };
    var languages = new Set(["javascript", "typescript", "python", "java", "julia", "rust", "c", "c++", "c#", "sql", "ruby"]);
    var stopWords = new Set(["a", "an", "the", "and", "or", "for", "with", "of", "in", "my"]);
    function normalize(text) {
        return String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }
    function tokens(text) {
        return normalize(text).match(/[a-z0-9]+(?:[.+#][a-z0-9]+)*\+*#?/g) || [];
    }
    function queryTerms(query) {
        return Array.from(new Set(tokens(query).filter(function (word) { return !stopWords.has(word); })
            .map(function (word) { return aliases[word] || word; }))).slice(0, 12);
    }
    function distance(a, b) {
        var row = Array.from({ length: b.length + 1 }, function (_, i) { return i; });
        for (var i = 1; i <= a.length; i++) {
            var previous = row[0]; row[0] = i;
            for (var j = 1; j <= b.length; j++) {
                var old = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
                // Adjacent transpositions are the most common typing mistake.
                previous = old;
            }
        }
        if (a.length === b.length && a.length >= 4) {
            for (var k = 0; k < a.length - 1; k++) {
                if (a[k] !== b[k] && a.slice(0, k) === b.slice(0, k) &&
                    a[k] === b[k + 1] && a[k + 1] === b[k] && a.slice(k + 2) === b.slice(k + 2)) return 1;
            }
        }
        return row[b.length];
    }
    function fieldScore(words, term, weight, fuzzy) {
        if (words.includes(term)) return weight;
        // A Java query should not also match every JavaScript project.
        if (languages.has(term)) return 0;
        if (term.length >= 3 && words.some(function (word) { return word.startsWith(term); })) return weight * .75;
        var limit = term.length >= 8 ? 2 : (term.length >= 4 ? 1 : 0);
        if (fuzzy && limit && words.some(function (word) {
            return Math.abs(word.length - term.length) <= limit && distance(word, term) <= limit;
        })) return weight * .4;
        return 0;
    }
    function prepare(documents) {
        return documents.map(function (doc) {
            return Object.assign({}, doc, { fields: [
                [tokens(doc.title), 16, true], [tokens((doc.aliases || []).join(" ")), 13, true],
                [tokens((doc.tags || []).join(" ")), 10, true], [tokens(doc.description), 5, true],
                [tokens(doc.text), 1, false]
            ] });
        });
    }
    function search(documents, query, category) {
        var terms = queryTerms(query);
        return documents.filter(function (doc) { return !category || category === "All" || doc.category === category; })
            .map(function (doc) {
                if (!terms.length) return { doc: doc, score: 0 };
                var score = 0;
                for (var term of terms) {
                    var best = Math.max.apply(null, doc.fields.map(function (field) {
                        return fieldScore(field[0], term, field[1], field[2]);
                    }));
                    if (!best) return null;
                    score += best;
                }
                if (normalize(doc.title) === normalize(query).trim()) score += 40;
                return { doc: doc, score: score };
            }).filter(Boolean).sort(function (a, b) {
                return b.score - a.score || a.doc.title.localeCompare(b.doc.title);
            });
    }
    function excerpt(doc, query) {
        var terms = queryTerms(query);
        var source = doc.description || doc.text || "";
        var text = doc.text || source;
        if (terms.length && !terms.some(function (term) { return normalize(source).includes(term); }) &&
            terms.some(function (term) { return normalize(text).includes(term); })) source = text;
        var positions = terms.map(function (term) { return normalize(source).indexOf(term); }).filter(function (p) { return p >= 0; });
        var start = positions.length ? Math.max(0, Math.min.apply(null, positions) - 55) : 0;
        if (start) { var space = source.indexOf(" ", start); if (space >= 0 && space < start + 25) start = space + 1; }
        return (start ? "…" : "") + source.slice(start, start + 190).trim() + (source.length > start + 190 ? "…" : "");
    }
    return { normalize: normalize, queryTerms: queryTerms, prepare: prepare, search: search, excerpt: excerpt };
});
