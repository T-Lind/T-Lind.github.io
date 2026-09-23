/* Injects the compact top-right site navigation on every page.
   Links are resolved from the script's own URL, so it works at any depth. */
(function () {
    "use strict";

    var s = document.currentScript;
    var base = (s && s.src) ? s.src.replace(/bh-nav\.js(?:[?#].*)?$/, "") : "";

    var items = [
        ["", "Home"],
        ["projects/", "Projects"],
        ["research/", "Research"],
        ["motivation/", "Motivation"],
        ["profile/", "Profile"],
        ["games/", "Games"],
        ["reading/", "Reading"]
    ];

    var css =
        "#site-nav,#site-nav *{margin:0;box-sizing:border-box}" +
        "#site-nav{position:fixed;top:max(.9rem,env(safe-area-inset-top));" +
        "right:max(1rem,env(safe-area-inset-right));z-index:2147483000;" +
        "display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:.12rem;" +
        "padding:.3rem;border-radius:9px;background:rgba(8,6,4,.5);" +
        "border:1px solid rgba(255,170,90,.28);-webkit-backdrop-filter:blur(6px);" +
        "backdrop-filter:blur(6px);font-family:ui-monospace,\"SFMono-Regular\"," +
        "Menlo,Consolas,monospace}" +
        "#site-nav a{font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;" +
        "text-decoration:none;color:rgba(255,225,195,.85);padding:.45em .62em;" +
        "border-radius:6px;transition:background .18s,color .18s}" +
        "#site-nav a:hover,#site-nav a:focus-visible{background:rgba(255,170,90,.16);color:#fff}" +
        "#site-nav a[aria-current=page]{color:#fff;background:rgba(255,170,90,.22)}";

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var nav = document.createElement("nav");
    nav.id = "site-nav";
    nav.setAttribute("aria-label", "Site navigation");

    var basePath = "/";
    try { basePath = new URL(base, location.href).pathname; } catch (e) {}
    var here = location.pathname.replace(/index\.html$/, "").replace(/\/+$/, "") || "/";

    items.forEach(function (it) {
        var a = document.createElement("a");
        a.href = base + it[0];
        a.textContent = it[1];
        var target = (basePath + it[0]).replace(/\/+$/, "") || "/";
        if (target === here) a.setAttribute("aria-current", "page");
        nav.appendChild(a);
    });

    if (document.body) document.body.appendChild(nav);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(nav); });
})();
