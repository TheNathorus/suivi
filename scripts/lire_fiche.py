#!/usr/bin/env python3
"""Lit une fiche Bien'ici (API JSON publique) : champs utiles à l'analyse, texte, photos.

Sert à préparer l'ajout d'un bien depuis un environnement où Bien'ici est joignable (GitHub Actions).
Usage : lire_fiche.py <référence Bien'ici> [dossier de photos]
N'affiche ni adresse, ni nom, ni contact : seulement ce que le site public montre déjà.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verifier_annonces as v  # noqa: E402

CHAMPS = ['price', 'priceHasDecreased', 'surfaceArea', 'landSurfaceArea', 'roomsQuantity', 'bedroomsQuantity',
          'bathroomsQuantity', 'showerRoomsQuantity', 'toiletQuantity', 'floorQuantity', 'yearOfConstruction',
          'energyClassification', 'energyValue', 'greenhouseGazClassification', 'energyPerformanceDiagnosticDate',
          'hasPool', 'hasAirConditioning', 'hasGarden', 'hasTerrace', 'hasFirePlace', 'heating', 'garagesQuantity',
          'parkingPlacesQuantity', 'exposition', 'opticalFiberStatus', 'city', 'postalCode', 'publicationDate',
          'modificationDate', 'propertyType', 'newProperty', 'isExclusiveSaleMandate', 'feesChargedTo',
          'annualCondominiumFees', 'blurInfo']
TEL = re.compile(r'(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}')
MAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')


def main():
    ref = sys.argv[1]
    dossier = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    code, _, corps = v.http_get('https://www.bienici.com/realEstateAd.json?id=' + ref, 'application/json')
    print('code', code)
    j = json.loads(corps)
    for k in CHAMPS:
        if k in j and k != 'blurInfo':
            print(f'{k} = {j[k]!r}')
    st = j.get('status')
    print('status =', st)
    print('--- titre :', TEL.sub('[tel]', MAIL.sub('[mail]', str(j.get('title', '')))))
    print('--- description :')
    print(TEL.sub('[tel]', MAIL.sub('[mail]', str(j.get('description', '')))))
    photos = j.get('photos') or []
    print('--- photos :', len(photos), 'clés de la première :', sorted(photos[0].keys()) if photos else None)
    if dossier and photos:
        dossier.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(photos[:14]):
            u = p.get('url') or p.get('url_photo')
            if not u:
                continue
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': v.UA}), timeout=30) as r:
                    (dossier / f'{i:02d}.jpg').write_bytes(r.read(6_000_000))
            except Exception as e:  # noqa: BLE001
                print('photo', i, 'échec', type(e).__name__)
        print('photos enregistrées :', len(list(dossier.glob('*.jpg'))))


if __name__ == '__main__':
    main()
