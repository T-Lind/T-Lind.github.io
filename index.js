function gridCellDimensions() {
    const element = document.createElement("div");
    element.style.position = "fixed";
    element.style.height = "var(--line-height)";
    element.style.width = "1ch";
    document.body.appendChild(element);
    const rect = element.getBoundingClientRect();
    document.body.removeChild(element);
    return {width: rect.width, height: rect.height};
}

// Add padding to each media to maintain grid.
function adjustMediaPadding() {
    const cell = gridCellDimensions();

    function setHeightFromRatio(media, ratio) {
        const rect = media.getBoundingClientRect();
        const realHeight = rect.width / ratio;
        const diff = cell.height - (realHeight % cell.height);
        media.style.setProperty("padding-bottom", `${diff}px`);
    }

    function setFallbackHeight(media) {
        const rect = media.getBoundingClientRect();
        const height = Math.round((rect.width / 2) / cell.height) * cell.height;
        media.style.setProperty("height", `${height}px`);
    }

    function onMediaLoaded(media) {
        var width, height;
        switch (media.tagName) {
            case "IMG":
                width = media.naturalWidth;
                height = media.naturalHeight;
                break;
            case "VIDEO":
                width = media.videoWidth;
                height = media.videoHeight;
                break;
        }
        if (width > 0 && height > 0) {
            setHeightFromRatio(media, width / height);
        } else {
            setFallbackHeight(media);
        }
    }

    const medias = document.querySelectorAll("img, video");
    for (media of medias) {
        switch (media.tagName) {
            case "IMG":
                if (media.complete) {
                    onMediaLoaded(media);
                } else {
                    media.addEventListener("load", () => onMediaLoaded(media));
                    media.addEventListener("error", function () {
                        setFallbackHeight(media);
                    });
                }
                break;
            case "VIDEO":
                switch (media.readyState) {
                    case HTMLMediaElement.HAVE_CURRENT_DATA:
                    case HTMLMediaElement.HAVE_FUTURE_DATA:
                    case HTMLMediaElement.HAVE_ENOUGH_DATA:
                        onMediaLoaded(media);
                        break;
                    default:
                        media.addEventListener("loadeddata", () => onMediaLoaded(media));
                        media.addEventListener("error", function () {
                            setFallbackHeight(media);
                        });
                        break;
                }
                break;
        }
    }
}

adjustMediaPadding();
window.addEventListener("load", adjustMediaPadding);
window.addEventListener("resize", adjustMediaPadding);

function checkOffsets() {
    const ignoredTagNames = new Set([
        "THEAD",
        "TBODY",
        "TFOOT",
        "TR",
        "TD",
        "TH",
    ]);
    const cell = gridCellDimensions();
    const elements = document.querySelectorAll("body :not(.debug-grid, .debug-toggle)");
    for (const element of elements) {
        if (ignoredTagNames.has(element.tagName)) {
            continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            continue;
        }
        const top = rect.top + window.scrollY;
        const left = rect.left + window.scrollX;
        const offset = top % (cell.height / 2);
        if (offset > 0) {
            element.classList.add("off-grid");
            console.error("Incorrect vertical offset for", element, "with remainder", top % cell.height, "when expecting divisible by", cell.height / 2);
        } else {
            element.classList.remove("off-grid");
        }
    }
}

const debugToggle = document.querySelector(".debug-toggle");

function onDebugToggle() {
    document.body.classList.toggle("debug", debugToggle.checked);
}

// debugToggle.addEventListener("change", onDebugToggle);

const delays = [
    600,
    900,
    1000,
    1100,
    3800,
    1000,
    1600,
    1000,
    1500,
    1000,
]

function typeIntroduction() {
    const container = document.getElementById('typing-container');
    const text = `Well hi there!

This site has all sorts of stuff about me because, I don't know, I felt like it?

It includes my profile & a few patent-pending inventions and research papers I've written.

There's also some other interesting stuff here. Have fun exploring!

`;

    let index = 0;
    let newLineIndex = 0;

    // Add the ">" symbol at the beginning
    container.innerHTML = '&gt; ';

    function typeNextCharacter() {
        if (index < text.length) {
            if (text[index] === '\n' && text[index + 1] === '\n') {
                container.innerHTML += '<br><br>';
                index += 2;
                newLineIndex++;
            } else if (text[index] === '*') {
                const endIndex = text.indexOf('*', index + 1);
                if (endIndex !== -1) {
                    const emphasis = text.slice(index + 1, endIndex);
                    container.innerHTML += `<em>${emphasis}</em>`;
                    index = endIndex + 1;
                } else {
                    container.innerHTML += text[index];
                    index++;
                }
            } else {
                container.innerHTML += text[index];
                index++;
            }
            if (text[index] === '\n') {
                setTimeout(typeNextCharacter, Math.random() * 100 + delays[newLineIndex]);
            } else {
                setTimeout(typeNextCharacter, Math.random() * 10 + 9);
            }
        } else {
            container.innerHTML += '<span class="cursor">\|</span>';
        }
    }

    if (!localStorage.getItem('typingEffectShown')) {
        typeNextCharacter();
        localStorage.setItem('typingEffectShown', 'true');
    } else {
        container.innerHTML = '&gt; ' + text.replace(/\n/g, '<br>') + '<span class="cursor">\|</span>';
    }
}

window.addEventListener('load', function () {
    if (document.getElementById('typing-container')) typeIntroduction();
});

// Resolve the relative prefix back to the site root.
// If the site is hosted under a subdirectory (e.g. "/t-lind.github.io/..."),
// computing the prefix purely from URL depth can point at a non-existent URL.
// Instead, find the first known top-level section segment and count "up" from there.
// Keep this list in sync with sidebar.html when adding a new top-level section.
function getPathPrefix() {
    var knownTopLevels = ['wormhole', 'projects', 'reading', 'profile', 'lindauerai',
        'research', 'games', 'motivation', 'intellistream', 'syngrafi', 'kalman', 'orbits'];
    var pathname = window.location.pathname.replace(/\/?index\.html?$/i, '') || '/';
    var segments = pathname.split('/').filter(Boolean);
    var anchorIdx = segments.findIndex(function (s) { return knownTopLevels.indexOf(s) !== -1; });
    if (anchorIdx === -1) {
        return segments.length === 0 ? '' : '../'.repeat(segments.length);
    }
    return '../'.repeat(segments.length - anchorIdx);
}

(function injectSidebar() {
    var container = document.getElementById('sidebar-container');
    if (!container) return;

    var pathPrefix = getPathPrefix();
    var sidebarUrl = pathPrefix + 'sidebar.html';

    fetch(sidebarUrl)
        .then(function (r) { return r.text(); })
        .then(function (html) {
            container.innerHTML = html;
            var herePath = window.location.pathname.replace(/\/?index\.html?$/i, '').replace(/\/+$/, '');
            container.querySelectorAll('.site-sidebar-list a').forEach(function (a) {
                var href = a.getAttribute('href');
                if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;
                a.setAttribute('href', pathPrefix + href);
                try {
                    var linkPath = new URL(a.href, window.location.href).pathname
                        .replace(/\/?index\.html?$/i, '').replace(/\/+$/, '');
                    if (linkPath === herePath) a.classList.add('active');
                } catch (e) {}
            });
        })
        .catch(function () { container.innerHTML = '<p class="site-sidebar-title">Site Directory</p><p>Navigation unavailable.</p>'; });
})();

/* ===== Rotating Quotes ===== */
(function loadQuote() {
    var quoteText = document.getElementById('quote-text');
    var quoteAttr = document.getElementById('quote-attribution');
    var quoteBlock = document.getElementById('quote-display');
    if (!quoteText || !quoteAttr || !quoteBlock) {
        // Not on a page with the quote block; just reveal if element exists
        if (quoteBlock) quoteBlock.classList.add('loaded');
        return;
    }

    var pathPrefix = getPathPrefix();

    fetch(pathPrefix + 'quotes.json')
        .then(function (r) { return r.json(); })
        .then(function (quotes) {
            var q = quotes[Math.floor(Math.random() * quotes.length)];
            quoteText.textContent = q.text;
            var attr = '\u2014 ' + q.author;
            if (q.source) attr += ', ' + q.source;
            quoteAttr.textContent = attr;
            quoteBlock.classList.add('loaded');
        })
        .catch(function () {
            // Keep the hardcoded fallback and reveal
            quoteBlock.classList.add('loaded');
        });
})();

/* ===== NASA Astronomy Picture of the Day ===== */
(function loadAPOD() {
    var container = document.getElementById('apod-content');
    if (!container) return;

    var CACHE_KEY = 'tlind_apod_cache';
    var CACHE_TTL = 3600000; // 1 hour

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        renderAPOD(cached.data, container);
        return;
    }

    fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY')
        .then(function (r) { return r.json(); })
        .then(function (apod) {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: apod, ts: Date.now() })); } catch (e) {}
            renderAPOD(apod, container);
        })
        .catch(function () {
            container.innerHTML = '<p class="widget-loading">Unable to load APOD at the moment.</p>';
        });
})();

function renderAPOD(apod, container) {
    var html = '<p class="apod-title"><strong>' + escapeHTML(apod.title) + '</strong></p>';
    if (apod.media_type === 'image') {
        html += '<img src="' + escapeHTML(apod.url) + '" alt="' + escapeHTML(apod.title) + '">';
    } else if (apod.media_type === 'video') {
        html += '<p><a href="' + escapeHTML(apod.url) + '" target="_blank">Watch today\'s video</a></p>';
    }
    var desc = (apod.explanation || '').length > 220
        ? apod.explanation.substring(0, 220).replace(/\s+\S*$/, '') + '\u2026'
        : apod.explanation || '';
    html += '<p class="apod-desc">' + escapeHTML(desc) + '</p>';
    container.innerHTML = html;
}

/* ===== Next Rocket Launch Countdown ===== */
(function loadLaunch() {
    var container = document.getElementById('launch-content');
    if (!container) return;

    var CACHE_KEY = 'tlind_launch_cache';
    var CACHE_TTL = 1800000; // 30 minutes

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        renderLaunch(cached.data, container);
        return;
    }

    fetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1&mode=list')
        .then(function (r) {
            if (!r.ok) throw new Error('API error');
            return r.json();
        })
        .then(function (data) {
            if (!data.results || !data.results.length) throw new Error('No launches');
            var launch = data.results[0];
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: launch, ts: Date.now() })); } catch (e) {}
            renderLaunch(launch, container);
        })
        .catch(function () {
            // Fallback: try SpaceX API
            fetch('https://api.spacexdata.com/v4/launches/next')
                .then(function (r) { return r.json(); })
                .then(function (launch) {
                    var normalized = {
                        name: launch.name,
                        net: launch.date_utc,
                        launch_service_provider: { name: 'SpaceX' },
                        pad: { location: { name: '' } }
                    };
                    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: normalized, ts: Date.now() })); } catch (e) {}
                    renderLaunch(normalized, container);
                })
                .catch(function () {
                    container.innerHTML = '<p class="widget-loading">Launch data unavailable at the moment.</p>';
                });
        });
})();

function renderLaunch(launch, container) {
    var html = '<p class="launch-name"><strong>' + escapeHTML(launch.name) + '</strong></p>';
    if (launch.launch_service_provider && launch.launch_service_provider.name) {
        html += '<p class="launch-provider">' + escapeHTML(launch.launch_service_provider.name) + '</p>';
    }
    html += '<div class="launch-countdown" id="launch-countdown" data-net="' + escapeHTML(launch.net) + '"></div>';
    html += '<p class="launch-countdown-label">until launch</p>';
    if (launch.pad && launch.pad.location && launch.pad.location.name) {
        html += '<p class="launch-pad">' + escapeHTML(launch.pad.location.name) + '</p>';
    }
    container.innerHTML = html;
    updateLaunchCountdown();
    setInterval(updateLaunchCountdown, 1000);
}

function updateLaunchCountdown() {
    var el = document.getElementById('launch-countdown');
    if (!el) return;
    var net = new Date(el.getAttribute('data-net'));
    var diff = net - Date.now();
    if (diff <= 0) {
        el.textContent = 'Launched!';
        return;
    }
    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    el.textContent = 'T\u2212' + pad(d) + 'd ' + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/* ===== GitHub Recent Commits ===== */
(function loadGitHubCommits() {
    var container = document.getElementById('github-content');
    if (!container) return;

    var CACHE_KEY = 'tlind_github_cache';
    var CACHE_TTL = 900000; // 15 minutes
    var HEADERS = { 'Accept': 'application/vnd.github+json' };

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        renderCommits(cached.data, container);
        return;
    }

    // The public events feed no longer includes commit messages, so instead list
    // the most recently pushed repos and pull their latest commits.
    fetch('https://api.github.com/users/T-Lind/repos?sort=pushed&direction=desc&per_page=4', { headers: HEADERS })
        .then(function (r) {
            if (!r.ok) throw new Error('GitHub API error ' + r.status);
            return r.json();
        })
        .then(function (repos) {
            var targets = repos.filter(function (r) { return !r.fork; }).slice(0, 3);
            return Promise.all(targets.map(function (repo) {
                return fetch('https://api.github.com/repos/' + repo.full_name + '/commits?per_page=3', { headers: HEADERS })
                    .then(function (r) { return r.ok ? r.json() : []; })
                    .then(function (cs) {
                        return (cs || []).map(function (c) {
                            return {
                                repo: repo.name,
                                message: ((c.commit && c.commit.message) || '').split('\n')[0],
                                sha: (c.sha || '').substring(0, 7),
                                date: (c.commit && c.commit.author && c.commit.author.date) || repo.pushed_at,
                                url: c.html_url || ''
                            };
                        });
                    })
                    .catch(function () { return []; });
            }));
        })
        .then(function (groups) {
            var commits = [].concat.apply([], groups);
            commits.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
            commits = commits.slice(0, 6);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: commits, ts: Date.now() })); } catch (e) {}
            renderCommits(commits, container);
        })
        .catch(function () {
            container.innerHTML = '<p class="widget-loading">GitHub activity unavailable right now.</p>';
        });
})();

function renderCommits(commits, container) {
    if (!commits || !commits.length) {
        container.innerHTML = '<p class="widget-loading">No recent public commits.</p>';
        return;
    }
    var html = '<ul class="commit-list">';
    commits.forEach(function (c) {
        var link = c.url ? '<a href="' + escapeHTML(c.url) + '" target="_blank" rel="noopener">' +
            escapeHTML(c.message) + '</a>' : escapeHTML(c.message);
        html += '<li class="commit-item">' +
            '<div class="commit-message" title="' + escapeHTML(c.message) + '">' + link + '</div>' +
            '<div class="commit-meta"><span class="commit-repo">' + escapeHTML(c.repo) + '</span> · <code>' +
            escapeHTML(c.sha) + '</code> · ' + timeAgo(c.date) + '</div>' +
            '</li>';
    });
    html += '</ul>';
    container.innerHTML = html;
}

/* ===== International Space Station Position ===== */
(function loadISS() {
    var container = document.getElementById('iss-content');
    if (!container) return;

    function fetchISS() {
        fetch('https://api.wheretheiss.at/v1/satellites/25544')
            .then(function (r) {
                if (!r.ok) throw new Error('ISS API error ' + r.status);
                return r.json();
            })
            .then(function (data) { renderISS(data, container); })
            .catch(function () {
                if (!container.querySelector('.iss-coords')) {
                    container.innerHTML = '<p class="widget-loading">ISS data unavailable right now.</p>';
                }
            });
    }

    fetchISS();
    var timer = setInterval(fetchISS, 10000);
    window.addEventListener('beforeunload', function () { clearInterval(timer); });
})();

function renderISS(data, container) {
    var lat = Number(data.latitude);
    var lon = Number(data.longitude);
    var html = '<div class="iss-coords">' +
        '<div class="iss-coord"><span class="iss-label">Lat</span><span class="iss-value">' +
        Math.abs(lat).toFixed(2) + '\u00B0 ' + (lat >= 0 ? 'N' : 'S') + '</span></div>' +
        '<div class="iss-coord"><span class="iss-label">Lon</span><span class="iss-value">' +
        Math.abs(lon).toFixed(2) + '\u00B0 ' + (lon >= 0 ? 'E' : 'W') + '</span></div>' +
        '</div>' +
        '<p class="iss-stats"><strong>' + Number(data.altitude).toFixed(0) + '</strong> km altitude · <strong>' +
        Number(data.velocity).toFixed(0) + '</strong> km/h</p>' +
        '<p class="iss-updated">Updated ' + timeAgo(data.timestamp * 1000) + '</p>';
    container.innerHTML = html;
}

/* ===== Utility ===== */
function timeAgo(input) {
    var then = typeof input === 'number' ? input : Date.parse(input);
    if (isNaN(then)) return '';
    var s = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
}
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
