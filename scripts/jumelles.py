#!/usr/bin/env python3
"""Cherche sur Bien'ici la « jumelle » d'une annonce publiée ailleurs (leboncoin par exemple).

Les annonces d'agence de leboncoin viennent des logiciels des agences, qui les publient aussi sur Bien'ici.
Le robot du matin lit déjà Bien'ici : suivre la jumelle donne donc le statut et le prix de l'annonce d'origine,
sans toucher à leboncoin. Rien n'est écrit par ce script en mode diagnostic ; il n'affiche que ce que le site
public montre déjà (commune, prix, surfaces, référence Bien'ici), jamais d'adresse ni de contact.
"""
import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verifier_annonces as v  # noqa: E402

PRIX_TOL = 0.03   # écart de prix toléré (3 %)
SURF_TOL = 4      # écart de surface habitable toléré (m²)


def biens_a_chercher(controle=()):
    brut = v.DATA_JS.read_text(encoding='utf-8')
    d = json.loads(brut[brut.index('=') + 1:].strip().rstrip(';'))
    return [b for b in d['biens'] if (not v.surveillee(b['url'])) or str(b['n']) in controle]


def json_get(url):
    code, _, corps = v.http_get(url, 'application/json')
    try:
        return code, json.loads(corps)
    except ValueError:
        return code, None


def zones(commune):
    """Identifiants de zone Bien'ici de la commune (suggestion de lieu)."""
    code, j = json_get('https://res.bienici.com/suggest.json?q=' + urllib.parse.quote(commune))
    print(f'  suggestion de lieu « {commune} » : code {code}')
    if not isinstance(j, list):
        print('  réponse inattendue :', type(j).__name__)
        return []
    out = []
    for s in j[:5]:
        if isinstance(s, dict):
            print('   -', {k: s[k] for k in s if k in ('name', 'type', 'zoneIds', 'postalCodes', 'insee_code', 'zone_ids')})
            ids = s.get('zoneIds') or s.get('zone_ids') or []
            if isinstance(ids, list) and ids and s.get('type') in (None, 'city', 'locality', 'commune'):
                out.append(ids[0])
    return out


def chercher(b, zone_ids):
    prix = b['price']
    filtres = {'size': 100, 'from': 0, 'showAllModels': False, 'filterType': 'buy', 'propertyType': ['house'],
               'page': 1, 'sortBy': 'relevance', 'sortOrder': 'desc', 'onTheMarket': [True],
               'minPrice': int(prix * (1 - PRIX_TOL)), 'maxPrice': int(prix * (1 + PRIX_TOL)),
               'zoneIdsByTypes': {'zoneIds': zone_ids}}
    url = 'https://www.bienici.com/realEstateAds.json?filters=' + urllib.parse.quote(json.dumps(filtres, separators=(',', ':')))
    code, j = json_get(url)
    print(f'  recherche : code {code}')
    if not isinstance(j, dict):
        return []
    print('  clés de la réponse :', sorted(j.keys())[:12], 'total =', j.get('total'))
    ads = j.get('realEstateAds') or []
    if ads:
        print('  clés d’une annonce :', sorted(ads[0].keys())[:60])
    return ads


def champ(a, *noms):
    for n in noms:
        if isinstance(a.get(n), (int, float)):
            return a[n]
    return None


def resume(a):
    return {'ref': a.get('id'), 'commune': a.get('city'), 'prix': a.get('price'),
            'surface': champ(a, 'surfaceArea'), 'terrain': champ(a, 'landSurfaceArea', 'landSurface', 'gardenSurfaceArea'),
            'pieces': a.get('roomsQuantity'), 'chambres': a.get('bedroomsQuantity')}


def proches(b, ads):
    res = []
    for a in ads:
        s = champ(a, 'surfaceArea')
        ok_prix = isinstance(a.get('price'), (int, float)) and abs(a['price'] - b['price']) <= b['price'] * PRIX_TOL
        ok_surf = s is not None and abs(s - b['m2']) <= SURF_TOL
        t = champ(a, 'landSurfaceArea', 'landSurface')
        ok_terrain = t is None or abs(t - b['land']) <= max(30, 0.03 * b['land'])
        if ok_prix and ok_surf:
            res.append((ok_terrain, a))
    return sorted(res, key=lambda x: not x[0])


def trouver(b):
    """Références Bien'ici des copies de l'annonce b (même commune, même prix à 3 % près, même terrain,
    surface à 4 m² près), la plus proche d'abord. Liste vide en cas de doute ou de panne."""
    zs = zones_silencieux(b['commune'])
    if not zs:
        return []
    filtres = {'size': 100, 'from': 0, 'showAllModels': False, 'filterType': 'buy', 'propertyType': ['house'],
               'page': 1, 'sortBy': 'relevance', 'sortOrder': 'desc', 'onTheMarket': [True],
               'minPrice': int(b['price'] * (1 - PRIX_TOL)), 'maxPrice': int(b['price'] * (1 + PRIX_TOL)),
               'zoneIdsByTypes': {'zoneIds': zs}}
    code, j = json_get('https://www.bienici.com/realEstateAds.json?filters=' +
                       urllib.parse.quote(json.dumps(filtres, separators=(',', ':'))))
    ads = j.get('realEstateAds') if isinstance(j, dict) else None
    if not isinstance(ads, list):
        return []
    sures = []
    for ok_terrain, a in proches(b, ads):
        t = champ(a, 'landSurfaceArea', 'landSurface')
        if ok_terrain and t is not None and isinstance(a.get('id'), str):
            sures.append((abs(champ(a, 'surfaceArea') - b['m2']), abs(a['price'] - b['price']), a['id']))
    return [i for _, _, i in sorted(sures)]


def zones_silencieux(commune):
    code, j = json_get('https://res.bienici.com/suggest.json?q=' + urllib.parse.quote(commune))
    out = []
    for s in (j if isinstance(j, list) else [])[:5]:
        if isinstance(s, dict):
            ids = s.get('zoneIds') or s.get('zone_ids') or []
            if isinstance(ids, list) and ids and s.get('type') in (None, 'city', 'locality', 'commune'):
                out.append(ids[0])
    return out[:1]


def decouvrir(existant, pause=v.PAUSE_ENTRE):
    """Met à jour la table {réf. : [références Bien'ici]} : ajoute les copies trouvées, n'en retire jamais
    (une copie disparue reste suivie : c'est ce qui permet de voir que l'annonce n'est plus en ligne)."""
    import time
    nouveau = {k: list(x) for k, x in existant.items()}
    for b in biens_a_chercher():
        time.sleep(pause)
        trouvees = trouver(b)
        if not trouvees:
            continue
        cle = str(b['n'])
        actuel = nouveau.get(cle, [])
        nouveau[cle] = actuel + [i for i in trouvees if i not in actuel]
    return nouveau


def main():
    controle = set(re.split(r'[,\s]+', sys.argv[1])) if len(sys.argv) > 1 else set()
    for b in biens_a_chercher(controle):
        print(f"Réf. {b['n']} {b['label']} : {b['price']} €, {b['m2']} m², terrain {b['land']} m²")
        z = zones(b['commune'])
        if not z:
            print('  aucune zone trouvée')
            continue
        ads = chercher(b, z)
        print(f'  {len(ads)} annonces dans la fourchette de prix')
        cand = proches(b, ads)
        if not cand:
            print('  aucune jumelle trouvée')
        for terrain_ok, a in cand:
            print('  jumelle possible' + ('' if terrain_ok else ' (terrain différent)') + ' :', resume(a))
    return 0


if __name__ == '__main__':
    sys.exit(main())
