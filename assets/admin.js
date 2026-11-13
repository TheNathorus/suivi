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
/* Les statuts « Sous compromis », « Plus disponible », « Vendue » et « Retirée » sont aussi posés chaque matin par le robot
   (scripts/verifier_annonces.py), dans ce même fichier. Une correction faite ici n'est jamais écrasée par le robot. */
const STATUTS = { etude: 'À étudier', questions: 'Questions envoyées', visite: 'Visite à prévoir', vu: 'Visité', compromis: 'Sous compromis', plusdispo: 'Plus disponible', vendue: 'Vendue', retiree: 'Retirée', ecarte: 'Écarté' };
const KEY = 'suivi.admin.token', SKEY = 'suivi.admin.sugkey';
const TYPES = { proposition: 'Bien proposé', info: 'Information inexacte ou manquante', prix: 'Prix ou conditions modifiés', etat: 'État de l’annonce modifié', visite: 'Visite', reponse: 'Réponse à nos questions', comm: 'Commentaire à afficher' };
const TRAITEES_MAX = 400;

let token = '', sha = '', saved = null, etat = null, busy = false, sugs = [], pasted = [], sugMsg = '';

/* ---------- stockage du jeton ---------- */
function readKey() { try { return localStorage.getItem(SKEY) || ''; } catch (e) { return ''; } }
function writeKey(k) { try { if (k) localStorage.setItem(SKEY, k); else localStorage.removeItem(SKEY); } catch (e) { /* stockage indisponible */ } }
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
  const sg = (raw && raw.suggestions) || {};
  e.suggestions = { url: typeof sg.url === 'string' ? sg.url : '', traitees: {} };
  Object.keys(sg.traitees || {}).slice(-TRAITEES_MAX).forEach((id) => { if (/^[\w-]{1,40}$/.test(id)) e.suggestions.traitees[id] = sg.traitees[id] === 'oui' ? 'oui' : 'non'; });
  if (raw && raw.contact) { e.contact.email = raw.contact.email || ''; e.contact.tel = raw.contact.tel || ''; }
  D.biens.forEach((h) => {
    const x = (raw && raw.biens && raw.biens[h.n]) || {};
    e.biens[h.n] = { visible: x.visible !== false, statut: STATUTS[x.statut] ? x.statut : 'etude', maj: x.maj || D.updated, note: x.note || '' };
    if (x.prix > 0) e.biens[h.n].prix = Math.round(x.prix);   /* prix affiché : celui de l'annonce lu par le robot, ou saisi ici */
    if (x.vu_prix > 0) e.biens[h.n].vu_prix = Math.round(x.vu_prix);
    /* champs du robot, à conserver tels quels : auto (statut posé par le robot), avant (statut remplacé), vu (dernière lecture) */
    if (x.auto === true && STATUTS[x.avant]) { e.biens[h.n].auto = true; e.biens[h.n].avant = x.avant; }
    if (typeof x.vu === 'string' && x.vu) e.biens[h.n].vu = x.vu;
  });
  return e;
}
function load() {
  return gh('GET').then((r) => {
    if (r.status === 404) return r.json().then(() => { sha = ''; return normalize(null); });
    if (!r.ok) throw fail(r.status, false);
    return r.json().then((j) => { sha = j.sha; return normalize(JSON.parse(b64dec(j.content))); });
  });
}

/* ---------- rendu ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const dirtyCount = () => {
  let n = 0;
  D.biens.forEach((h) => { if (JSON.stringify(etat.biens[h.n]) !== JSON.stringify(saved.biens[h.n])) n++; });
  if (JSON.stringify(etat.contact) !== JSON.stringify(saved.contact)) n++;
  if (JSON.stringify(etat.suggestions) !== JSON.stringify(saved.suggestions)) n++;
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
    '<label class="fld a-statut"><span>Suivi</span><select data-f="statut">' + Object.keys(STATUTS).map((k) => '<option value="' + k + '"' + (k === e.statut ? ' selected' : '') + '>' + STATUTS[k] + '</option>').join('') + '</select>' +
      (e.auto ? '<span class="a-hint">Posé par la vérification automatique des annonces (avant : ' + esc(STATUTS[e.avant]) + ')</span>' : '') + '</label>' +
    '<label class="fld a-prix"><span>Prix (€)</span><input type="text" inputmode="numeric" data-f="prix" maxlength="9" value="' + (e.prix || '') + '" placeholder="' + nf(h.price) + '"></label>' +
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
  $('s-url').value = etat.suggestions.url; $('s-key').value = readKey();
  draw(); fetchSug();
}
function showLogin(msg) {
  $('app').hidden = true; $('logout').hidden = true; $('savebar').hidden = true; $('login').hidden = false;
  const er = $('login-err'); er.hidden = !msg; er.textContent = msg || '';
}

/* Changer le statut à la main : un choix fait ici l'emporte sur le robot (auto et avant effacés, la dernière lecture `vu` est conservée). */
function setStatut(n, v) {
  const e = etat.biens[n], sv = saved.biens[n];
  e.statut = v; e.maj = today();
  if (v === sv.statut) {   /* retour au statut publié : on retrouve aussi l'indication du robot */
    const frais = clone(sv);
    frais.visible = e.visible; frais.note = e.note;
    if (e.prix) frais.prix = e.prix; else delete frais.prix;
    etat.biens[n] = frais;
  } else { delete e.auto; delete e.avant; }
}

/* ---------- suggestions des agents ---------- */
const NOMS = {}; D.biens.forEach((h) => { NOMS[h.n] = h.label; });
function cleanSug(d) {
  if (!d || typeof d !== 'object' || !/^[\w-]{1,40}$/.test(String(d.id || ''))) return null;
  const prop = (Array.isArray(d.types) ? d.types : String(d.types || '').split(',')).indexOf('proposition') >= 0;
  if (!prop && !NOMS[d.bien]) return null;
  const txt = (v, m) => String(v == null ? '' : v).slice(0, m);
  const prix = parseInt(d.prix, 10);
  return {
    id: String(d.id), bien: prop ? 0 : +d.bien, date: /^\d{4}-\d{2}-\d{2}/.test(String(d.date || '')) ? String(d.date) : '',
    nom: txt(d.nom, 60), types: (Array.isArray(d.types) ? d.types : String(d.types || '').split(',')).filter((k) => TYPES[k]),
    statut: STATUTS[d.statut] ? d.statut : '', prix: prix >= 50000 && prix <= 3000000 ? prix : 0, texte: txt(d.texte, 600)
  };
}
function fetchSug() {
  const url = etat.suggestions.url, key = readKey();
  sugs = [];
  if (!url) { sugMsg = 'Le formulaire n’est pas encore activé (réglage tout en bas). Les suggestions reçues par e-mail peuvent être collées ci-dessous.'; drawSug(); return Promise.resolve(); }
  if (!key) { sugMsg = 'Saisissez le mot de passe de lecture (réglage tout en bas) pour voir les suggestions reçues.'; drawSug(); return Promise.resolve(); }
  sugMsg = 'Chargement des suggestions…'; drawSug();
  return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'cle=' + encodeURIComponent(key) + '&t=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => {
      if (!j || j.ok === false) throw new Error('refus');
      sugs = (j.suggestions || []).map(cleanSug).filter(Boolean); sugMsg = '';
    })
    .catch(() => { sugMsg = 'Impossible de lire les suggestions. Vérifiez l’adresse du formulaire et le mot de passe de lecture.'; })
    .then(drawSug);
}
function pending() {
  const seen = {}, out = [];
  pasted.concat(sugs).forEach((x) => { if (!seen[x.id] && !etat.suggestions.traitees[x.id]) { seen[x.id] = 1; out.push(x); } });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
function drawSug() {
  if (!etat) return;
  const all = pending(), props = all.filter((x) => !x.bien), list = all.filter((x) => x.bien);
  $('a-prop').hidden = !props.length;
  $('prop-t').textContent = 'Biens à ajouter (' + props.length + ')';
  $('pg-list').innerHTML = props.map(carteSug).join('');
  $('sug-t').textContent = 'Suggestions des agents' + (list.length ? ' (' + list.length + ')' : '');
  $('sug-state').textContent = sugMsg || (list.length ? '' : 'Aucune suggestion en attente.');
  $('sug-state').hidden = !($('sug-state').textContent);
  $('sg-list').innerHTML = list.map(carteSug).join('');
}
function carteSug(x) {
    const e = etat.biens[x.bien] || {};
    if (!x.bien) {   /* un bien proposé par un agent : le lien est à ouvrir, rien à appliquer automatiquement */
      const m = /^LIEN\s*:\s*(https?:\/\/\S+)\n?([\s\S]*)$/.exec(x.texte);
      const dp = x.date ? new Date(x.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
      return '<li class="sg" data-id="' + esc(x.id) + '"><h3>Bien proposé</h3>' +
        '<p class="sg-meta">' + (x.nom ? 'De ' + esc(x.nom) : 'Sans nom') + (dp ? ' · ' + dp : '') + '</p>' +
        (m ? '<p><a href="' + esc(m[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[1].length > 80 ? m[1].slice(0, 77) + '…' : m[1]) + ' <span aria-hidden="true">↗</span></a></p>' + (m[2].trim() ? '<p class="sg-txt">' + esc(m[2].trim()) + '</p>' : '') : '<p class="sg-txt">' + esc(x.texte) + '</p>') +
        '<div class="sg-act"><button type="button" class="btn primary small" data-sgdo="oui">Ajouté au comparateur</button><button type="button" class="btn ghost small" data-sgdo="non">Écarter</button></div></li>';
    }
    const d = x.date ? new Date(x.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
    return '<li class="sg" data-id="' + esc(x.id) + '"><h3>' + esc(NOMS[x.bien]) + ' <span class="sg-meta">· réf. ' + x.bien + '</span></h3>' +
      '<p class="sg-meta">' + (x.nom ? 'De ' + esc(x.nom) : 'Sans nom') + (d ? ' · ' + d : '') + '</p>' +
      (x.types.length ? '<ul class="sg-types">' + x.types.map((k) => '<li>' + TYPES[k] + '</li>').join('') + '</ul>' : '') +
      (x.texte ? '<p class="sg-txt">' + esc(x.texte) + '</p>' : '') +
      (x.statut ? '<label class="optline"><input type="checkbox" data-sg="statut" checked><span>Passer le suivi à « ' + STATUTS[x.statut] + ' » (actuellement « ' + STATUTS[e.statut] + ' »)</span></label>' : '') +
      (x.prix ? '<label class="optline"><input type="checkbox" data-sg="prix" checked><span>Mettre le prix à ' + nf(x.prix) + ' € (actuellement ' + nf(e.prix || (D.biens.filter((h) => h.n === x.bien)[0] || {}).price || 0) + ' €)</span></label>' : '') +
      (x.texte ? '<label class="optline"><input type="checkbox" data-sg="note"><span>Mettre dans la note visible sur la fiche (modifiable) :</span></label><input type="text" class="sg-note" data-sg="notetxt" maxlength="140" value="' + esc(x.texte.slice(0, 140)) + '" aria-label="Texte de la note">' : '') +
      '<div class="sg-act"><button type="button" class="btn primary small" data-sgdo="oui">Traiter</button><button type="button" class="btn ghost small" data-sgdo="non">Écarter</button></div></li>';
}
function traiter(id, decision, li) {
  const x = pending().filter((y) => y.id === id)[0]; if (!x) return;
  const on = (k) => { const c = li.querySelector('[data-sg="' + k + '"]'); return c && c.checked; };
  if (decision === 'oui' && x.bien) {
    if (x.statut && on('statut') && etat.biens[x.bien].statut !== x.statut) setStatut(x.bien, x.statut);
    const e = etat.biens[x.bien];
    if (x.prix && on('prix')) { e.prix = x.prix; e.maj = today(); }
    if (x.texte && on('note')) { e.note = li.querySelector('[data-sg="notetxt"]').value.trim().slice(0, 140); e.maj = today(); }
  }
  etat.suggestions.traitees[id] = decision;
  const ids = Object.keys(etat.suggestions.traitees);
  if (ids.length > TRAITEES_MAX) ids.slice(0, ids.length - TRAITEES_MAX).forEach((k) => { delete etat.suggestions.traitees[k]; });
  draw(); drawSug();
  toast(decision === 'oui' ? 'Appliqué. Cliquez sur Publier pour mettre le site à jour.' : 'Suggestion écartée. Cliquez sur Publier pour l’enregistrer.');
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
['sg-list', 'pg-list'].forEach((id) => $(id).addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sgdo]'), li = ev.target.closest('.sg'); if (!b || !li) return;
  traiter(li.getAttribute('data-id'), b.getAttribute('data-sgdo'), li);
}));
$('sug-refresh').addEventListener('click', fetchSug);
$('sug-add').addEventListener('click', () => {
  const m = /SUGGESTION-SUIVI\s+(\{[^\n]*\})/.exec($('sug-text').value);
  let d = null; try { d = m && cleanSug(JSON.parse(m[1])); } catch (e) { d = null; }
  if (!d) { toast('Aucune suggestion reconnue dans ce texte.'); return; }
  if (!pasted.some((x) => x.id === d.id)) pasted.push(d);
  $('sug-text').value = ''; drawSug(); toast('Suggestion ajoutée à la liste.');
});
$('s-url').addEventListener('input', () => { etat.suggestions.url = $('s-url').value.trim(); bar(); });
$('s-url').addEventListener('change', fetchSug);
$('s-key').addEventListener('change', () => { writeKey($('s-key').value.trim()); fetchSug(); });
$('a-list').addEventListener('change', (ev) => {
  const t = ev.target, li = t.closest('.a-row'); if (!li || !t.hasAttribute('data-f')) return;
  const n = li.getAttribute('data-n'), f = t.getAttribute('data-f');
  let e = etat.biens[n];
  if (f === 'visible') e.visible = t.checked;
  if (f === 'statut') {
    setStatut(n, t.value);
    const hint = li.querySelector('.a-hint'); if (hint) hint.hidden = !etat.biens[n].auto;
  }
  if (f === 'note') { e.note = t.value.trim(); e.maj = today(); }
  if (f === 'prix') {
    const v = parseInt(t.value.replace(/\D/g, ''), 10);
    if (!v) delete e.prix;                                   /* vide : retour au prix de la liste */
    else if (v < 50000 || v > 3000000) { toast('Le prix doit être compris entre 50 000 et 3 000 000 €.'); t.value = e.prix || ''; return; }
    else e.prix = v;
    e.maj = today();
  }
  e = etat.biens[n];
  if (JSON.stringify({ v: e.visible, s: e.statut, n: e.note, p: e.prix || 0 }) === JSON.stringify({ v: saved.biens[n].visible, s: saved.biens[n].statut, n: saved.biens[n].note, p: saved.biens[n].prix || 0 })) e.maj = saved.biens[n].maj;
  if (f === 'visible') { li.classList.toggle('hid', !e.visible); li.querySelector('.sw-l').textContent = e.visible ? 'Affiché' : 'Masqué'; }
  li.classList.toggle('chg', JSON.stringify(e) !== JSON.stringify(saved.biens[n]));
  const shown = D.biens.filter((h) => etat.biens[h.n].visible).length;
  $('a-sum').textContent = shown + ' bien' + (shown > 1 ? 's affichés' : ' affiché') + ' sur ' + D.biens.length + '. Les biens masqués disparaissent du site, mais restent ici.';
  bar();
});
['c-email', 'c-tel'].forEach((id) => $(id).addEventListener('input', () => { etat.contact.email = $('c-email').value.trim(); etat.contact.tel = $('c-tel').value.trim(); bar(); }));
$('cancel').addEventListener('click', () => { etat = clone(saved); $('c-email').value = etat.contact.email; $('c-tel').value = etat.contact.tel; $('s-url').value = etat.suggestions.url; draw(); drawSug(); });
$('save').addEventListener('click', () => {
  if (busy) return;
  if (etat.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(etat.contact.email)) { toast('L’adresse e-mail de contact n’est pas valide.'); $('c-email').focus(); return; }
  if (etat.suggestions.url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(etat.suggestions.url)) { toast('L’adresse du formulaire doit ressembler à https://script.google.com/macros/s/…/exec'); $('s-url').focus(); return; }
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
