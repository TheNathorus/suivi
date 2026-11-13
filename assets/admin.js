/* Suivi : administration. Lit et écrit data/etat.json dans le dépôt GitHub avec le jeton de la personne connectée. */
(function () {
'use strict';
const REPO = 'TheNathorus/suivi', BRANCH = 'main', FILE = 'data/etat.json';
const API = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE;
const D = window.SUIVI_DATA;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pad = (n) => (n < 10 ? '0' : '') + n;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const STATUTS = { etude: 'À étudier', questions: 'Questions envoyées', visite: 'Visite à prévoir', vu: 'Visité', ecarte: 'Écarté' };
const ANNONCES = { disponible: 'Disponible', prix: 'Prix modifié', compromis: 'Sous compromis', vendue: 'Vendue', retiree: 'Retirée', indisponible: 'Plus disponible', verifier: 'À vérifier' };
const KEY = 'suivi.admin.token';

let token = '', sha = '', saved = null, etat = null, busy = false, auto = {};

/* ---------- stockage du jeton ---------- */
function readToken() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
function writeToken(t, remember) {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); if (t) (remember ? localStorage : sessionStorage).setItem(KEY, t); } catch (e) { /* stockage indisponible */ }
}

/* ---------- GitHub ---------- */
const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function gh(method, body) {
  return fetch(API + (method === 'GET' ? '?ref=' + BRANCH + '&t=' + Date.now() : ''), {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined
  });
}
const fail = (status, writing) => { const e = new Error(explain(status, writing)); e.user = true; return e; };
function explain(status, writing) {
  if (status === 401) return 'Jeton refusé par GitHub. Vérifiez qu’il est complet et qu’il n’a pas expiré.';
  if (status === 403 || status === 404) return writing
    ? 'Ce jeton ne peut pas écrire dans le dépôt. Vérifiez la permission « Contents : Read and write » sur le dépôt suivi.'
    : 'Ce jeton n’a pas accès au dépôt suivi.';
  if (status === 409 || status === 422) return 'Le fichier a changé entre-temps. Rechargez la page, puis refaites la modification.';
  return 'GitHub a répondu par une erreur (' + status + '). Réessayez dans un instant.';
}
function normalize(raw) {
  const e = { maj: (raw && raw.maj) || D.updated, contact: { email: '', tel: '' }, biens: {} };
  if (raw && raw.contact) { e.contact.email = raw.contact.email || ''; e.contact.tel = raw.contact.tel || ''; }
  D.biens.forEach((h) => {
    const x = (raw && raw.biens && raw.biens[h.n]) || {};
    e.biens[h.n] = { visible: x.visible !== false, statut: STATUTS[x.statut] ? x.statut : 'etude', maj: x.maj || D.updated, note: x.note || '' };
    if (ANNONCES[x.annonce]) e.biens[h.n].annonce = x.annonce;   /* absent = lecture automatique */
  });
  return e;
}
function load() {
  return gh('GET').then((r) => {
    if (r.status === 404) return r.json().then(() => { sha = ''; return normalize(null); });
    if (!r.ok) throw fail(r.status, false);
    return r.json().then((j) => { sha = j.sha; return normalize(JSON.parse(b64dec(j.content))); });
  }).then((e) => fetch('../data/annonces.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null)
    .then((a) => { auto = (a && a.biens) || {}; return e; }));
}

/* ---------- rendu ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const dirtyCount = () => {
  let n = 0;
  D.biens.forEach((h) => { if (JSON.stringify(etat.biens[h.n]) !== JSON.stringify(saved.biens[h.n])) n++; });
  if (JSON.stringify(etat.contact) !== JSON.stringify(saved.contact)) n++;
  return n;
};
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 4200); }
function row(h) {
  const e = etat.biens[h.n], changed = JSON.stringify(e) !== JSON.stringify(saved.biens[h.n]);
  return '<li class="a-row' + (e.visible ? '' : ' hid') + (changed ? ' chg' : '') + '" data-n="' + h.n + '">' +
    '<img src="../photos/' + pad(h.n) + '-1-s.jpg" alt="" width="120" height="80" loading="lazy">' +
    '<div class="a-id"><h2>' + esc(h.label) + '</h2><p>' + nf(h.price) + ' € · ' + h.m2 + ' m² · réf. ' + h.n + ' · score ' + h.score + '</p>' +
      '<a href="../#bien-' + h.n + '" target="_blank" rel="noopener">Voir la fiche <span aria-hidden="true">↗</span></a></div>' +
    '<label class="switch"><input type="checkbox" role="switch" data-f="visible"' + (e.visible ? ' checked' : '') + '><span class="sw" aria-hidden="true"></span><span class="sw-l">' + (e.visible ? 'Affiché' : 'Masqué') + '</span></label>' +
    '<label class="fld a-statut"><span>Suivi</span><select data-f="statut">' + Object.keys(STATUTS).map((k) => '<option value="' + k + '"' + (k === e.statut ? ' selected' : '') + '>' + STATUTS[k] + '</option>').join('') + '</select></label>' +
    '<label class="fld a-annonce"><span>Annonce</span><select data-f="annonce"><option value="">Automatique' + (auto[h.n] && ANNONCES[auto[h.n].statut] ? ' (' + ANNONCES[auto[h.n].statut].toLowerCase() + ')' : '') + '</option>' + Object.keys(ANNONCES).map((k) => '<option value="' + k + '"' + (k === e.annonce ? ' selected' : '') + '>Forcer : ' + ANNONCES[k] + '</option>').join('') + '</select></label>' +
    '<label class="fld a-note"><span>Note visible sur la fiche</span><input type="text" data-f="note" maxlength="140" value="' + esc(e.note) + '" placeholder="Ex. : visite le 14 novembre à 10 h"></label>' +
    '</li>';
}
function draw() {
  const q = $('a-q').value.trim().toLowerCase();
  const list = D.biens.filter((h) => !q || (h.label + ' ' + h.n).toLowerCase().indexOf(q) >= 0);
  $('a-list').innerHTML = list.map(row).join('') || '<li class="empty">Aucun bien ne correspond à cette recherche.</li>';
  const shown = D.biens.filter((h) => etat.biens[h.n].visible).length;
  $('a-sum').textContent = shown + ' bien' + (shown > 1 ? 's affichés' : ' affiché') + ' sur ' + D.biens.length + '. Les biens masqués disparaissent du site, mais restent ici.';
  bar();
}
function bar() {
  const n = dirtyCount();
  $('savebar').hidden = n === 0;
  document.body.classList.toggle('has-cbar', n > 0);
  $('save-msg').textContent = n + ' modification' + (n > 1 ? 's' : '') + ' à publier';
  $('save').disabled = busy; $('save').textContent = busy ? 'Publication…' : 'Publier';
}
function enter(e) {
  etat = e; saved = clone(e);
  $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false;
  $('c-email').value = etat.contact.email; $('c-tel').value = etat.contact.tel;
  draw();
}
function showLogin(msg) {
  $('app').hidden = true; $('logout').hidden = true; $('savebar').hidden = true; $('login').hidden = false;
  const er = $('login-err'); er.hidden = !msg; er.textContent = msg || '';
}

/* ---------- évènements ---------- */
$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  token = $('token').value.trim(); if (!token) return;
  const go = $('login-go'); go.disabled = true; go.textContent = 'Connexion…';
  load().then((e) => { writeToken(token, $('remember').checked); $('token').value = ''; enter(e); })
    .catch((err) => { token = ''; showLogin(err.user ? err.message : 'Connexion impossible. Vérifiez votre accès à Internet, puis réessayez.'); })
    .then(() => { go.disabled = false; go.textContent = 'Se connecter'; });
});
$('logout').addEventListener('click', () => {
  if (etat && dirtyCount() && !window.confirm('Des modifications ne sont pas publiées. Se déconnecter quand même ?')) return;
  token = ''; writeToken('', false); etat = saved = null; showLogin('');
});
$('a-q').addEventListener('input', draw);
$('a-list').addEventListener('change', (ev) => {
  const t = ev.target, li = t.closest('.a-row'); if (!li || !t.hasAttribute('data-f')) return;
  const n = li.getAttribute('data-n'), e = etat.biens[n], f = t.getAttribute('data-f');
  if (f === 'visible') e.visible = t.checked;
  if (f === 'statut') { e.statut = t.value; e.maj = today(); }
  if (f === 'note') { e.note = t.value.trim(); e.maj = today(); }
  if (f === 'annonce') { if (t.value) e.annonce = t.value; else delete e.annonce; }   /* ne change pas la date de suivi */
  if (JSON.stringify({ v: e.visible, s: e.statut, n: e.note }) === JSON.stringify({ v: saved.biens[n].visible, s: saved.biens[n].statut, n: saved.biens[n].note })) e.maj = saved.biens[n].maj;
  if (f === 'visible') { li.classList.toggle('hid', !e.visible); li.querySelector('.sw-l').textContent = e.visible ? 'Affiché' : 'Masqué'; }
  li.classList.toggle('chg', JSON.stringify(e) !== JSON.stringify(saved.biens[n]));
  const shown = D.biens.filter((h) => etat.biens[h.n].visible).length;
  $('a-sum').textContent = shown + ' bien' + (shown > 1 ? 's affichés' : ' affiché') + ' sur ' + D.biens.length + '. Les biens masqués disparaissent du site, mais restent ici.';
  bar();
});
['c-email', 'c-tel'].forEach((id) => $(id).addEventListener('input', () => { etat.contact.email = $('c-email').value.trim(); etat.contact.tel = $('c-tel').value.trim(); bar(); }));
$('cancel').addEventListener('click', () => { etat = clone(saved); $('c-email').value = etat.contact.email; $('c-tel').value = etat.contact.tel; draw(); });
$('save').addEventListener('click', () => {
  if (busy) return;
  if (etat.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(etat.contact.email)) { toast('L’adresse e-mail de contact n’est pas valide.'); $('c-email').focus(); return; }
  if (!D.biens.some((h) => etat.biens[h.n].visible) && !window.confirm('Tous les biens sont masqués : le site sera vide. Publier quand même ?')) return;
  busy = true; bar();
  const out = clone(etat); out.maj = today();
  const body = { message: 'Mise à jour du suivi depuis l’administration', content: b64enc(JSON.stringify(out, null, 1) + '\n'), branch: BRANCH };
  if (sha) body.sha = sha;
  gh('PUT', body).then((r) => {
    if (!r.ok) throw fail(r.status, true);
    return r.json();
  }).then((j) => {
    sha = j.content.sha; etat = out; saved = clone(out); busy = false; draw();
    toast('Publié. Le site se met à jour dans une à deux minutes.');
  }).catch((err) => { busy = false; bar(); toast(err.user ? err.message : 'Publication impossible. Vérifiez votre accès à Internet, puis réessayez.'); });
});
window.addEventListener('beforeunload', (ev) => { if (etat && dirtyCount()) { ev.preventDefault(); ev.returnValue = ''; } });

/* ---------- démarrage ---------- */
token = readToken();
if (token) load().then(enter).catch((err) => { token = ''; showLogin(err.user ? err.message : 'Connexion impossible. Vérifiez votre accès à Internet, puis réessayez.'); });
else showLogin('');
})();
