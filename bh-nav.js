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
        "#site-nav{position:fixed;top:0;left:0;right:0;z-index:2147483000;" +
        "display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.4rem;" +
        "padding:.6rem clamp(.8rem,4vw,2rem);" +
        "background:rgba(8,8,10,.72);border-bottom:1px solid rgba(255,255,255,.09);" +
        "-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);" +
        "font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif}" +
        "#site-nav a{font-size:.82rem;letter-spacing:.01em;text-transform:none;" +
        "text-decoration:none;color:rgba(255,255,255,.66);padding:.45em .9em;" +
        "border:1px solid rgba(255,255,255,.14);border-radius:0;" +
        "transition:color .18s ease,background .18s ease,border-color .18s ease}" +
        "#site-nav a:hover,#site-nav a:focus-visible{color:#fff;" +
        "border-color:rgba(255,255,255,.42);background:rgba(255,255,255,.06);outline:none}" +
        "#site-nav a[aria-current=page]{color:#0b0b0d;background:#fff;border-color:#fff}" +
        "@media(max-width:720px){#site-nav{padding:.5rem .5rem;gap:.3rem}" +
        "#site-nav a{font-size:.74rem;padding:.4em .6em}}";

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
