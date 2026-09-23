/* Homepage: random quote + live data widgets (single column). */
(function () {
    "use strict";

    function esc(s) {
        if (!s) return "";
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function timeAgo(input) {
        var then = typeof input === "number" ? input : Date.parse(input);
        if (isNaN(then)) return "";
        var s = Math.max(0, Math.floor((Date.now() - then) / 1000));
        if (s < 60) return s + "s ago";
        var m = Math.floor(s / 60); if (m < 60) return m + "m ago";
        var h = Math.floor(m / 60); if (h < 24) return h + "h ago";
        return Math.floor(h / 24) + "d ago";
    }
    function cache(key, ttlMs, loader, render) {
        var c = null;
        try { c = JSON.parse(localStorage.getItem(key)); } catch (e) {}
        if (c && Date.now() - c.ts < ttlMs) { render(c.data); return; }
        loader(function (data) {
            try { localStorage.setItem(key, JSON.stringify({ data: data, ts: Date.now() })); } catch (e) {}
            render(data);
        });
    }
    function get(url, headers) {
        return fetch(url, { headers: headers || {} }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    /* ---- random quote (new one every refresh) ---- */
    (function quote() {
        var txt = document.getElementById("quote-text");
        var att = document.getElementById("quote-attribution");
        if (!txt) return;
        get("quotes.json").then(function (quotes) {
            var q = quotes[Math.floor(Math.random() * quotes.length)];
            txt.textContent = q.text;
            var a = "\u2014 " + q.author + (q.source ? ", " + q.source : "");
            if (att) att.textContent = a;
        }).catch(function () {});
    })();

    /* ---- NASA APOD ---- */
    (function apod() {
        var box = document.getElementById("apod-content");
        if (!box) return;
        cache("bh_apod", 3600000, function (done) {
            get("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY").then(done).catch(function () { done(null); });
        }, function (a) {
            if (!a) { box.innerHTML = '<p class="loading">APOD unavailable right now.</p>'; return; }
            var h = '<p class="apod-title"><strong>' + esc(a.title) + "</strong></p>";
            if (a.media_type === "image") h += '<img src="' + esc(a.url) + '" alt="' + esc(a.title) + '">';
            else if (a.media_type === "video") h += '<p><a href="' + esc(a.url) + '" target="_blank">Watch today\'s video</a></p>';
            var full = a.explanation || "";
            if (full.length > 200) {
                h += '<p class="apod-desc clamped">' + esc(full) + "</p>" +
                     '<button class="apod-toggle" type="button">Read more</button>';
            } else {
                h += '<p class="apod-desc">' + esc(full) + "</p>";
            }
            box.innerHTML = h;
            var btn = box.querySelector(".apod-toggle");
            if (btn) btn.addEventListener("click", function () {
                var p = box.querySelector(".apod-desc");
                p.classList.toggle("clamped");
                btn.textContent = p.classList.contains("clamped") ? "Read more" : "Read less";
            });
        });
    })();

    /* ---- next rocket launch ---- */
    (function launch() {
        var box = document.getElementById("launch-content");
        if (!box) return;
        function norm(l) {
            return {
                name: l.name,
                net: l.net || l.date_utc,
                provider: (l.launch_service_provider && l.launch_service_provider.name) || "SpaceX",
                pad: (l.pad && l.pad.location && l.pad.location.name) || ""
            };
        }
        cache("bh_launch", 1800000, function (done) {
            get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1&mode=list")
                .then(function (d) { done(norm(d.results[0])); })
                .catch(function () {
                    get("https://api.spacexdata.com/v4/launches/next").then(function (l) { done(norm(l)); }).catch(function () { done(null); });
                });
        }, function (l) {
            if (!l) { box.innerHTML = '<p class="loading">Launch data unavailable right now.</p>'; return; }
            box.innerHTML =
                '<p class="launch-name"><strong>' + esc(l.name) + "</strong></p>" +
                '<p class="launch-provider">' + esc(l.provider) + "</p>" +
                '<div class="launch-countdown" id="launch-countdown" data-net="' + esc(l.net) + '"></div>' +
                '<p class="launch-countdown-label">until launch</p>' +
                (l.pad ? '<p class="launch-pad">' + esc(l.pad) + "</p>" : "");
            tick(); setInterval(tick, 1000);
        });
        function tick() {
            var el = document.getElementById("launch-countdown");
            if (!el) return;
            var diff = new Date(el.getAttribute("data-net")) - Date.now();
            if (diff <= 0) { el.textContent = "Launched!"; return; }
            var d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000);
            var m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
            el.textContent = "T\u2212" + pad(d) + "d " + pad(h) + "h " + pad(m) + "m " + pad(s) + "s";
        }
    })();

    /* ---- recent commits ---- */
    (function commits() {
        var box = document.getElementById("github-content");
        if (!box) return;
        var H = { Accept: "application/vnd.github+json" };
        cache("bh_commits", 900000, function (done) {
            get("https://api.github.com/users/T-Lind/repos?sort=pushed&direction=desc&per_page=4", H)
                .then(function (repos) {
                    var targets = repos.filter(function (r) { return !r.fork; }).slice(0, 3);
                    return Promise.all(targets.map(function (repo) {
                        return get("https://api.github.com/repos/" + repo.full_name + "/commits?per_page=3", H)
                            .then(function (cs) {
                                return cs.map(function (c) {
                                    return {
                                        repo: repo.name,
                                        message: ((c.commit && c.commit.message) || "").split("\n")[0],
                                        sha: (c.sha || "").substring(0, 7),
                                        date: (c.commit && c.commit.author && c.commit.author.date) || repo.pushed_at,
                                        url: c.html_url || ""
                                    };
                                });
                            }).catch(function () { return []; });
                    }));
                })
                .then(function (groups) {
                    var list = [].concat.apply([], groups);
                    list.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
                    done(list.slice(0, 6));
                })
                .catch(function () { done([]); });
        }, function (list) {
            if (!list || !list.length) { box.innerHTML = '<p class="loading">No recent public commits.</p>'; return; }
            var h = '<ul class="commit-list">';
            list.forEach(function (c) {
                var msg = c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.message) + "</a>" : esc(c.message);
                h += '<li class="commit-item"><div class="commit-message">' + msg + '</div>' +
                     '<div class="commit-meta">' + esc(c.repo) + " \u00b7 <code>" + esc(c.sha) + "</code> \u00b7 " + timeAgo(c.date) + "</div></li>";
            });
            box.innerHTML = h + "</ul>";
            loadCounts();
        });

        function loadCounts() {
            var y = new Date().getFullYear();
            var H = { Accept: "application/vnd.github+json" };
            Promise.all([
                get("https://api.github.com/search/commits?q=author%3AT-Lind&per_page=1", H).catch(function () { return null; }),
                get("https://api.github.com/search/commits?q=author%3AT-Lind+committer-date%3A%3E%3D" + y + "-01-01&per_page=1", H).catch(function () { return null; })
            ]).then(function (res) {
                var total = res[0] && typeof res[0].total_count === "number" ? res[0].total_count : null;
                var ytd = res[1] && typeof res[1].total_count === "number" ? res[1].total_count : null;
                var parts = [];
                if (ytd != null) parts.push(ytd + " public commits in " + y);
                if (total != null) parts.push((total >= 1000 ? "1000+" : total) + " public commits total");
                if (parts.length && !box.querySelector(".commit-counts")) {
                    box.insertAdjacentHTML("afterbegin", '<p class="commit-counts">' + esc(parts.join(" \u00b7 ")) + "</p>");
                }
            });
        }
    })();

    /* ---- ISS position ---- */
    (function iss() {
        var box = document.getElementById("iss-content");
        if (!box) return;
        function render(d) {
            var lat = Number(d.latitude), lon = Number(d.longitude);
            box.innerHTML =
                '<div class="iss-coords">' +
                '<div><span class="iss-label">Lat</span><span class="iss-value">' + Math.abs(lat).toFixed(2) + "\u00b0 " + (lat >= 0 ? "N" : "S") + "</span></div>" +
                '<div><span class="iss-label">Lon</span><span class="iss-value">' + Math.abs(lon).toFixed(2) + "\u00b0 " + (lon >= 0 ? "E" : "W") + "</span></div></div>" +
                '<p class="iss-stats"><strong>' + Number(d.altitude).toFixed(0) + "</strong> km altitude \u00b7 <strong>" +
                Number(d.velocity).toFixed(0) + "</strong> km/h</p>" +
                '<p class="iss-updated">Updated ' + timeAgo(d.timestamp * 1000) + "</p>";
        }
        function pull() {
            get("https://api.wheretheiss.at/v1/satellites/25544").then(render).catch(function () {
                if (!box.querySelector(".iss-coords")) box.innerHTML = '<p class="loading">ISS data unavailable right now.</p>';
            });
        }
        pull(); setInterval(pull, 10000);
    })();
})();
