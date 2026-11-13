"""Tests de verifier_annonces.py, sans réseau. Lancer : python3 scripts/test_verifier_annonces.py"""
import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verifier_annonces as v  # noqa: E402

J1, J2, J3 = date(2026, 11, 14), date(2026, 11, 15), date(2026, 12, 5)
OK = lambda prix=300000, drapeau=None: ('ok', {'prix': prix, 'drapeau': drapeau})  # noqa: E731
LISTE = [(i, f'Bien {i}', f'https://x/annonce/vente/a/maison/5pieces/id-{i}', 300000) for i in range(1, 11)]


def jour(obs, prec, verif, d, liste=LISTE):
    return v.traiter(liste, prec, verif, lambda url: obs[int(url.rsplit('-', 1)[1])], d, pause=0, pause_confirm=0)


class Etat(unittest.TestCase):
    def test_premiere_verification(self):
        res, ver, ch, al = jour({i: OK() for i in range(1, 11)}, {}, {}, J1)
        self.assertEqual(res['3']['statut'], 'disponible')
        self.assertEqual(ch, [])
        self.assertEqual(ver['3'], {'ok': '2026-11-14', 'echecs': 0})

    def test_prix_modifie_puis_retour_disponible(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[4] = OK(285000)
        res, ver, ch, _ = jour(obs, res, ver, J2)
        self.assertEqual(res['4']['statut'], 'prix')
        self.assertEqual(res['4']['ancien'], 300000)
        self.assertEqual(res['4']['prix'], 285000)
        self.assertEqual(ch, [(4, 'Bien 4', 'prix 300 000 € → 285 000 €')])
        res2, _, ch2, _ = jour(obs, res, ver, date(2026, 11, 20))   # inchangé : on garde le badge
        self.assertEqual(res2['4']['statut'], 'prix')
        self.assertEqual(ch2, [])
        res3, _, ch3, _ = jour(obs, res2, ver, J3)                  # plus de 14 jours
        self.assertEqual(res3['4']['statut'], 'disponible')
        self.assertNotIn('ancien', res3['4'])
        self.assertEqual(res3['4']['prix'], 285000)

    def test_compromis_vendue_retiree(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[2] = OK(drapeau='compromis'); obs[3] = OK(drapeau='vendue'); obs[5] = (v.GONE, {'statut': 'retiree'})
        res, ver, ch, al = jour(obs, res, ver, J2)
        self.assertEqual([res[k]['statut'] for k in '235'], ['compromis', 'vendue', 'retiree'])
        self.assertEqual(len(ch), 3)
        self.assertEqual(al, [])
        # retirée puis une vendue qui disparaît : vendue reste vendue
        obs[3] = (v.GONE, {'statut': 'retiree'})
        res, ver, _, _ = jour(obs, res, ver, J3)
        self.assertEqual(res['3']['statut'], 'vendue')
        # remise en ligne
        obs[5] = OK()
        res, ver, ch, _ = jour(obs, res, ver, J3)
        self.assertEqual(res['5']['statut'], 'disponible')
        self.assertTrue(any('disponible' in c[2] for c in ch))

    def test_plus_disponible_sans_raison(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[7] = (v.GONE, {'statut': 'indisponible'})
        res, ver, ch, _ = jour(obs, res, ver, J2)
        self.assertEqual(res['7']['statut'], 'indisponible')
        self.assertEqual(ch, [(7, 'Bien 7', 'plus disponible')])
        obs[7] = OK()
        res, _, _, _ = jour(obs, res, ver, J3)
        self.assertEqual(res['7']['statut'], 'disponible')

    def test_blocage_ne_conclut_rien(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[6] = (v.BLOCKED, {})
        for d in (date(2026, 11, 15), date(2026, 11, 16)):
            res, ver, ch, _ = jour(obs, res, ver, d)
            self.assertEqual(res['6']['statut'], 'disponible')
            self.assertEqual(ver['6']['ok'], '2026-11-14')
            self.assertEqual(ch, [])
        res, ver, ch, _ = jour(obs, res, ver, date(2026, 11, 17))   # 3e jour
        self.assertEqual(res['6']['statut'], 'verifier')
        self.assertEqual(len(ch), 1)
        obs[6] = OK()                                              # le site répond de nouveau
        res, ver, _, _ = jour(obs, res, ver, date(2026, 11, 18))
        self.assertEqual(res['6']['statut'], 'disponible')
        self.assertEqual(ver['6']['echecs'], 0)

    def test_jamais_lue_et_bloquee_reste_sans_statut(self):
        obs = {i: (v.BLOCKED, {}) for i in range(1, 11)}
        res, ver, ch, _ = jour(obs, {}, {}, J1)
        self.assertEqual(res, {})
        self.assertEqual(ver['1'], {'echecs': 1})

    def test_garde_fou_panne_du_site(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs = {i: (v.GONE, {'statut': 'retiree'}) for i in range(1, 11)}
        res2, ver2, ch, al = jour(obs, res, ver, J2)
        self.assertEqual(len(al), 1)
        self.assertEqual(ch, [])
        self.assertTrue(all(a['statut'] == 'disponible' for a in res2.values()))

    def test_un_seul_retrait_passe(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[1] = (v.GONE, {'statut': 'retiree'})
        res, _, _, al = jour(obs, res, ver, J2)
        self.assertEqual(res['1']['statut'], 'retiree')
        self.assertEqual(al, [])

    def test_confirmation_deux_lectures(self):
        lectures = iter([(v.GONE, {'statut': 'retiree'}), OK()])
        self.assertEqual(v.observer_confirme('u', lambda url: next(lectures), 0), (v.BLOCKED, {}))
        lectures = iter([(v.GONE, {'statut': 'retiree'}), (v.GONE, {'statut': 'retiree'})])
        self.assertEqual(v.observer_confirme('u', lambda url: next(lectures), 0), (v.GONE, {'statut': 'retiree'}))

    def test_message_commit(self):
        m = v.message_commit([(4, 'Poulx', 'vendue')], False, [], J2, 10)
        self.assertTrue(m.startswith('Annonces 15 nov. : réf. 4 vendue\n'))
        self.assertIn('aucun changement', v.message_commit([], False, [], J2, 10).splitlines()[0])


class Lecture(unittest.TestCase):
    def setUp(self):
        self.vrai = v.http_get

    def tearDown(self):
        v.http_get = self.vrai

    def fake(self, table):
        def f(url, accept):
            for cle, rep in table.items():
                if cle in url:
                    return rep
            return 0, {}, ''
        v.http_get = f

    def test_api_ok_prix_et_drapeau(self):
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'description': 'vendu avec meubles'}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), ('ok', {'prix': 345000, 'drapeau': None}))
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'isSold': True}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1')[1]['drapeau'], 'vendue')
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'status': 'under offer'}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1')[1]['drapeau'], 'compromis')

    def test_api_404_et_pages(self):
        self.fake({'realEstateAd.json': (404, {}, '')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.GONE, {'statut': 'retiree'}))
        self.fake({'realEstateAd.json': (403, {}, ''), 'annonce/vente': (302, {'location': '/recherche/achat/nimes'}, '')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.GONE, {'statut': 'retiree'}))
        self.fake({'realEstateAd.json': (403, {}, ''),
                   'annonce/vente': (200, {}, '<html><h1>Cette annonce n’est plus disponible</h1></html>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.GONE, {'statut': 'indisponible'}))

    def test_api_ok_mais_page_retiree(self):
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 390000})),
                   'annonce/vente': (200, {}, '<html><h1>Cette annonce n’est plus disponible</h1></html>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.GONE, {'statut': 'indisponible'}))
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 390000})),
                   'annonce/vente': (200, {}, '<html><h1>Maison à vendre</h1></html>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), ('ok', {'prix': 390000, 'drapeau': None}))

    def test_blocage(self):
        self.fake({'realEstateAd.json': (403, {}, ''),
                   'annonce/vente': (200, {}, '<title>Just a moment...</title>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.BLOCKED, {}))
        self.fake({})   # réseau coupé
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.BLOCKED, {}))

    def test_page_sans_conclusion(self):
        self.fake({'realEstateAd.json': (429, {}, ''), 'annonce/vente': (200, {}, '<html><body>appli</body></html>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), (v.BLOCKED, {}))


if __name__ == '__main__':
    unittest.main(verbosity=1)
