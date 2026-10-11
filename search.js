(function () {
    "use strict";
    var script = document.currentScript;
    var base = new URL("./", script.src);
    var indexPromise;
    var dialog, dialogPanel, previousFocus;
    var page = document.getElementById("site-search-page");
    var categories = ["All", "Projects", "Research", "Essays", "Stories", "Reading", "Games", "Pages"];

    function loadIndex() {
        if (!indexPromise) indexPromise = fetch(new URL("search-index.json", base)).then(function (response) {
            if (!response.ok) throw new Error("Search index unavailable");
            return response.json();
        }).then(function (data) { return SiteSearch.prepare(data); }).catch(function (error) {
            indexPromise = null; throw error;
        });
        return indexPromise;
    }
    function highlight(element, text, query) {
        var terms = SiteSearch.queryTerms(query);
        var escaped = terms.map(function (term) { return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
        if (!escaped.length) { element.textContent = text; return; }
        var pattern = new RegExp("(" + escaped.join("|") + ")", "ig");
        text.split(pattern).forEach(function (part, i) {
            if (!part) return;
            var node = i % 2 ? document.createElement("mark") : document.createTextNode(part);
            if (i % 2) node.textContent = part;
            element.appendChild(node);
        });
    }
    function createPanel(container, fullPage) {
        container.classList.add("site-search-panel");
        container.innerHTML = '<div class="search-heading"><h2>Search the site</h2>' +
            (fullPage ? '' : '<button type="button" class="search-close" aria-label="Close search">Esc ×</button>') + '</div>' +
            '<label class="search-field"><span>Projects, topics, languages, and more</span>' +
            '<input class="search-input" type="search" placeholder="Try ss.jl, voice agents, or Python…" autocomplete="off" spellcheck="false" maxlength="200"></label>' +
            '<div class="search-filters" role="group" aria-label="Filter search results"></div>' +
            '<p class="search-status" role="status" aria-live="polite">Start typing to search.</p>' +
            '<ul class="search-results" aria-label="Search results"></ul>' +
            '<div class="search-footer">↑ ↓ to move · Enter to open' +
            (fullPage ? ' · Ctrl / ⌘ K from any page' : ' · Esc to close · <a class="search-all">Open full search</a>') + '</div>';
        var input = container.querySelector("input");
        var status = container.querySelector(".search-status");
        var list = container.querySelector("ul");
        var filterGroup = container.querySelector(".search-filters");
        var category = "All", generation = 0, timer;
        var params = new URLSearchParams(location.search);
        if (fullPage) { input.value = (params.get("q") || "").slice(0, 200); if (categories.includes(params.get("type"))) category = params.get("type"); }
        var close = container.querySelector(".search-close");
        if (close) close.addEventListener("click", function () { dialog.close(); });
        var allLink = container.querySelector(".search-all");
        function updateURL() {
            var url = new URL("search/", base);
            if (input.value.trim()) url.searchParams.set("q", input.value.trim());
            if (category !== "All") url.searchParams.set("type", category);
            if (allLink) allLink.href = url.href;
            if (fullPage) history.replaceState(null, "", url.pathname + url.search);
        }
        categories.forEach(function (name) {
            var button = document.createElement("button"); button.type = "button";
            button.className = "search-filter"; button.textContent = name;
            button.setAttribute("aria-pressed", String(name === category));
            button.addEventListener("click", function () {
                category = name;
                filterGroup.querySelectorAll("button").forEach(function (item) { item.setAttribute("aria-pressed", String(item === button)); });
                render();
            });
            filterGroup.appendChild(button);
        });
        async function render() {
            var current = ++generation;
            var query = input.value.trim();
            updateURL(); status.textContent = "Searching…";
            try {
                var documents = await loadIndex();
                if (current !== generation) return;
                var results = SiteSearch.search(documents, query, category);
                if (!SiteSearch.queryTerms(query).length && category === "All") {
                    var featured = ["OpenDraft", "ty", "Lightning Detector", "Accessor", "SatelliteSim.jl (ss.jl)", "Syngrafi", "Photolib"];
                    results = featured.map(function (title) { return results.find(function (item) { return item.doc.title === title; }); }).filter(Boolean);
                }
                var visible = fullPage ? results : results.slice(0, 20);
                list.replaceChildren();
                status.textContent = query ? results.length + (results.length === 1 ? " result" : " results") +
                    (visible.length < results.length ? " · showing the first " + visible.length : "") : category === "All" ? "Explore a project, or type to search the whole site." : results.length + " in " + category.toLowerCase();
                if (!results.length) {
                    var empty = document.createElement("li"); empty.className = "search-empty";
                    empty.textContent = "No matches. Try a project name, a language, or fewer words. You can also choose All to search every section.";
                    list.appendChild(empty);
                }
                visible.forEach(function (result) {
                    var doc = result.doc, li = document.createElement("li"), link = document.createElement("a");
                    link.className = "search-result";
                    link.href = new URL(doc.url, base).href;
                    var title = document.createElement("span"); title.className = "search-result-title";
                    highlight(title, doc.title, query); link.appendChild(title);
                    var meta = document.createElement("span"); meta.className = "search-result-meta";
                    var external = new URL(link.href).origin !== location.origin;
                    meta.textContent = [doc.category].concat(doc.tags || []).concat(external ? ["External ↗"] : []).join(" · ");
                    link.appendChild(meta);
                    var description = document.createElement("span"); description.className = "search-result-description";
                    highlight(description, SiteSearch.excerpt(doc, query), query); link.appendChild(description);
                    link.addEventListener("focus", function () {
                        list.querySelectorAll("a").forEach(function (item) { item.dataset.active = String(item === link); });
                    });
                    li.appendChild(link); list.appendChild(li);
                });
            } catch (error) {
                if (current !== generation) return;
                status.textContent = "Search couldn’t load. Check your connection and retry.";
                list.replaceChildren();
                var retry = document.createElement("button"); retry.type = "button";
                retry.className = "search-filter"; retry.textContent = "Retry search";
                retry.addEventListener("click", render); list.appendChild(retry);
            }
        }
        input.addEventListener("input", function () { clearTimeout(timer); ++generation; timer = setTimeout(render, 100); });
        container.addEventListener("keydown", function (event) {
            // Keep page/game hotkeys out of a search session. Native dialog
            // Escape behavior still runs because its default is not cancelled.
            event.stopPropagation();
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.preventDefault(); input.focus(); return;
            }
            var links = Array.from(list.querySelectorAll("a"));
            if (!links.length) return;
            var i = links.indexOf(document.activeElement);
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && (document.activeElement === input || i >= 0)) {
                event.preventDefault();
                if (event.key === "ArrowUp" && i <= 0) input.focus();
                else links[(i + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus();
            } else if (event.key === "Enter" && document.activeElement === input) {
                event.preventDefault(); links[0].click();
            }
        });
        return { input: input, render: render };
    }
    function openSearch() {
        if (page) { page.querySelector("input").focus(); return; }
        if (dialog && dialog.open) { dialogPanel.input.focus(); return; }
        if (!dialog) {
            dialog = document.createElement("dialog"); dialog.className = "site-search-dialog";
            dialog.setAttribute("aria-label", "Search the site");
            var panel = document.createElement("div"); dialog.appendChild(panel); document.body.appendChild(dialog);
            dialogPanel = createPanel(panel, false);
            dialog.addEventListener("click", function (event) {
                if (event.target !== dialog) return;
                var box = dialog.getBoundingClientRect();
                if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
            });
            dialog.addEventListener("close", function () { if (previousFocus && previousFocus.isConnected) previousFocus.focus(); });
        }
        previousFocus = document.activeElement;
        if (!dialog.open) dialog.showModal();
        dialogPanel.input.focus(); dialogPanel.render();
    }
    function boot() {
        if (page) { var panel = createPanel(page, true); panel.render(); }
        document.addEventListener("click", function (event) {
            var trigger = event.target.closest("[data-site-search]");
            if (trigger && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); openSearch(); }
        });
        document.addEventListener("keydown", function (event) {
            var editing = event.target.closest("input, textarea, select, [contenteditable=true]");
            if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault(); event.stopPropagation(); openSearch();
            }
        }, true);
    }
    var css = document.createElement("link"); css.rel = "stylesheet"; css.href = new URL("search.css", base).href; document.head.appendChild(css);
    if (window.SiteSearch) boot();
    else {
        var core = document.createElement("script"); core.src = new URL("search-core.js", base).href;
        core.onload = boot;
        core.onerror = function () { if (page) page.textContent = "Search couldn’t load. Please reload the page to try again."; };
        document.head.appendChild(core);
    }
})();
