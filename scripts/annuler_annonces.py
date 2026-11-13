#!/usr/bin/env python3
"""Annule les changements de suivi faits par le robot lors d'une mise à jour des annonces.

Usage : annuler_annonces.py [commit]
Sans commit, prend la dernière mise à jour automatique qui a touché data/etat.json.

Pour chaque bien que ce commit a changé, le suivi retrouve sa valeur d'avant, à une condition : l'administrateur
ne l'a pas modifié depuis (sinon le bien est laissé tel quel et signalé). Le robot garde en mémoire ce qu'il a
observé : il ne remettra donc pas le même statut le lendemain, tant que l'annonce ne change pas.
L'annulation est un nouveau commit, jamais une réécriture de l'historique.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETAT = ROOT / 'data' / 'etat.json'
AUTEUR = 'Suivi (mise à jour automatique)'
DEFAUT = {'visible': True, 'statut': 'etude', 'maj': '', 'note': ''}


def annuler(avant, apres, actuel):
    """Renvoie (nouvel état, biens remis comme avant, biens laissés car modifiés depuis)."""
    nouveau = json.loads(json.dumps(actuel))
    biens = nouveau.setdefault('biens', {})
    remis, laisses = [], []
    cles = set((avant.get('biens') or {})) | set((apres.get('biens') or {}))
    for cle in sorted(cles, key=lambda c: int(c) if c.isdigit() else 0):
        b_avant = (avant.get('biens') or {}).get(cle)
        b_apres = (apres.get('biens') or {}).get(cle)
        if b_avant == b_apres:
            continue   # ce commit n'a pas touché ce bien
        if (actuel.get('biens') or {}).get(cle) != b_apres:
            laisses.append(cle)
            continue
        entree = dict(b_avant or DEFAUT)
        for k in ('auto', 'avant', 'vu'):
            entree.pop(k, None)
        if b_apres and b_apres.get('vu'):
            entree['vu'] = b_apres['vu']   # le robot ne refera pas le même changement demain
        biens[cle] = entree
        remis.append(cle)
    return nouveau, remis, laisses


def git(*args):
    r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return r.returncode, r.stdout


def lire_a(commit, chemin):
    code, out = git('show', f'{commit}:{chemin}')
    if code != 0:
        return {}
    try:
        return json.loads(out)
    except ValueError:
        return {}


def main(argv):
    cible = argv[1].strip() if len(argv) > 1 else ''
    if not cible:
        _, out = git('log', '-1', '--format=%H', '-F', f'--author={AUTEUR}', '--', 'data/etat.json')
        cible = out.strip()
    if not cible:
        print('Aucune mise à jour automatique à annuler.')
        return 0
    code, out = git('rev-parse', '--verify', f'{cible}^{{commit}}')
    if code != 0:
        print('::error::Commit introuvable.')
        return 1
    cible = out.strip()
    avant, apres = lire_a(f'{cible}^', 'data/etat.json'), lire_a(cible, 'data/etat.json')
    actuel = json.loads(ETAT.read_text(encoding='utf-8'))
    nouveau, remis, laisses = annuler(avant, apres, actuel)
    for c in laisses:
        print(f'Réf. {c} : modifié depuis dans l’administration, laissé tel quel.')
    if not remis:
        print('Rien à annuler : aucun bien de ce commit n’est resté dans l’état posé par le robot.')
        return 0
    nouveau['maj'] = max(actuel.get('maj', ''), (apres.get('maj') or ''))
    ETAT.write_text(json.dumps(nouveau, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('Réf. remises comme avant : ' + ', '.join(remis))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
