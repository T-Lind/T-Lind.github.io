/* Shared chrome. URLs resolve from this script, including on nested pages. */
(function () {
 "use strict";
 var script = document.currentScript;
 var base = new URL('./', script.src);
 var items = [
  ['', 'Home'],
  ['projects/', 'Projects', ['accessor', 'chess-3d', 'games', 'intellistream', 'kalman', 'lightning-detector', 'lindauerai', 'lofall', 'opendraft', 'orbits', 'photolib', 'research', 'satellite-sim', 'syngrafi', 'ty', 'wormhole']],
  ['space/', 'Tools', ['debris', 'van-allen', 'star-tracker', 'rf-link']],
  ['lit/', 'Lit', ['essays', 'motivation', 'reading']],
  ['profile/', 'Profile'],
  ['search/', 'Search']
 ];
 if (!document.querySelector('link[data-site-nav-style]')) {
  var style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('site-nav.css', base).href;
  style.setAttribute('data-site-nav-style', ''); document.head.appendChild(style);
 }
 var nav = document.getElementById('site-nav');
 if (!nav) { nav = document.createElement('nav'); nav.id = 'site-nav'; nav.setAttribute('aria-label', 'Site navigation'); document.body.appendChild(nav); }
 var links = nav.querySelector('.site-nav-links');
 if (!links) {
  links = document.createElement('div'); links.className = 'site-nav-links';
  // Home includes real links so navigation also works without JavaScript.
  while (nav.firstChild) links.appendChild(nav.firstChild);
  nav.appendChild(links);
 }
 links.id = 'site-nav-links';
 if (!links.querySelector('a')) items.forEach(function (item) {
  var a = document.createElement('a'); a.href = new URL(item[0], base).href; a.textContent = item[1]; links.appendChild(a);
 });
 function pagePath(url) {
  return url.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
 }
 var here = pagePath(location);
 var section = location.pathname.slice(base.pathname.length).split('/')[0];
 var parent = items.find(function (item) { return item[2] && item[2].includes(section); });
 var parentPath = parent && pagePath(new URL(parent[0], base));
 var searchPath = pagePath(new URL('search/', base));
 links.querySelectorAll('a').forEach(function (a) {
  var target = pagePath(new URL(a.href));
  if (target === here) a.setAttribute('aria-current', 'page');
  else if (target === parentPath) a.setAttribute('aria-current', 'location');
  if (target === searchPath) {
   a.classList.add('site-search-trigger'); a.setAttribute('data-site-search', ''); a.setAttribute('aria-keyshortcuts', 'Control+k Meta+k /');
   if (!a.querySelector('kbd')) { var key = document.createElement('kbd'); key.textContent = 'Ctrl / ⌘ K'; a.appendChild(key); }
  }
 });
 var brand = document.createElement('a'); brand.className = 'site-nav-brand'; brand.href = base.href;
 brand.textContent = 'T–Lind'; brand.setAttribute('aria-label', 'T-Lind home'); nav.insertBefore(brand, links);
 var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'site-nav-toggle';
 toggle.setAttribute('aria-label', 'Open navigation menu'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', links.id);
 [0, 1, 2].forEach(function () { var line = document.createElement('span'); line.setAttribute('aria-hidden', 'true'); toggle.appendChild(line); });
 nav.insertBefore(toggle, links); nav.dataset.enhanced = 'true';
 function setOpen(open, restoreFocus) {
  nav.dataset.open = String(open); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  if (restoreFocus) toggle.focus();
 }
 toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
 nav.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && nav.dataset.open === 'true') { event.preventDefault(); setOpen(false, true); }
 });
 nav.addEventListener('click', function (event) {
  var link = event.target.closest('.site-nav-links a');
  if (link) setOpen(false, compact.matches && link.hasAttribute('data-site-search'));
 });
 document.addEventListener('click', function (event) { if (!nav.contains(event.target)) setOpen(false); });
 document.addEventListener('focusin', function (event) { if (!nav.contains(event.target)) setOpen(false); });
 var compact = window.matchMedia('(max-width: 640px)'); compact.addEventListener('change', function () { setOpen(false); });
 function measureNav() {
  if (nav.dataset.open === 'true' || document.body.classList.contains('immersive')) return;
  document.documentElement.style.setProperty('--site-nav-height', nav.getBoundingClientRect().height + 'px');
 }
 if (window.ResizeObserver) new ResizeObserver(measureNav).observe(nav);
 window.addEventListener('resize', measureNav); measureNav();
 var main = document.querySelector('main');
 if (main && !document.querySelector('.skip-link, .site-skip-link')) {
  if (!main.id) main.id = 'main-content'; main.setAttribute('tabindex', '-1');
  var skip = document.createElement('a'); skip.className = 'site-skip-link'; skip.href = '#' + main.id; skip.textContent = 'Skip to content'; document.body.prepend(skip);
 }
 if (!document.querySelector('script[src$="search.js"]')) {
  var search = document.createElement('script'); search.src = new URL('search.js', base).href; document.head.appendChild(search);
 }
})();
