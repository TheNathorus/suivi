#!/usr/bin/env python3
"""Vérifie chaque jour si les annonces du comparateur sont toujours en ligne.

Lit la liste des annonces dans assets/data.js, interroge Bien'ici, puis écrit :
  - data/annonces.json     : ce que le site a montré de chaque annonce (mémoire du robot : prix, historique) ;
  - data/verification.json : date de la dernière vérification réussie de chaque annonce ;
  - data/etat.json         : la base de l'administration. C'est là que le robot change le statut d'un bien
                             (Sous compromis, Plus disponible, Vendue, Retirée), comme le ferait l'administrateur.
                             La page publique ne fait que lire ce fichier.
Le message du commit est écrit dans le fichier donné par la variable MESSAGE_FILE.

Règles de prudence : une annonce n'est déclarée vendue ou retirée qu'après deux lectures
concordantes à quelques secondes d'écart ; si le site bloque la lecture, on ne conclut rien
(l'ancien statut reste, puis « À vérifier » après 3 jours de blocage) ; si beaucoup d'annonces
disparaissent d'un coup, on suppose une panne du site et on ne change rien.

Aucune dépendance : bibliothèque standard de Python 3.9 ou plus.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / 'assets' / 'data.js'
ANNONCES = ROOT / 'data' / 'annonces.json'
VERIF = ROOT / 'data' / 'verification.json'
ETAT = ROOT / 'data' / 'etat.json'

UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/124.0 Safari/537.36')
LIBELLES = {'disponible': 'Disponible', 'prix': 'Prix modifié', 'compromis': 'Sous compromis',
            'vendue': 'Vendue', 'retiree': 'Retirée', 'indisponible': 'Plus disponible',
            'verifier': 'À vérifier'}
PRIX_DUREE = 14      # jours pendant lesquels « Prix modifié » reste affiché
ECHECS_MAX = 3       # jours de blocage avant « À vérifier »
HIST_MAX = 15        # évènements gardés par annonce
GARDE_FOU = 0.4      # part d'annonces disparues d'un coup au-delà de laquelle on suspecte une panne
PAUSE_ENTRE = 3.0    # secondes entre deux annonces
PAUSE_CONFIRM = 20.0  # secondes avant la seconde lecture de confirmation

GONE, BLOCKED = 'gone', 'blocked'

# Ce que le robot observe -> statut de suivi de l'administration. Les autres observations
# (disponible, prix modifié, à vérifier) ne changent aucun statut.
STATUT_ADMIN = {'compromis': 'compromis', 'indisponible': 'plusdispo', 'vendue': 'vendue', 'retiree': 'retiree'}
LIBELLE_ADMIN = {'etude': 'À étudier', 'questions': 'Questions envoyées', 'visite': 'Visite à prévoir',
                 'vu': 'Visité', 'compromis': 'Sous compromis', 'plusdispo': 'Plus disponible',
                 'vendue': 'Vendue', 'retiree': 'Retirée', 'ecarte': 'Écarté'}


# ---------------------------------------------------------------- réseau
class _PasDeRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_PasDeRedirection)


def http_get(url, accept):
    """Renvoie (code, en-têtes en minuscules, texte). Code 0 : erreur réseau."""
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'fr-FR,fr;q=0.9'})
    try:
        with _OPENER.open(req, timeout=25) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, \
                r.read(3_000_000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        try:
            corps = e.read(300_000).decode('utf-8', 'replace')
        except Exception:
            corps = ''
        return e.code, {k.lower(): v for k, v in e.headers.items()}, corps
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0, {}, ''


# ---------------------------------------------------------------- lecture d'une annonce
def ad_id(url):
    return url.rstrip('/').rsplit('/', 1)[-1]


_VENDU = re.compile(r'(?i)^(is_?)?(sold|vendu|vendue)$')
_COMPROMIS = re.compile(r'(?i)^(is_?)?(under_?(offer|contract|compromise)|compromis|reserved|reserve)$')
_CLE_STATUT = re.compile(r'(?i)^(status|ad_?status|transaction_?status|availability|state)$')
_TXT_VENDU = re.compile(r'(?i)\b(sold|vendu|vendue)\b')
_TXT_COMPROMIS = re.compile(r'(?i)(under.?offer|under.?contract|compromis|r[eé]serv|sous.?offre)')
_TXT_RETIRE = re.compile(r'(?i)(unavailable|indisponible|withdrawn|expired|expir|archiv|deleted|retir)')


def _drapeau_json(obj, profondeur=0):
    """Cherche dans le JSON, sur des clés de statut seulement, 'vendue' ou 'compromis' ou 'retiree'."""
    trouve = None
    if profondeur > 3:
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                r = _drapeau_json(v, profondeur + 1)
            elif _VENDU.match(k) and v is True:
                r = 'vendue'
            elif _COMPROMIS.match(k) and v is True:
                r = 'compromis'
            elif _CLE_STATUT.match(k) and isinstance(v, str):
                r = ('vendue' if _TXT_VENDU.search(v) else 'retiree' if _TXT_RETIRE.search(v)
                     else 'compromis' if _TXT_COMPROMIS.search(v) else None)
            else:
                r = None
            if r == 'vendue':
                return 'vendue'
            trouve = trouve or r
    elif isinstance(obj, list):
        for v in obj[:50]:
            r = _drapeau_json(v, profondeur + 1)
            if r == 'vendue':
                return 'vendue'
            trouve = trouve or r
    return trouve


def _prix(valeur):
    if isinstance(valeur, list) and valeur:
        valeur = valeur[0]
    if isinstance(valeur, (int, float)) and 50_000 <= valeur <= 3_000_000:
        return int(round(valeur))
    return None


_TXT_COMPROMIS_ANNONCEUR = re.compile(
    r"(?i)(sous[\s-]+compromis|sous[\s-]+offre|sous[\s-]+promesse|compromis\s+sign[eé]|offre\s+accept[eé]e)")
_NON_VENTE = r"(?!\s+(avec|meubl|équip|en\s+l|sans|au\s+prix|par\s+))"
_TXT_VENDU_ANNONCEUR = re.compile(
    r"(\bVEND(U|UE)\b|^\W*(vendu|vendue)\b" + _NON_VENTE +
    r"|(?i:\b(bien|maison|annonce)\s+(est\s+|désormais\s+|déjà\s+)?(vendu|vendue)\b" + _NON_VENTE + "))")


def drapeau_texte(titre, description):
    """Mentions écrites par l'annonceur dans le titre ou au début de la description.
    Mots précis seulement : « vendu avec ses meubles » ne compte pas."""
    texte = ((titre or '') + ' \n ' + (description or '')[:400])
    if _TXT_VENDU_ANNONCEUR.search(texte):
        return 'vendue'
    if _TXT_COMPROMIS_ANNONCEUR.search(texte):
        return 'compromis'
    return None


def lire_api(url):
    """Observation via l'API JSON publique du site. None si elle ne permet pas de conclure."""
    code, _, corps = http_get('https://www.bienici.com/realEstateAd.json?id=' +
                              urllib.parse.quote(ad_id(url)), 'application/json')
    if code in (404, 410):
        return GONE, {'statut': 'retiree'}
    if code != 200:
        return None
    try:
        j = json.loads(corps)
    except ValueError:
        return None
    if not isinstance(j, dict) or 'price' not in j:
        return None
    etat = j.get('status')
    if isinstance(etat, dict) and etat.get('onTheMarket') is False:
        # Le site a dépublié l'annonce (message « Cette annonce n'est plus disponible », sans raison).
        info = {'statut': 'indisponible'}
        fin = j.get('closingDate')
        if isinstance(fin, str) and re.match(r'^\d{4}-\d{2}-\d{2}', fin):
            info['depuis'] = fin[:10]
        return GONE, info
    drapeau = _drapeau_json({k: v for k, v in j.items() if k not in ('description', 'title')})
    if drapeau == 'retiree':
        return GONE, {'statut': 'indisponible'}
    if drapeau is None:
        titre = j.get('title') if isinstance(j.get('title'), str) else ''
        desc = j.get('description') if isinstance(j.get('description'), str) else ''
        drapeau = drapeau_texte(titre, desc)
    return 'ok', {'prix': _prix(j.get('price')), 'drapeau': drapeau}


_BLOQUE = re.compile(r'(?i)(just a moment|cf-chl|captcha|access denied|datadome|enable javascript and cookies)')
_PLUS_DISPO = re.compile(r"(?i)(n['’]est plus disponible|annonce (a été |est )?(retirée|supprimée|expirée)|"
                         r"cette annonce n['’]existe plus|page introuvable)")
_BALISES_TITRE = re.compile(r'(?is)<(title|h1)[^>]*>(.*?)</\1>|<meta[^>]+property=["\']og:title["\'][^>]*>')


def lire_page(url):
    """Observation via la page de l'annonce. None si elle ne permet pas de conclure."""
    identifiant = ad_id(url)
    cible = url
    for _ in range(2):
        code, ent, corps = http_get(cible, 'text/html')
        if code in (301, 302, 303, 307, 308):
            loc = urllib.parse.urljoin(cible, ent.get('location', ''))
            if identifiant in loc:
                cible = loc
                continue
            return GONE, {'statut': 'retiree'}   # renvoyée vers une liste ou la page d'accueil
        break
    if code in (404, 410):
        return GONE, {'statut': 'retiree'}
    if code != 200 or _BLOQUE.search(corps[:6000]):
        return None
    if _PLUS_DISPO.search(corps):
        return GONE, {'statut': 'indisponible'}   # le site ne dit pas pourquoi
    titres = ' '.join(m.group(0) for m in _BALISES_TITRE.finditer(corps))
    meta = re.search(r'(?is)<meta[^>]+(?:name|property)=["\'](?:og:)?description["\'][^>]*content=["\']([^"\']*)', corps)
    drapeau = ('vendue' if _TXT_VENDU.search(titres) else 'compromis' if _TXT_COMPROMIS.search(titres) else None) \
        or drapeau_texte(re.sub(r'<[^>]+>', ' ', titres), meta.group(1) if meta else '')
    m = re.search(r'"price"\s*:\s*(\d{5,7})', corps)
    prix = _prix(int(m.group(1))) if m else None
    if prix is None and drapeau is None:
        return None
    return 'ok', {'prix': prix, 'drapeau': drapeau}


def raison_page(url):
    """None si la page est normale, sinon 'retiree' (page supprimée ou redirigée) ou
    'indisponible' (page en ligne qui affiche « Cette annonce n'est plus disponible », sans raison)."""
    code, ent, corps = http_get(url, 'text/html')
    if code in (404, 410):
        return 'retiree'
    if code in (301, 302, 303, 307, 308):
        return None if ad_id(url) in ent.get('location', '') else 'retiree'
    if code == 200 and _PLUS_DISPO.search(corps):
        return 'indisponible'
    return None


def observer(url):
    """('ok', {prix, drapeau}) | ('gone', {}) | ('blocked', {})"""
    r = lire_api(url)
    if r is not None and r[0] == 'ok':
        # L'API peut encore renvoyer une fiche pour une annonce retirée : la page a le dernier mot.
        raison = raison_page(url)
        if raison == 'indisponible' and r[1].get('drapeau') == 'vendue':
            return r          # l'annonceur écrit « vendu » : plus précis que « plus disponible »
        return (GONE, {'statut': raison}) if raison else r
    if r is not None:
        return r
    return lire_page(url) or (BLOCKED, {})


def observer_confirme(url, observe=observer, pause=PAUSE_CONFIRM):
    """Retire ou vend une annonce seulement si deux lectures concordent."""
    r = observe(url)
    grave = r[0] == GONE or (r[0] == 'ok' and r[1].get('drapeau') == 'vendue')
    if not grave:
        return r
    time.sleep(pause)
    r2 = observe(url)
    if r2[0] == r[0] and r2[1].get('drapeau') == r[1].get('drapeau') and r2[1].get('statut') == r[1].get('statut'):
        return r
    return BLOCKED, {}


# ---------------------------------------------------------------- état
def fr_date(d):
    mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
    return f'{d.day} {mois[d.month - 1]}'


def eur(n):
    return f'{n:,}'.replace(',', ' ') + ' €'


def evoluer(prec, obs, base_prix, aujourdhui, verif_prec):
    """Nouvel enregistrement d'une annonce, son état de vérification, et un libellé de changement (ou None)."""
    iso = aujourdhui.isoformat()
    verif = dict(verif_prec or {})
    nature, info = obs
    if nature == BLOCKED:
        verif['echecs'] = verif.get('echecs', 0) + 1
        if prec is None:
            return None, verif, None
        if verif['echecs'] >= ECHECS_MAX and prec['statut'] != 'verifier':
            nouveau = dict(prec, statut='verifier', depuis=iso)
            nouveau['hist'] = (prec.get('hist', []) + [{'d': iso, 's': 'verifier'}])[-HIST_MAX:]
            return nouveau, verif, 'à vérifier (lecture bloquée depuis ' + str(verif['echecs']) + ' jours)'
        return prec, verif, None

    verif['ok'] = iso
    verif['echecs'] = 0
    prix_connu = (prec or {}).get('prix') or base_prix
    nouveau = dict(prec or {})
    nouveau['hist'] = list(nouveau.get('hist', []))
    drapeau = None
    if nature == GONE:
        prix = prix_connu
    else:
        prix = info.get('prix') or prix_connu
        drapeau = info.get('drapeau')
        if prix != prix_connu:
            nouveau['ancien'] = prix_connu
            nouveau['prix_date'] = iso
    recent = bool(nouveau.get('prix_date')) and bool(nouveau.get('ancien')) and \
        (aujourdhui - date.fromisoformat(nouveau['prix_date'])).days < PRIX_DUREE
    if not recent:   # l'ancien prix n'est montré que pendant la période « Prix modifié »
        nouveau.pop('ancien', None)
        nouveau.pop('prix_date', None)
    if nature == GONE:
        statut = 'vendue' if prec and prec['statut'] == 'vendue' else info.get('statut', 'retiree')
    else:
        statut = drapeau or ('prix' if recent else 'disponible')

    changement = []
    depuis = info.get('depuis') or iso   # jour de dépublication annoncé par le site, sinon aujourd'hui
    if prec is None:
        nouveau['depuis'] = depuis
        nouveau['hist'].append({'d': depuis, 's': statut, 'p': prix})
        if statut != 'disponible':
            changement.append(LIBELLES[statut].lower())
    else:
        prix_change = prix != prix_connu
        if prix_change:
            changement.append(f'prix {eur(prix_connu)} → {eur(prix)}')
        if statut != prec['statut']:
            nouveau['depuis'] = depuis
            if not (statut == 'prix' and prix_change):
                changement.append(LIBELLES[statut].lower())
        if prix_change or statut != prec['statut']:
            ev = {'d': depuis if statut != prec['statut'] else iso, 's': statut, 'p': prix}
            if prix_change:
                ev['a'] = prix_connu
            nouveau['hist'].append(ev)
    nouveau['prix'] = prix
    nouveau['statut'] = statut
    nouveau['hist'] = nouveau['hist'][-HIST_MAX:]
    return nouveau, verif, ', '.join(changement) or None


def traiter(annonces, prec_annonces, prec_verif, observe, aujourdhui, pause=PAUSE_ENTRE, pause_confirm=PAUSE_CONFIRM):
    """annonces : liste de (n, label, url, prix). Renvoie (annonces, verification, changements, alertes)."""
    obs = {}
    for i, (n, label, url, prix) in enumerate(annonces):
        if i:
            time.sleep(pause)
        obs[n] = observer_confirme(url, observe, pause_confirm)

    alertes = []
    tombees = [n for n, o in obs.items()
               if (o[0] == GONE or (o[0] == 'ok' and o[1].get('drapeau') == 'vendue'))
               and (prec_annonces.get(str(n)) or {}).get('statut') not in ('retiree', 'vendue', 'indisponible')]
    if len(tombees) >= 5 and len(tombees) >= GARDE_FOU * len(annonces):
        alertes.append(f'{len(tombees)} annonces sur {len(annonces)} semblent disparaître en même temps : '
                       'panne ou blocage probable du site, aucun statut changé.')
        obs = {n: (BLOCKED, {}) for n in obs}

    res, verif, changements = {}, {}, []
    for n, label, url, prix in annonces:
        key = str(n)
        prec = prec_annonces.get(key)
        nouveau, v, texte = evoluer(prec, obs[n], prix, aujourdhui, prec_verif.get(key))
        if nouveau is not None:
            res[key] = nouveau
        verif[key] = v
        if texte:
            changements.append((n, label, texte))
    return res, verif, changements, alertes


def synchroniser(etat, annonces, aujourdhui, prix_base=None):
    """Reporte dans la base de l'administration (etat) ce que le robot vient d'observer.

    Pour chaque bien, `vu` garde la dernière observation qui a produit un statut, `auto` marque un statut posé
    par le robot et `avant` le statut qu'il a remplacé. Le robot n'agit que lorsque l'observation CHANGE :
    un statut mis à la main par l'administrateur n'est donc jamais écrasé le lendemain.
    Même règle pour le prix : `vu_prix` garde le dernier prix lu, `prix` est celui affiché sur le site
    (modifiable dans l'admin). `prix_base` : prix de la liste (assets/data.js), point de départ.
    Renvoie (nouvel etat, [(réf., texte)]). `etat` n'est pas modifié."""
    iso = aujourdhui.isoformat()
    etat = json.loads(json.dumps(etat))
    biens = etat.setdefault('biens', {})
    changements = []
    for cle, ann in annonces.items():
        obs = ann.get('statut')
        if obs == 'verifier':
            continue   # lecture bloquée : aucune conclusion, aucun changement de statut
        cible = STATUT_ADMIN.get(obs)
        bien = biens.setdefault(cle, {'visible': True, 'statut': 'etude', 'maj': iso, 'note': ''})
        lu = ann.get('prix')
        connu = bien.get('vu_prix') or (prix_base or {}).get(cle)
        if isinstance(lu, int) and lu > 0 and connu and lu != connu:
            bien['prix'] = lu
            bien['vu_prix'] = lu
            bien['maj'] = iso
            changements.append((cle, f'prix {eur(connu)} → {eur(lu)}'))
        vu = bien.get('vu')
        avant_cible = STATUT_ADMIN.get(vu)
        if cible == avant_cible:
            continue
        courant = bien.get('statut', 'etude')
        if cible:
            if courant != cible:
                if not bien.get('auto'):
                    bien['avant'] = courant
                bien['statut'] = cible
                bien['auto'] = True
                bien['maj'] = iso
                changements.append((cle, f'suivi « {LIBELLE_ADMIN.get(courant, courant)} » → « {LIBELLE_ADMIN[cible]} »'))
            bien['vu'] = obs
        else:   # l'annonce est de nouveau en ligne
            if bien.get('auto') and courant == avant_cible:
                retour = bien.get('avant') if bien.get('avant') in LIBELLE_ADMIN else 'etude'
                bien['statut'] = retour
                bien['maj'] = iso
                changements.append((cle, f'de nouveau en ligne, suivi « {LIBELLE_ADMIN[courant]} » → « {LIBELLE_ADMIN[retour]} »'))
            for k in ('auto', 'avant', 'vu'):
                bien.pop(k, None)
    if changements:
        etat['maj'] = iso
    return etat, changements


_SENSIBLE = re.compile(r'(?i)(address|street|adresse|lat|lon|position|blur|postal|city|district|zip|insee|geo|photo|image|url|link|phone|mail|contact|agency|agent|user|name|description|title|slug)')


def diagnostiquer(refs, annonces):
    """Affiche dans le journal ce que le site renvoie pour certaines annonces (aucune adresse ni contact)."""
    for n, label, url, prix in annonces:
        if str(n) not in refs:
            continue
        print(f'::group::Diagnostic réf. {n} ({label})')
        code, ent, corps = http_get('https://www.bienici.com/realEstateAd.json?id=' +
                                    urllib.parse.quote(ad_id(url)), 'application/json')
        print(f'API : code {code}, {len(corps)} caractères, type {ent.get("content-type", "?")}')
        try:
            j = json.loads(corps)
        except ValueError:
            j = None
        if isinstance(j, dict):
            print('Clés de premier niveau : ' + ', '.join(sorted(j)))
            for k in sorted(j):
                v = j[k]
                if _SENSIBLE.search(k) or isinstance(v, (dict, list)):
                    continue
                if isinstance(v, str) and len(v) > 60:
                    continue
                print(f'  {k} = {v!r}')
            for k in sorted(j):
                if isinstance(j[k], dict) and not _SENSIBLE.search(k):
                    print(f'  {k} = ' + ', '.join(f'{kk}={vv!r}' for kk, vv in j[k].items()
                                               if not isinstance(vv, (dict, list)) and not _SENSIBLE.search(kk)
                                               and not (isinstance(vv, str) and len(vv) > 60)))
        else:
            print('Début de la réponse : ' + corps[:200].replace('\n', ' '))
        code, ent, corps = http_get(url, 'text/html')
        print(f'Page : code {code}, {len(corps)} caractères, redirection : {ent.get("location", "aucune")}')
        for m in re.finditer(r'(?is)<(title|h1)[^>]*>(.*?)</\1>', corps):
            print(f'  <{m.group(1)}> {re.sub(r"<[^>]+>", "", m.group(2))[:120]!r}')
        vus = 0
        for m in re.finditer(r"(?i)(vendu|plus disponible|compromis|retir|sold|indisponible|unavailable)", corps):
            print('  … ' + re.sub(r'\s+', ' ', corps[max(0, m.start() - 40):m.end() + 40]) + ' …')
            vus += 1
            if vus >= 6:
                break
        print('::endgroup::')


def lire_annonces():
    brut = DATA_JS.read_text(encoding='utf-8')
    d = json.loads(brut[brut.index('=') + 1:].strip().rstrip(';'))
    return [(b['n'], b['label'], b['url'], b['price']) for b in d['biens']]


def lire_json(chemin, defaut):
    try:
        return json.loads(chemin.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return defaut


def ecrire(chemin, obj):
    chemin.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def message_commit(changements, premiere, alertes, aujourdhui, total, suivi=()):
    jour = fr_date(aujourdhui)
    if premiere:
        titre = f'Annonces {jour} : première vérification ({total} annonces)'
    elif changements:
        courts = [f'réf. {n} {t}' for n, _, t in changements]
        titre = f'Annonces {jour} : ' + ', '.join(courts)
        if len(titre) > 100:
            titre = f'Annonces {jour} : {len(changements)} changement' + ('s' if len(changements) > 1 else '')
    elif suivi:
        refs = ', '.join('réf. ' + n for n, _ in suivi)
        titre = f'Annonces {jour} : suivi mis à jour ({refs})'
    else:
        titre = f'Vérification des annonces du {jour} : aucun changement'
    corps = [f'- {label} (réf. {n}) : {t}' for n, label, t in changements]
    corps += [f'Suivi réf. {n} : {t}' for n, t in suivi]
    corps += [f'ATTENTION : {a}' for a in alertes]
    corps.append('')
    corps.append('Pour corriger un bien : page /admin/, champ « Suivi » (le robot ne le changera plus tant que '
                 "l'annonce ne change pas). Pour tout annuler : GitHub, onglet Actions, « Annuler une mise à jour des annonces ».")
    return titre + '\n\n' + '\n'.join(corps) + '\n'


def main():
    aujourdhui = datetime.now(ZoneInfo('Europe/Paris')).date()
    annonces = lire_annonces()
    prec = lire_json(ANNONCES, {})
    prec_annonces = prec.get('biens', {}) if isinstance(prec, dict) else {}
    prec_verif = (lire_json(VERIF, {}) or {}).get('biens', {})
    refs = {x for x in re.split(r'[,\s]+', os.environ.get('DIAGNOSTIC', '')) if x.isdigit()}
    if refs:
        diagnostiquer(refs, annonces)
    res, verif, changements, alertes = traiter(annonces, prec_annonces, prec_verif, observer, aujourdhui)

    for a in alertes:
        print('::warning::' + a)
    for n, label, texte in changements:
        print(f'{label} (réf. {n}) : {texte}')
    bloques = [n for n, v in verif.items() if v.get('echecs')]
    if bloques:
        print('Lecture bloquée (aucune conclusion) pour les réf. ' + ', '.join(bloques))
        if len(bloques) == len(annonces):
            print('::warning::Toutes les annonces sont illisibles depuis ce serveur : le site bloque peut-être GitHub.')

    if res != prec_annonces:
        ecrire(ANNONCES, {'biens': dict(sorted(res.items(), key=lambda kv: int(kv[0])))})
    etat = lire_json(ETAT, {})
    etat, suivi = synchroniser(etat if isinstance(etat, dict) else {}, res, aujourdhui,
                               {str(n): prix for n, _, _, prix in annonces})
    for n, texte in suivi:
        print(f'Suivi réf. {n} : {texte}')
    if suivi:
        ecrire(ETAT, etat)
    ecrire(VERIF, {'date': aujourdhui.isoformat(),
                   'biens': dict(sorted(verif.items(), key=lambda kv: int(kv[0])))})

    chemin = os.environ.get('MESSAGE_FILE')
    if chemin:
        Path(chemin).write_text(message_commit(changements, not prec_annonces and bool(res), alertes,
                                               aujourdhui, len(annonces), suivi), encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
