/* Suivi : comparateur de maisons. Page statique, sans dépendance (Leaflet est chargé à la demande pour le plan). */
(function () {
'use strict';
const D = window.SUIVI_DATA;
const $ = (id) => document.getElementById(id);
const SITE = 'https://suivi.becheroy.fr/';
const NBSP = ' ', NNBSP = ' ';

/* ---------- outils ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
const eur = (n) => nf(n) + NBSP + '€';
const plain = (s) => String(s).replace(/[  ]/g, ' ');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return (+m[3] === 1 ? '1er' : +m[3]) + ' ' + MOIS[+m[2] - 1] + ' ' + m[1];
}
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => (n < 10 ? '0' : '') + n;
const photo = (h, i, size) => 'photos/' + pad(h.n) + '-' + (i + 1) + '-' + size + '.jpg';
const store = {
  get(k, d) { try { const v = localStorage.getItem('suivi.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('suivi.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
};

/* ---------- suivi (statuts) ---------- */
const STATUTS = {
  etude: 'À étudier',
  questions: 'Questions envoyées',
  visite: 'Visite à prévoir',
  vu: 'Visité',
  ecarte: 'Écarté'
};
let H = [];
let CONTACT = { email: '', tel: '' };
function applyEtat(etat) {
  const eb = (etat && etat.biens) || {};
  H = D.biens.filter((h) => !(eb[h.n] && eb[h.n].visible === false)).map((h) => {
    const e = eb[h.n] || {};
    return Object.assign({}, h, {
      ppm: Math.round(h.price / h.m2),
      statut: STATUTS[e.statut] ? e.statut : 'etude',
      maj: e.maj || D.updated,
      suivi: e.note || ''
    });
  });
  H.slice().sort((a, b) => b.score - a.score).forEach((h, i) => { h.rank = i + 1; });
  if (etat && etat.contact) CONTACT = { email: etat.contact.email || '', tel: etat.contact.tel || '' };
  S.cmp = S.cmp.filter((n) => byN(n));
}
const byN = (n) => H.find((h) => h.n === n);

/* ---------- lecture des critères : ok | chk | no ---------- */
const SYM = { ok: '✓', chk: '?', no: '✕' };
const chip = (s, t) => '<span class="chip ' + s + '"><span class="sym" aria-hidden="true">' + SYM[s] + '</span>' + esc(t) + '</span>';
const tri = (v, name, y, p, n, u) => v === 'Y' ? { s: 'ok', t: name + ' : ' + y } : v === 'P' ? { s: 'chk', t: name + ' : ' + p } : v === 'N' ? { s: 'no', t: name + ' : ' + n } : { s: 'chk', t: name + ' : ' + u };
function st(h, k) {
  switch (k) {
    case 'pool':
      if (h.pool === 'Y') return { s: 'ok', t: 'Piscine : oui' };
      if (h.pool === '?') return { s: 'chk', t: 'Piscine : à vérifier' };
      if (h.land >= 600) return { s: 'chk', t: 'Piscine : à créer, terrain suffisant' };
      if (h.land >= 500) return { s: 'chk', t: 'Piscine : à créer, terrain juste' };
      return { s: 'no', t: 'Piscine : terrain trop petit' };
    case 'suite': return tri(h.suite, 'Suite parentale', 'oui', 'à créer', 'non', 'non précisée');
    case 'bureau': return tri(h.bureau, 'Bureau ou pièce en plus', 'oui', 'à créer', 'non', 'non précisé');
    case 'dep': return tri(h.dep, 'Dépendance ou studio', 'oui', 'à créer', 'non', 'non précisée');
    case 'clim': return tri(h.clim, 'Climatisation', 'oui', 'partielle', 'non', 'non précisée');
    case 'gare': return { s: h.gare <= 30 ? 'ok' : h.gare <= 35 ? 'chk' : 'no', t: 'Gare ' + h.gnote };
    case 'etat': return ({
      parfait: { s: 'ok', t: 'Bon état, sans travaux' }, ras: { s: 'chk', t: 'État non précisé' },
      refresh: { s: 'chk', t: 'Rafraîchissement à prévoir' }, reno: { s: 'no', t: 'Rénovation à prévoir' },
      inacheve: { s: 'no', t: 'Étage à terminer' }
    })[h.cond];
    case 'terrain': return { s: h.land >= 600 ? 'ok' : 'no', t: 'Terrain ' + nf(h.land) + ' m²' };
    case 'dpe': return { s: 'ok', t: 'DPE ' + h.dpe };
  }
}
const short = (x) => { const t = x.t.indexOf(' : ') > 0 ? x.t.split(' : ')[1] : x.t; return t.charAt(0).toUpperCase() + t.slice(1); };
const KEYS = ['pool', 'gare', 'dep', 'etat', 'suite', 'bureau', 'clim', 'terrain'];
const chips = (h, keys) => '<ul class="chips">' + keys.map((k) => '<li>' + chip(st(h, k).s, st(h, k).t) + '</li>').join('') + '</ul>';
function cardChips(h) {
  const pool = st(h, 'pool'), gare = st(h, 'gare'), dep = st(h, 'dep'), etat = st(h, 'etat');
  const items = [
    [pool.s, h.pool === 'Y' ? 'Piscine' : h.pool === '?' ? 'Piscine à vérifier' : pool.s === 'no' ? 'Sans piscine' : 'Piscine à créer'],
    [gare.s, 'Gare ≈ ' + h.gare + ' min'],
    [dep.s, h.dep === 'Y' ? 'Dépendance' : h.dep === 'P' ? 'Dépendance à créer' : 'Sans dépendance'],
    [etat.s, etat.t]
  ];
  return '<ul class="chips">' + items.map((x) => '<li>' + chip(x[0], x[1]) + '</li>').join('') + '</ul>';
}
const dpeBadge = (c) => '<span class="dpe dpe-' + esc(c) + '" title="Diagnostic de performance énergétique">DPE ' + esc(c) + '</span>';
const statutBadge = (h) => '<span class="statut s-' + h.statut + '">' + esc(STATUTS[h.statut]) + '</span>';
const titre = (h) => 'Maison ' + h.pieces + ' pièces';

/* ---------- état de l'interface ---------- */
const S = { view: store.get('view', 'cards'), sort: 'score', q: '', commune: '', pmax: 0, m2: 0, ch: 0, pool: 'all', tog: {}, statut: '', cmp: store.get('cmp', []) };
if (['cards', 'table', 'map'].indexOf(S.view) < 0) S.view = 'cards';
let PMIN = 0, PMAX = 0;
const TOG = {
  gare: { f: (h) => h.gare <= 30, l: 'Gare à 30 min ou moins' },
  dep: { f: (h) => h.dep === 'Y' || h.dep === 'P', l: 'Dépendance ou studio' },
  suite: { f: (h) => h.suite === 'Y', l: 'Suite parentale existante' },
  etat: { f: (h) => h.cond === 'parfait', l: 'Bon état, sans travaux' },
  dpe: { f: (h) => h.dpe === 'A' || h.dpe === 'B', l: 'DPE A ou B' },
  terrain: { f: (h) => h.land >= 600, l: 'Terrain de 600 m² ou plus' }
};
const SORTS = {
  score: (x, y) => y.score - x.score, priceAsc: (x, y) => x.price - y.price, priceDesc: (x, y) => y.price - x.price,
  ppm: (x, y) => x.ppm - y.ppm, m2: (x, y) => y.m2 - x.m2, land: (x, y) => y.land - x.land, gare: (x, y) => x.gare - y.gare
};
function visible() {
  const q = norm(S.q.trim());
  const a = H.filter((h) => {
    if (h.price > S.pmax) return false;
    if (S.commune && h.commune !== S.commune) return false;
    if (S.m2 && h.m2 < S.m2) return false;
    if (S.ch && h.ch < S.ch) return false;
    if (S.pool === 'yes' && h.pool !== 'Y') return false;
    if (S.pool === 'create' && !(h.pool === 'N' && h.land >= 600)) return false;
    if (S.statut && h.statut !== S.statut) return false;
    for (const k in S.tog) if (S.tog[k] && !TOG[k].f(h)) return false;
    if (q && norm(h.label + ' ' + h.notes + ' ' + titre(h) + ' ' + STATUTS[h.statut]).indexOf(q) < 0) return false;
    return true;
  });
  const c = SORTS[S.sort] || SORTS.score;
  /* les biens écartés passent en fin de liste */
  a.sort((x, y) => ((x.statut === 'ecarte') - (y.statut === 'ecarte')) || c(x, y) || (y.score - x.score));
  return a;
}
function activeFilters() {
  const a = [];
  if (S.q.trim()) a.push(['q', '« ' + S.q.trim() + ' »']);
  if (S.commune) a.push(['commune', S.commune]);
  if (S.pmax < PMAX) a.push(['pmax', 'Jusqu’à ' + eur(S.pmax)]);
  if (S.m2) a.push(['m2', S.m2 + ' m² et plus']);
  if (S.ch) a.push(['ch', S.ch + ' chambres et plus']);
  if (S.pool === 'yes') a.push(['pool', 'Piscine en place']);
  if (S.pool === 'create') a.push(['pool', 'Piscine à créer']);
  for (const k in S.tog) if (S.tog[k]) a.push(['tog:' + k, TOG[k].l]);
  if (S.statut) a.push(['statut', STATUTS[S.statut]]);
  return a;
}
function clearFilter(k) {
  if (k === 'q') S.q = '';
  else if (k === 'commune') S.commune = '';
  else if (k === 'pmax') S.pmax = PMAX;
  else if (k === 'm2') S.m2 = 0;
  else if (k === 'ch') S.ch = 0;
  else if (k === 'pool') S.pool = 'all';
  else if (k === 'statut') S.statut = '';
  else if (k.indexOf('tog:') === 0) S.tog[k.slice(4)] = false;
}
function resetFilters() { S.q = ''; S.commune = ''; S.pmax = PMAX; S.m2 = 0; S.ch = 0; S.pool = 'all'; S.tog = {}; S.statut = ''; }
function syncForm() {
  $('f-q').value = S.q; $('f-commune').value = S.commune; $('f-pmax').value = S.pmax; $('f-m2').value = S.m2;
  $('f-ch').value = S.ch; $('f-pool').value = S.pool; $('f-statut').value = S.statut; $('sort').value = S.sort;
  $('f-pmaxv').textContent = eur(S.pmax);
  document.querySelectorAll('#fform [data-t]').forEach((b) => { b.checked = !!S.tog[b.getAttribute('data-t')]; });
}

/* ---------- cartes ---------- */
function card(h, idx) {
  const sel = S.cmp.indexOf(h.n) >= 0;
  const n = Math.min(3, h.nph);
  let slides = '';
  for (let i = 0; i < n; i++) {
    slides += '<a class="car-slide" href="#bien-' + h.n + '" ' + (i ? 'tabindex="-1" aria-hidden="true"' : 'aria-label="Photos de la maison à ' + esc(h.label) + ', voir la fiche"') + '>' +
      '<img src="' + photo(h, i, 's') + '" alt="" loading="' + (idx < 3 && i === 0 ? 'eager' : 'lazy') + '" decoding="async" width="640" height="427"></a>';
  }
  let dots = '';
  for (let i = 0; i < n; i++) dots += '<i' + (i ? '' : ' class="on"') + '></i>';
  return '<article class="card' + (sel ? ' sel' : '') + (h.statut === 'ecarte' ? ' off' : '') + '" data-n="' + h.n + '">' +
    '<div class="car">' +
      '<div class="car-track">' + slides + '</div>' +
      '<button type="button" class="car-nav prev" data-car="-1" aria-label="Photo précédente" hidden>‹</button>' +
      '<button type="button" class="car-nav next" data-car="1" aria-label="Photo suivante">›</button>' +
      '<span class="car-dots" aria-hidden="true">' + dots + '</span>' +
      '<span class="car-top">' + statutBadge(h) + '<span class="pill" title="Score sur 100 selon nos critères"><b>' + h.score + '</b>/100</span></span>' +
    '</div>' +
    '<div class="cbody">' +
      '<div class="chead"><div><h3><a href="#bien-' + h.n + '" tabindex="-1">' + esc(h.label) + '</a></h3><p class="ctype">' + titre(h) + ' · réf. ' + h.n + '</p></div>' +
      '<div class="cprice"><b>' + eur(h.price) + '</b><span>' + nf(h.ppm) + NBSP + '€/m²</span></div></div>' +
      '<p class="cfacts"><span>' + h.m2 + NBSP + 'm²</span><span>' + h.ch + NBSP + 'ch.</span><span>Terrain ' + nf(h.land) + NBSP + 'm²</span>' + dpeBadge(h.dpe) + '</p>' +
      cardChips(h) +
      '<p class="cnotes">' + esc(h.notes) + '</p>' +
      '<div class="cact"><a class="btn primary small" href="#bien-' + h.n + '">Voir la fiche</a>' +
      '<label class="cmp"><input type="checkbox" data-cmp="' + h.n + '"' + (sel ? ' checked' : '') + '><span>Comparer</span></label></div>' +
    '</div></article>';
}

/* ---------- tableau ---------- */
const COLS = [['n', 'Réf.'], ['label', 'Commune'], ['price', 'Prix', 'priceAsc'], ['ppm', '€/m²', 'ppm'], ['m2', 'Surface', 'm2'], ['land', 'Terrain', 'land'], ['ch', 'Ch.'], ['dpe', 'DPE'], ['pool', 'Piscine'], ['suite', 'Suite'], ['dep', 'Dépendance'], ['clim', 'Clim'], ['gare', 'Gare', 'gare'], ['etat', 'État'], ['statut', 'Suivi'], ['score', 'Score', 'score']];
function cell(h, k) {
  switch (k) {
    case 'n': return '<td class="num muted">' + h.n + '</td>';
    case 'label': return '<th scope="row" class="name"><a href="#bien-' + h.n + '">' + esc(h.label) + '</a></th>';
    case 'price': return '<td class="num"><b>' + eur(h.price) + '</b></td>';
    case 'ppm': return '<td class="num">' + nf(h.ppm) + '</td>';
    case 'm2': return '<td class="num">' + h.m2 + NBSP + 'm²</td>';
    case 'land': return '<td class="num">' + nf(h.land) + NBSP + 'm²</td>';
    case 'ch': return '<td class="num">' + h.ch + '</td>';
    case 'dpe': return '<td>' + dpeBadge(h.dpe) + '</td>';
    case 'pool': {
      const x = st(h, 'pool');
      const t = h.pool === 'N' ? (h.land >= 600 ? 'À créer' : h.land >= 500 ? 'À créer (juste)' : 'Trop petit') : short(x);
      return '<td>' + chip(x.s, t) + '</td>';
    }
    case 'suite': case 'dep': case 'clim': case 'etat': return '<td>' + chip(st(h, k).s, short(st(h, k))) + '</td>';
    case 'gare': return '<td>' + chip(st(h, 'gare').s, '≈ ' + h.gare + ' min') + '</td>';
    case 'statut': return '<td>' + statutBadge(h) + '</td>';
    case 'score': return '<td class="num"><b>' + h.score + '</b></td>';
  }
}
function table(a) {
  const th = COLS.map((c) => {
    const cur = c[2] && (c[2] === S.sort || (c[0] === 'price' && S.sort === 'priceDesc'));
    const dir = S.sort === 'priceDesc' || S.sort === 'score' || S.sort === 'm2' || S.sort === 'land' ? 'descending' : 'ascending';
    return '<th scope="col"' + (cur ? ' aria-sort="' + dir + '"' : '') + '>' + (c[2] ? '<button type="button" data-sort="' + c[2] + '">' + c[1] + '<span aria-hidden="true">' + (cur ? (dir === 'descending' ? ' ↓' : ' ↑') : '') + '</span></button>' : c[1]) + '</th>';
  }).join('') + '<th scope="col">Comparer</th>';
  const rows = a.map((h) => '<tr' + (h.statut === 'ecarte' ? ' class="off"' : '') + '>' + COLS.map((c) => cell(h, c[0])).join('') +
    '<td class="ctr"><input type="checkbox" data-cmp="' + h.n + '" aria-label="Comparer ' + esc(h.label) + '"' + (S.cmp.indexOf(h.n) >= 0 ? ' checked' : '') + '></td></tr>').join('');
  return '<div class="tablewrap" tabindex="0" role="region" aria-label="Tableau des biens, défilement horizontal"><table><thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* ---------- plan (Leaflet chargé à la demande) ---------- */
let map = null, layer = null, leafletP = null;
function loadLeaflet() {
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/vendor/leaflet/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'assets/vendor/leaflet/leaflet.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  return leafletP;
}
function mapShell() {
  return '<div class="mapwrap"><div id="map" role="application" aria-label="Plan des communes"></div>' +
    '<ul class="maplegend"><li><span class="pin" aria-hidden="true">2</span>Commune et nombre de biens</li><li><span class="poi gare" aria-hidden="true">' + ICON.gare + '</span>Gare</li><li><span class="poi aeroport" aria-hidden="true">' + ICON.aeroport + '</span>Aéroport</li></ul>' +
    '<p class="note">Les maisons sont placées au centre de leur commune, pas à leur adresse. Touchez un repère pour voir les biens.</p></div>';
}
const ICON = {
  gare: '<svg viewBox="0 0 20 20" width="14" height="14"><rect x="5" y="3" width="10" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 9h10M7.5 17l1.5-3M12.5 17 11 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>',
  aeroport: '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M10 2.5c.8 0 1.2.9 1.2 2v3.2l5.3 3.2v1.6l-5.3-1.6v3.3l1.6 1.2v1.3L10 16l-2.8.7v-1.3l1.6-1.2v-3.3l-5.3 1.6v-1.6l5.3-3.2V4.500c0-1.100.4-2 1.200-2z" fill="currentColor"/></svg>'
};
function drawMap(a) {
  loadLeaflet().then(() => {
    const L = window.L, el = $('map');
    if (!el) return;
    if (!map) {
      map = L.map(el, { scrollWheelZoom: false, minZoom: 8, maxZoom: 13 });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 13, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
      D.poi.forEach((p) => {
        L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<span class="poi ' + p.t + '">' + ICON[p.t] + '</span>', iconSize: [26, 26], iconAnchor: [-9, -9] }), title: p.nom, keyboard: false })
          .addTo(map).bindPopup('<b>' + esc(p.nom) + '</b>');
      });
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    const by = {};
    a.forEach((h) => { (by[h.commune] = by[h.commune] || []).push(h); });
    const pts = [];
    Object.keys(by).forEach((c) => {
      const p = D.places[c]; if (!p) return;
      pts.push(p);
      const list = by[c].map((h) => '<li><a href="#bien-' + h.n + '"><b>' + eur(h.price) + '</b> · ' + h.m2 + NBSP + 'm² · ' + h.ch + NBSP + 'ch.<br><span>' + esc(h.label) + ', score ' + h.score + '</span></a></li>').join('');
      L.marker(p, { icon: L.divIcon({ className: '', html: '<span class="pin">' + by[c].length + '</span>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 500, title: c + ' : ' + by[c].length + ' bien' + (by[c].length > 1 ? 's' : ''), alt: c })
        .addTo(layer).bindPopup('<div class="mpop"><h4>' + esc(c) + '</h4><ul>' + list + '</ul></div>', { minWidth: 220 });
    });
    D.poi.forEach((p) => pts.push([p.lat, p.lon]));
    map.invalidateSize();
    if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
  }).catch(() => { const el = $('map'); if (el) el.innerHTML = '<p class="empty">Le plan n’a pas pu se charger. Les vues Cartes et Tableau restent disponibles.</p>'; });
}

/* ---------- rendu ---------- */
function render() {
  const a = visible(), out = $('out');
  $('count').innerHTML = '<b>' + a.length + '</b> bien' + (a.length > 1 ? 's' : '') + (a.length < H.length ? ' sur ' + H.length : '');
  const act = activeFilters();
  $('active').innerHTML = act.map((x) => '<li><button type="button" class="tag" data-clear="' + esc(x[0]) + '" aria-label="Retirer le filtre ' + esc(x[1]) + '">' + esc(x[1]) + '<span aria-hidden="true">✕</span></button></li>').join('') +
    (act.length > 1 ? '<li><button type="button" class="link" id="clear-all">Tout effacer</button></li>' : '');
  $('active').hidden = !act.length;
  const fc = $('f-count'); fc.hidden = !act.length; fc.textContent = act.length;
  $('f-apply').textContent = a.length ? 'Voir ' + (a.length > 1 ? 'les ' + a.length + ' biens' : 'le bien') : 'Aucun bien';
  document.querySelectorAll('.seg [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === S.view)));
  if (S.view !== 'map' && map) { map.remove(); map = null; layer = null; }
  if (!a.length) {
    if (map) { map.remove(); map = null; layer = null; }
    out.innerHTML = '<div class="empty"><p><b>Aucun bien ne correspond à ces filtres.</b></p><p>Augmentez le prix maximum ou retirez un critère.</p><button type="button" class="btn" id="clear-all">Tout effacer</button></div>';
  } else if (S.view === 'cards') {
    out.innerHTML = '<div class="cards">' + a.map(card).join('') + '</div>';
  } else if (S.view === 'table') {
    out.innerHTML = table(a);
  } else {
    if (!map || !$('map')) { if (map) { map.remove(); map = null; } out.innerHTML = mapShell(); }
    drawMap(a);
  }
  renderBar();
}
function renderBar() {
  const b = $('cbar'), hs = S.cmp.map(byN).filter(Boolean);
  b.hidden = !hs.length;
  document.body.classList.toggle('has-cbar', hs.length > 0);
  $('cbar-sel').innerHTML = hs.map((h) => '<span class="csel"><img src="' + photo(h, 0, 's') + '" alt="" width="44" height="33"><span>' + esc(h.label) + '</span><button type="button" data-uncmp="' + h.n + '" aria-label="Retirer ' + esc(h.label) + ' de la sélection">✕</button></span>').join('') +
    (hs.length === 1 ? '<span class="chint">Ajoutez un bien pour comparer</span>' : '');
  $('c-go').disabled = hs.length < 2;
  $('c-go').textContent = hs.length < 2 ? 'Comparer' : 'Comparer (' + hs.length + ')';
  store.set('cmp', S.cmp);
}
function toggleCmp(n, on) {
  const i = S.cmp.indexOf(n);
  if (on && i < 0) { if (S.cmp.length >= 4) { toast('Quatre biens au maximum dans une comparaison'); return false; } S.cmp.push(n); }
  if (!on && i >= 0) S.cmp.splice(i, 1);
  return true;
}

/* ---------- messages ---------- */
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 2600); }
function copy(text, ok) {
  const done = () => toast(ok || 'Copié');
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    (document.querySelector('dialog[open]') || document.body).appendChild(ta); ta.select();
    let good = false; try { good = document.execCommand('copy'); } catch (e) { /* refusé */ }
    ta.remove(); toast(good ? (ok || 'Copié') : 'Copie impossible : sélectionnez le texte à la main');
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
}
const ficheUrl = (h) => SITE + '#bien-' + h.n;
function message(hs, withGeneral) {
  let t = 'Bonjour,\n\n' + (hs.length > 1 ? 'Nous souhaitons avancer sur les biens suivants.' : 'Nous souhaitons avancer sur ce bien.') + ' Pourriez-vous nous répondre par écrit sur les points ci-dessous ?\n';
  hs.forEach((h, i) => {
    t += '\n' + (hs.length > 1 ? (i + 1) + ') ' : '') + h.label + ', ' + titre(h).toLowerCase() + ' de ' + h.m2 + ' m², ' + plain(eur(h.price)) + ' (réf. ' + h.n + ')\n';
    t += 'Annonce : ' + h.url + '\nFiche : ' + ficheUrl(h) + '\n';
    h.q.forEach((q) => { t += '- ' + q + '\n'; });
  });
  if (withGeneral) { t += '\nPour ' + (hs.length > 1 ? 'chacun de ces biens' : 'ce bien') + ', merci aussi de nous indiquer :\n'; D.general.forEach((q) => { t += '- ' + q + '\n'; }); }
  return t + '\nMerci d’avance,\n';
}

/* ---------- dialogues ---------- */
const dF = $('dlg-fiche'), dC = $('dlg-cmp'), dS = $('dlg-send'), dB = $('dlg-box');
function show(d) { if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } } d.scrollTop = 0; document.body.classList.add('modal'); }
/* fermeture décidée par le code : ne doit pas modifier l'adresse */
function hide(d) { if (d.open) { d._prog = true; try { d.close(); } catch (e) { d.removeAttribute('open'); d._prog = false; } } }
[dF, dC, dS, dB].forEach((d) => {
  d.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal'); });
  d.addEventListener('click', (e) => { if (e.target === d) closeDialog(d); });
});
/* la fiche et la comparaison ont une adresse ; fermer revient à quitter cette adresse */
let pushed = false;
const onRoute = () => /^#(bien-\d+|comparer=[\d,]+)$/.test(location.hash);
function leave() {
  if (pushed) { pushed = false; history.back(); }
  else { history.replaceState(null, '', location.pathname + location.search); route(); }
}
function closeDialog(d) { if ((d === dF || d === dC) && onRoute()) leave(); else hide(d); }
[dF, dC, dS, dB].forEach((d) => d.addEventListener('close', () => { const prog = d._prog; d._prog = false; if (!prog && (d === dF || d === dC) && onRoute()) leave(); }));
function go(hash) { if (location.hash === hash) { route(); return; } if (!onRoute()) pushed = true; else { location.replace(hash); return; } location.hash = hash; }
function route() {
  const b = /^#bien-(\d+)$/.exec(location.hash), c = /^#comparer=([\d,]+)$/.exec(location.hash);
  if (b && byN(+b[1])) { hide(dC); fiche(+b[1]); return; }
  if (c) {
    const ns = c[1].split(',').map(Number).filter((n, i, arr) => byN(n) && arr.indexOf(n) === i).slice(0, 4);
    if (ns.length >= 2) { S.cmp = ns; renderBar(); document.querySelectorAll('[data-cmp]').forEach((x) => { x.checked = S.cmp.indexOf(+x.getAttribute('data-cmp')) >= 0; }); hide(dF); compare(); return; }
  }
  hide(dB); hide(dF); hide(dC);
}

/* ---------- fiche ---------- */
let cur = null, gi = 0;
function dvfBlock(h) {
  const d = D.dvf[h.commune];
  if (!d) return '<p class="dvf muted">Prix au m² de référence non disponible pour cette commune.</p>';
  const diff = Math.round((h.ppm / d.med - 1) * 100);
  const cls = diff > 5 ? 'up' : diff < -5 ? 'down' : 'eq';
  const txt = diff > 0 ? '+' + diff + NBSP + '% au-dessus' : diff < 0 ? '−' + Math.abs(diff) + NBSP + '% en dessous' : 'au niveau';
  return '<div class="dvf"><span class="delta ' + cls + '">' + txt + '</span> <span>de la médiane des maisons vendues à ' + esc(h.commune) + ' : <b>' + nf(d.med) + NBSP + '€/m²</b> (' + d.n + ' ventes depuis 2023, source DVF).</span>' +
    '<p class="muted">Repère indicatif : il ne tient compte ni de l’état, ni de la piscine, ni du terrain.</p></div>';
}
function dpeScale(c) {
  return '<ol class="dpescale" aria-label="Classe énergie ' + esc(c) + ' sur une échelle de A à G">' + 'ABCDEFG'.split('').map((x) => '<li class="dpe-' + x + (x === c ? ' on' : '') + '"' + (x === c ? ' aria-current="true"' : '') + '>' + x + '</li>').join('') + '</ol>';
}
function contactHref(h) {
  if (CONTACT.email) return 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent(h ? 'Proposition de visite : ' + h.label + ' (réf. ' + h.n + ')' : 'Proposition de visite');
  if (CONTACT.tel) return 'tel:' + CONTACT.tel.replace(/[^\d+]/g, '');
  return '';
}
function fiche(n) {
  const h = byN(n); if (!h) return;
  const list = visible().some((x) => x.n === n) ? visible() : H.slice().sort(SORTS.score);
  const i = list.findIndex((x) => x.n === n), prev = list[(i - 1 + list.length) % list.length], next = list[(i + 1) % list.length];
  cur = h; gi = 0;
  const sel = S.cmp.indexOf(n) >= 0;
  let thumbs = '';
  for (let k = 0; k < h.nph; k++) thumbs += '<button type="button" data-gal="' + k + '"' + (k ? '' : ' aria-current="true"') + ' aria-label="Photo ' + (k + 1) + ' sur ' + h.nph + '"><img src="' + photo(h, k, 's') + '" alt="" loading="lazy" width="96" height="64"></button>';
  const facts = [['Surface', h.m2 + NBSP + 'm²'], ['Terrain', nf(h.land) + NBSP + 'm²'], ['Pièces', h.pieces], ['Chambres', h.ch], ['Année', h.year || 'Non précisée'], ['Gare', h.gnote.replace(/^≈ /, '≈' + NBSP)]];
  const ch = contactHref(h);
  dF.innerHTML =
    '<header class="dh"><button type="button" class="btn ghost small back" data-close>← <span>Tous les biens</span></button>' +
    '<div class="dh-nav"><a class="btn ghost small" href="#bien-' + prev.n + '" data-replace aria-label="Bien précédent : ' + esc(prev.label) + '">‹ <span>Précédent</span></a><a class="btn ghost small" href="#bien-' + next.n + '" data-replace aria-label="Bien suivant : ' + esc(next.label) + '"><span>Suivant</span> ›</a>' +
    '<button type="button" class="btn ghost small x" data-close aria-label="Fermer la fiche">✕</button></div></header>' +
    '<div class="fb">' +
      '<div class="fg"><div class="gal">' +
        '<button type="button" class="gal-main" data-box aria-label="Agrandir la photo"><img id="gal-img" src="' + photo(h, 0, 'l') + '" alt="Photo 1 de la maison à ' + esc(h.label) + '" width="1400" height="933"></button>' +
        (h.nph > 1 ? '<button type="button" class="car-nav prev" data-galnav="-1" aria-label="Photo précédente">‹</button><button type="button" class="car-nav next" data-galnav="1" aria-label="Photo suivante">›</button>' : '') +
        '<span class="gal-count" id="gal-count">1 / ' + h.nph + '</span><span class="gal-zoom" aria-hidden="true">Agrandir</span>' +
      '</div><div class="gal-thumbs" id="gal-thumbs">' + thumbs + '</div></div>' +
      '<aside class="fs">' +
        '<p class="f-meta">' + statutBadge(h) + '<span class="muted">Réf. ' + h.n + ' · mis à jour le ' + dateFr(h.maj) + '</span></p>' +
        '<h2 id="fiche-t">' + esc(h.label) + '</h2><p class="ctype">' + titre(h) + ' · ' + h.m2 + NBSP + 'm² · ' + h.ch + ' chambres</p>' +
        (h.suivi ? '<p class="f-suivi">' + esc(h.suivi) + '</p>' : '') +
        '<p class="f-price"><b>' + eur(h.price) + '</b><span>' + nf(h.ppm) + NBSP + '€/m²</span></p>' + dvfBlock(h) +
        '<div class="f-score" role="img" aria-label="Score ' + h.score + ' sur 100, rang ' + h.rank + ' sur ' + H.length + '"><b>' + h.score + '</b><span>/100</span><div class="bar"><i style="width:' + h.score + '%"></i></div><span class="rk">' + (h.rank === 1 ? '1er' : h.rank + 'e') + ' sur ' + H.length + '</span></div>' +
        '<div class="f-act">' +
          '<a class="btn primary" href="' + esc(h.url) + '" target="_blank" rel="noopener">Voir l’annonce d’origine <span aria-hidden="true">↗</span></a>' +
          (ch ? '<a class="btn" href="' + esc(ch) + '">Proposer une visite</a>' : '') +
          '<button type="button" class="btn" data-addcmp="' + n + '" aria-pressed="' + sel + '">' + (sel ? '✓ Dans la comparaison' : 'Ajouter à la comparaison') + '</button>' +
          '<div class="f-act2"><button type="button" class="btn ghost small" data-send="' + n + '">Préparer un e-mail</button><button type="button" class="btn ghost small" data-print="' + n + '">Imprimer</button><button type="button" class="btn ghost small" data-link="' + n + '">Copier le lien</button></div>' +
        '</div>' +
      '</aside>' +
      '<div class="fm">' +
        '<section><h3>L’essentiel</h3><dl class="facts">' + facts.map((f) => '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>').join('') + '</dl>' +
        '<div class="dperow"><span>Classe énergie</span>' + dpeScale(h.dpe) + '</div>' +
        '<p class="f-notes">' + esc(h.notes) + '</p></section>' +
        '<section><h3>Nos critères sur ce bien</h3>' + chips(h, KEYS) + '</section>' +
        '<section><div class="sec-head"><h3>Questions à poser</h3><button type="button" class="btn small" data-copyq="' + n + '">Copier</button></div><ol class="qlist">' + h.q.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' +
        '<p class="note">Les <a href="#questions" data-close-go>questions communes à tous les biens</a> s’ajoutent à celles-ci.</p></section>' +
      '</div>' +
    '</div>';
  show(dF);
}
function galSet(k) {
  if (!cur) return;
  gi = (k + cur.nph) % cur.nph;
  const img = $('gal-img'); if (!img) return;
  img.src = photo(cur, gi, 'l'); img.alt = 'Photo ' + (gi + 1) + ' de la maison à ' + cur.label;
  $('gal-count').textContent = (gi + 1) + ' / ' + cur.nph;
  document.querySelectorAll('#gal-thumbs button').forEach((b, j) => { if (j === gi) { b.setAttribute('aria-current', 'true'); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else b.removeAttribute('aria-current'); });
  if (dB.open) boxDraw();
}
/* plein écran */
function boxDraw() {
  dB.innerHTML = '<img src="' + photo(cur, gi, 'l') + '" alt="Photo ' + (gi + 1) + ' de la maison à ' + esc(cur.label) + '">' +
    '<button type="button" class="box-x" data-boxclose aria-label="Fermer le plein écran">✕</button>' +
    (cur.nph > 1 ? '<button type="button" class="box-nav prev" data-galnav="-1" aria-label="Photo précédente">‹</button><button type="button" class="box-nav next" data-galnav="1" aria-label="Photo suivante">›</button>' : '') +
    '<span class="box-count">' + esc(cur.label) + ' · ' + (gi + 1) + ' / ' + cur.nph + '</span>';
}
function boxOpen() { boxDraw(); show(dB); }

/* ---------- comparaison ---------- */
function compare() {
  const hs = S.cmp.map(byN).filter(Boolean);
  if (hs.length < 2) return;
  const rows = [
    ['Prix', (h) => eur(h.price), (h) => h.price, 'min'],
    ['Prix au m²', (h) => nf(h.ppm) + NBSP + '€', (h) => h.ppm, 'min'],
    ['Surface', (h) => h.m2 + NBSP + 'm²', (h) => h.m2, 'max'],
    ['Terrain', (h) => nf(h.land) + NBSP + 'm²', (h) => h.land, 'max'],
    ['Chambres', (h) => h.ch, (h) => h.ch, 'max'],
    ['DPE', (h) => dpeBadge(h.dpe), (h) => 'ABCDEFG'.indexOf(h.dpe), 'min'],
    ['Gare', (h) => esc(h.gnote), (h) => h.gare, 'min'],
    ['Score', (h) => '<b>' + h.score + '</b> / 100', (h) => h.score, 'max']
  ];
  const stat = [['Piscine', 'pool'], ['Suite parentale', 'suite'], ['Bureau ou pièce', 'bureau'], ['Dépendance ou studio', 'dep'], ['Climatisation', 'clim'], ['État', 'etat']];
  const head = '<tr><td></td>' + hs.map((h) => '<th scope="col"><a href="#bien-' + h.n + '" data-replace><img src="' + photo(h, 0, 's') + '" alt="" width="200" height="133"><span>' + esc(h.label) + '</span></a>' + statutBadge(h) + '</th>').join('') + '</tr>';
  const body = rows.map((r) => {
    const vals = hs.map(r[2]), best = r[3] === 'min' ? Math.min.apply(null, vals) : Math.max.apply(null, vals), tie = vals.every((v) => v === vals[0]);
    return '<tr><th scope="row">' + r[0] + '</th>' + hs.map((h, i) => '<td' + (!tie && vals[i] === best ? ' class="best"' : '') + '>' + r[1](h) + (!tie && vals[i] === best ? '<span class="vh"> (meilleure valeur)</span>' : '') + '</td>').join('') + '</tr>';
  }).join('') + stat.map((r) => '<tr><th scope="row">' + r[0] + '</th>' + hs.map((h) => '<td>' + chip(st(h, r[1]).s, short(st(h, r[1]))) + '</td>').join('') + '</tr>').join('') +
    '<tr><th scope="row">En bref</th>' + hs.map((h) => '<td class="txt">' + esc(h.notes) + '</td>').join('') + '</tr>' +
    '<tr><th scope="row">Questions</th>' + hs.map((h) => '<td class="txt"><ol class="qlist">' + h.q.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></td>').join('') + '</tr>' +
    '<tr><th scope="row">Annonce</th>' + hs.map((h) => '<td><a class="btn small" href="' + esc(h.url) + '" target="_blank" rel="noopener">Ouvrir <span aria-hidden="true">↗</span></a></td>').join('') + '</tr>';
  dC.innerHTML = '<header class="dh"><h2 id="cmp-t">Comparaison de ' + hs.length + ' biens</h2><button type="button" class="btn ghost small x" data-close aria-label="Fermer la comparaison">✕</button></header>' +
    '<div class="db"><div class="dacts"><button type="button" class="btn small" data-sendcmp>Préparer un e-mail</button><button type="button" class="btn small" data-printcmp>Imprimer</button><button type="button" class="btn small" data-linkcmp>Copier le lien</button></div><p class="note">Le fond vert marque la meilleure valeur de chaque ligne. Vert : présent dans l’annonce. Orange : à vérifier ou à créer. Rouge : absent.</p>' +
    '<div class="cmpwrap" tabindex="0" role="region" aria-label="Tableau de comparaison, défilement horizontal"><table class="cmpt" style="--n:' + hs.length + '"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
  show(dC);
}

/* ---------- e-mail ---------- */
let sendList = [];
function send(hs) {
  sendList = hs;
  dS.innerHTML = '<header class="dh"><h2 id="send-t">Préparer un e-mail</h2><button type="button" class="btn ghost small x" data-close aria-label="Fermer">✕</button></header>' +
    '<div class="db"><p class="note">Le message reprend ' + (hs.length > 1 ? 'les ' + hs.length + ' biens choisis' : 'ce bien') + ' et leurs questions. Vous pouvez le modifier avant de l’envoyer.</p>' +
    '<label class="optline"><input type="checkbox" id="send-gen"><span>Ajouter les questions communes à tous les biens</span></label>' +
    '<label class="vh" for="send-txt">Message</label><textarea id="send-txt" rows="14" spellcheck="true"></textarea>' +
    '<div class="send-act"><button type="button" class="btn primary" id="send-copy">Copier le message</button><button type="button" class="btn" id="send-mail">Ouvrir dans ma messagerie</button></div></div>';
  $('send-txt').value = message(hs, false);
  show(dS);
}
function mailto() {
  const body = $('send-txt').value, subject = sendList.length > 1 ? 'Questions sur ' + sendList.length + ' maisons' : 'Questions sur la maison de ' + sendList[0].label;
  let href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  if (href.length > 1900) {
    /* les messageries coupent les liens trop longs : le texte complet part dans le presse-papiers */
    const shortBody = 'Bonjour,\n\n' + sendList.map((h) => h.label + ' (réf. ' + h.n + ') : ' + ficheUrl(h)).join('\n') + '\n\n[Collez ici les questions copiées]\n';
    href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(shortBody);
    copy(body, 'Message copié : collez-le dans l’e-mail qui s’ouvre');
  }
  location.href = href;
}

/* ---------- impression ---------- */
function printSheets(hs) {
  $('print').innerHTML = hs.map((h) => {
    let ph = '';
    for (let k = 0; k < Math.min(3, h.nph); k++) ph += '<img src="' + photo(h, k, 's') + '" alt="">';
    return '<section class="sheet"><header><div><h1>' + esc(h.label) + '</h1><p>' + titre(h) + ' · réf. ' + h.n + ' · ' + esc(STATUTS[h.statut]) + '</p></div><div class="p-price"><b>' + eur(h.price) + '</b><span>' + nf(h.ppm) + NBSP + '€/m²</span></div></header>' +
      '<div class="p-photos">' + ph + '</div>' +
      '<table class="p-facts"><tr><th>Surface</th><td>' + h.m2 + ' m²</td><th>Terrain</th><td>' + nf(h.land) + ' m²</td><th>Chambres</th><td>' + h.ch + '</td></tr><tr><th>DPE</th><td>' + esc(h.dpe) + '</td><th>Année</th><td>' + (h.year || 'n. p.') + '</td><th>Gare</th><td>' + esc(h.gnote) + '</td></tr><tr><th>Score</th><td>' + h.score + ' / 100</td><th>Annonce</th><td colspan="3">' + esc(h.url.replace('https://www.', '')) + '</td></tr></table>' +
      '<p>' + esc(h.notes) + '</p>' +
      '<h2>Nos critères</h2><ul class="p-crit">' + KEYS.map((k) => '<li>' + SYM[st(h, k).s] + ' ' + esc(st(h, k).t) + '</li>').join('') + '</ul>' +
      '<h2>Questions à poser</h2><ul class="p-q">' + h.q.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<h2>À vérifier pour tous les biens</h2><ul class="p-q p-gen">' + D.general.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<h2>Notes de visite</h2><div class="p-lines"><i></i><i></i><i></i><i></i></div>' +
      '<footer>suivi.becheroy.fr/#bien-' + h.n + ' · fiche du ' + dateFr(D.updated) + '</footer></section>';
  }).join('');
  /* laisser les images se charger avant d'ouvrir l'impression */
  const imgs = Array.from($('print').querySelectorAll('img'));
  Promise.all(imgs.map((im) => im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))).then(() => window.print());
}

/* ---------- filtres (panneau mobile) ---------- */
const filters = $('filters'), scrim = $('scrim');
const isDrawer = () => window.matchMedia('(max-width: 960px)').matches;
function openFilters() { filters.classList.add('open'); scrim.hidden = false; document.body.classList.add('modal'); filters.setAttribute('role', 'dialog'); filters.setAttribute('aria-modal', 'true'); $('f-close').focus(); }
function closeFilters() { if (!filters.classList.contains('open')) return; filters.classList.remove('open'); scrim.hidden = true; document.body.classList.remove('modal'); filters.setAttribute('role', 'search'); filters.removeAttribute('aria-modal'); $('f-open').focus(); }

/* ---------- évènements ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,a,[data-close]'); if (!t) return;
  const has = (a) => t.hasAttribute(a), val = (a) => t.getAttribute(a);
  if (has('data-replace')) { e.preventDefault(); location.replace(val('href')); return; }
  if (has('data-close-go')) { e.preventDefault(); history.replaceState(null, '', '#questions'); pushed = false; route(); $('questions').scrollIntoView(); return; }
  if (t.tagName === 'A' && /^#bien-\d+$/.test(val('href') || '')) { e.preventDefault(); go(val('href')); return; }
  if (has('data-close')) { closeDialog(t.closest('dialog')); return; }
  if (has('data-boxclose')) { hide(dB); return; }
  if (has('data-car')) {
    const tr = t.parentNode.querySelector('.car-track');
    tr.scrollBy({ left: +val('data-car') * tr.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return;
  }
  if (has('data-gal')) { galSet(+val('data-gal')); return; }
  if (has('data-galnav')) { galSet(gi + (+val('data-galnav'))); return; }
  if (has('data-box')) { boxOpen(); return; }
  if (has('data-sort')) { const k = val('data-sort'); S.sort = (k === 'priceAsc' && S.sort === 'priceAsc') ? 'priceDesc' : k; syncForm(); render(); return; }
  if (has('data-view')) { S.view = val('data-view'); store.set('view', S.view); render(); if ($('resultats').getBoundingClientRect().top < 0) $('resultats').scrollIntoView(); return; }
  if (has('data-clear')) { clearFilter(val('data-clear')); syncForm(); render(); return; }
  if (t.id === 'clear-all' || t.id === 'f-reset') { resetFilters(); syncForm(); render(); return; }
  if (has('data-uncmp')) { toggleCmp(+val('data-uncmp'), false); render(); return; }
  if (has('data-addcmp')) {
    const n = +val('data-addcmp'), on = S.cmp.indexOf(n) < 0;
    if (toggleCmp(n, on)) { t.setAttribute('aria-pressed', String(on)); t.textContent = on ? '✓ Dans la comparaison' : 'Ajouter à la comparaison'; render(); toast(on ? 'Ajouté à la comparaison' : 'Retiré de la comparaison'); }
    return;
  }
  if (has('data-copyq')) { const h = byN(+val('data-copyq')); copy(h.label + ' (' + plain(eur(h.price)) + ', réf. ' + h.n + ')\n' + h.q.map((x, i) => (i + 1) + '. ' + x).join('\n'), 'Questions copiées'); return; }
  if (has('data-link')) { copy(ficheUrl(byN(+val('data-link'))), 'Lien de la fiche copié'); return; }
  if (has('data-send')) { send([byN(+val('data-send'))]); return; }
  if (has('data-print')) { printSheets([byN(+val('data-print'))]); return; }
  if (has('data-sendcmp') || t.id === 'c-send') { send(S.cmp.map(byN).filter(Boolean)); return; }
  if (has('data-printcmp') || t.id === 'c-print') { printSheets(S.cmp.map(byN).filter(Boolean)); return; }
  if (has('data-linkcmp')) { copy(SITE + '#comparer=' + S.cmp.join(','), 'Lien de la comparaison copié'); return; }
  if (t.id === 'c-clear') { S.cmp = []; render(); return; }
  if (t.id === 'c-go') { if (S.cmp.length >= 2) go('#comparer=' + S.cmp.join(',')); return; }
  if (t.id === 'send-copy') { copy($('send-txt').value, 'Message copié'); return; }
  if (t.id === 'send-mail') { mailto(); return; }
  if (t.id === 'copy-general') { copy(D.general.map((x, i) => (i + 1) + '. ' + x).join('\n'), 'Questions copiées'); return; }
  if (t.id === 'f-open') { openFilters(); return; }
  if (t.id === 'f-close' || t.id === 'f-apply') { closeFilters(); if (t.id === 'f-apply') $('resultats').scrollIntoView(); return; }
});
scrim.addEventListener('click', closeFilters);
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.hasAttribute('data-cmp')) {
    const n = +t.getAttribute('data-cmp');
    if (!toggleCmp(n, t.checked)) t.checked = false;
    const cd = t.closest('.card'); if (cd) cd.classList.toggle('sel', S.cmp.indexOf(n) >= 0);
    renderBar(); return;
  }
  if (t.hasAttribute('data-t')) { S.tog[t.getAttribute('data-t')] = t.checked; render(); return; }
  if (t.id === 'sort') { S.sort = t.value; render(); return; }
  if (t.id === 'f-commune') { S.commune = t.value; render(); return; }
  if (t.id === 'f-m2') { S.m2 = +t.value; render(); return; }
  if (t.id === 'f-ch') { S.ch = +t.value; render(); return; }
  if (t.id === 'f-pool') { S.pool = t.value; render(); return; }
  if (t.id === 'f-statut') { S.statut = t.value; render(); return; }
  if (t.id === 'send-gen') { $('send-txt').value = message(sendList, t.checked); return; }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'f-pmax') { S.pmax = +t.value; $('f-pmaxv').textContent = eur(S.pmax); clearTimeout(render.t); render.t = setTimeout(render, 60); }
  if (t.id === 'f-q') { S.q = t.value; clearTimeout(render.t); render.t = setTimeout(render, 120); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filters.classList.contains('open')) { closeFilters(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (dB.open || (dF.open && !dS.open)) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { galSet(gi + (e.key === 'ArrowLeft' ? -1 : 1)); e.preventDefault(); }
});
/* points du carrousel et flèches selon la position */
document.addEventListener('scroll', (e) => {
  const tr = e.target; if (!tr.classList || !tr.classList.contains('car-track')) return;
  const i = Math.round(tr.scrollLeft / tr.clientWidth), car = tr.parentNode, n = tr.children.length;
  car.querySelectorAll('.car-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
  car.querySelector('.prev').hidden = i === 0; car.querySelector('.next').hidden = i >= n - 1;
}, true);
/* balayage dans la galerie et le plein écran */
let tx = null;
document.addEventListener('touchstart', (e) => { tx = e.target.closest('.gal, #dlg-box') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', (e) => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 45) galSet(gi + (dx < 0 ? 1 : -1)); }, { passive: true });
window.addEventListener('hashchange', route);
window.addEventListener('afterprint', () => { $('print').innerHTML = ''; });
window.matchMedia('(max-width: 960px)').addEventListener('change', () => { if (!isDrawer()) closeFilters(); });

/* ---------- démarrage ---------- */
function init(etat) {
  applyEtat(etat);
  const prices = H.map((h) => h.price);
  PMIN = Math.min.apply(null, prices); PMAX = Math.max.apply(null, prices); S.pmax = PMAX;
  const pm = $('f-pmax'); pm.min = Math.floor(PMIN / 5000) * 5000; pm.max = PMAX;
  const counts = {}; H.forEach((h) => { counts[h.commune] = (counts[h.commune] || 0) + 1; });
  $('f-commune').innerHTML = '<option value="">Toutes les communes</option>' + Object.keys(counts).sort((a, b) => a.localeCompare(b, 'fr')).map((c) => '<option value="' + esc(c) + '">' + esc(c) + ' (' + counts[c] + ')</option>').join('');
  const used = {}; H.forEach((h) => { used[h.statut] = 1; });
  $('f-statut').innerHTML = '<option value="">Tous les biens</option>' + Object.keys(STATUTS).filter((k) => used[k]).map((k) => '<option value="' + k + '">' + STATUTS[k] + '</option>').join('');
  $('maj').textContent = dateFr(D.updated);
  const nc = Object.keys(counts).length;
  $('stats').innerHTML = '<li><b>' + H.length + '</b> maisons</li><li><b>' + nc + '</b> communes</li><li>de <b>' + eur(PMIN) + '</b> à <b>' + eur(PMAX) + '</b></li>';
  $('weights').innerHTML = D.weights.map((w) => '<li><span>' + esc(w[0]) + '</span><b>' + w[1] + '</b><i style="width:' + (w[1] * 4) + '%"></i></li>').join('');
  $('general').innerHTML = D.general.map((x) => '<li>' + esc(x) + '</li>').join('');
  const c = $('contact'), ch = contactHref(null);
  if (ch) { c.href = ch; c.hidden = false; }
  syncForm(); render(); route();
}
fetch('data/etat.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null).then(init);
})();
