"""Tests de verifier_annonces.py, sans réseau. Lancer : python3 scripts/test_verifier_annonces.py"""
import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verifier_annonces as v  # noqa: E402
import annuler_annonces as an  # noqa: E402

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


def etat0(**biens):
    base = {'visible': True, 'statut': 'etude', 'maj': '2026-11-10', 'note': ''}
    return {'maj': '2026-11-10', 'contact': {'email': 'a@b.c', 'tel': ''},
            'biens': {k: dict(base, **b) for k, b in biens.items()}}


def ann(statut):
    return {'statut': statut}


class Suivi(unittest.TestCase):
    """Le robot écrit dans la base de l'administration ; l'administrateur garde le dernier mot."""

    def test_plus_disponible_puis_retour(self):
        e, ch = v.synchroniser(etat0(**{'18': {'statut': 'visite'}}), {'18': ann('indisponible')}, J1)
        b = e['biens']['18']
        self.assertEqual((b['statut'], b['avant'], b['auto'], b['vu'], b['maj']), ('plusdispo', 'visite', True, 'indisponible', '2026-11-14'))
        self.assertEqual(e['maj'], '2026-11-14')
        self.assertEqual([c[0] for c in ch], ['18'])
        e2, ch2 = v.synchroniser(e, {'18': ann('indisponible')}, J2)   # rien de nouveau : rien à écrire
        self.assertEqual((e2, ch2), (e, []))
        e3, ch3 = v.synchroniser(e, {'18': ann('disponible')}, J3)     # remise en ligne : le suivi d'avant revient
        b = e3['biens']['18']
        self.assertEqual(b['statut'], 'visite')
        self.assertFalse({'auto', 'avant', 'vu'} & set(b))
        self.assertEqual(len(ch3), 1)

    def test_disponible_ne_change_rien(self):
        e, ch = v.synchroniser(etat0(**{'1': {'statut': 'questions'}}), {'1': ann('disponible'), '2': ann('prix')}, J1)
        self.assertEqual(ch, [])
        self.assertEqual(e['biens']['1']['statut'], 'questions')
        self.assertEqual(e['maj'], '2026-11-10')

    def test_a_verifier_ne_change_rien(self):
        e0 = etat0(**{'3': {'statut': 'plusdispo', 'avant': 'etude', 'auto': True, 'vu': 'indisponible'}})
        e, ch = v.synchroniser(e0, {'3': ann('verifier')}, J2)
        self.assertEqual((e, ch), (e0, []))

    def test_le_choix_de_l_admin_n_est_pas_ecrase(self):
        e, _ = v.synchroniser(etat0(**{'5': {}}), {'5': ann('indisponible')}, J1)
        e['biens']['5'].update(statut='vendue')            # l'administrateur corrige (auto et avant effacés par l'admin)
        e['biens']['5'].pop('auto'); e['biens']['5'].pop('avant')
        e2, ch2 = v.synchroniser(e, {'5': ann('indisponible')}, J2)
        self.assertEqual((e2, ch2), (e, []))
        e3, ch3 = v.synchroniser(e, {'5': ann('disponible')}, J3)   # remise en ligne : on ne touche pas au choix de l'admin
        self.assertEqual(e3['biens']['5']['statut'], 'vendue')
        self.assertEqual(ch3, [])
        self.assertNotIn('vu', e3['biens']['5'])

    def test_statut_pose_a_la_main_avant_l_annonce(self):
        e, ch = v.synchroniser(etat0(**{'6': {'statut': 'vendue'}}), {'6': ann('vendue')}, J1)
        self.assertEqual(ch, [])
        self.assertNotIn('auto', e['biens']['6'])
        self.assertEqual(e['biens']['6']['vu'], 'vendue')

    def test_plus_disponible_puis_vendue_garde_le_premier_avant(self):
        e, _ = v.synchroniser(etat0(**{'7': {'statut': 'visite'}}), {'7': ann('indisponible')}, J1)
        e, ch = v.synchroniser(e, {'7': ann('vendue')}, J2)
        b = e['biens']['7']
        self.assertEqual((b['statut'], b['avant'], b['vu']), ('vendue', 'visite', 'vendue'))
        e, _ = v.synchroniser(e, {'7': ann('disponible')}, J3)
        self.assertEqual(e['biens']['7']['statut'], 'visite')

    def test_compromis(self):
        e, ch = v.synchroniser(etat0(**{'8': {}}), {'8': ann('compromis')}, J1)
        self.assertEqual(e['biens']['8']['statut'], 'compromis')

    def test_bien_absent_de_la_base(self):
        e, ch = v.synchroniser({'maj': '2026-11-10', 'biens': {}}, {'9': ann('retiree')}, J1)
        self.assertEqual((e['biens']['9']['statut'], e['biens']['9']['avant']), ('retiree', 'etude'))
        self.assertTrue(e['biens']['9']['visible'])

    def test_prix_lu_dans_l_annonce(self):
        base = {'1': 300000}
        e, ch = v.synchroniser(etat0(**{'1': {}}), {'1': {'statut': 'disponible', 'prix': 300000}}, J1, base)
        self.assertNotIn('prix', e['biens']['1'])
        self.assertEqual(ch, [])
        e, ch = v.synchroniser(e, {'1': {'statut': 'prix', 'prix': 285000}}, J2, base)
        self.assertEqual((e['biens']['1']['prix'], e['biens']['1']['vu_prix']), (285000, 285000))
        self.assertEqual(ch, [('1', f'prix {v.eur(300000)} → {v.eur(285000)}')])
        e['biens']['1']['prix'] = 290000                       # l'administrateur corrige
        e2, ch2 = v.synchroniser(e, {'1': {'statut': 'prix', 'prix': 285000}}, J3, base)
        self.assertEqual((e2, ch2), (e, []))                  # même prix lu : rien n'est écrasé
        e3, ch3 = v.synchroniser(e, {'1': {'statut': 'prix', 'prix': 270000}}, J3, base)
        self.assertEqual(e3['biens']['1']['prix'], 270000)    # nouveau prix sur le site : le robot suit

    def test_titre_quand_seul_le_suivi_change(self):
        m = v.message_commit([], False, [], J2, 10, [('18', 'suivi « À étudier » → « Plus disponible »')])
        self.assertTrue(m.startswith('Annonces 15 nov. : suivi mis à jour (réf. 18)\n'))

    def test_message_avec_suivi(self):
        m = v.message_commit([(18, 'Redessan', 'plus disponible')], False, [], J2, 10, [('18', 'suivi « À étudier » → « Plus disponible »')])
        self.assertIn('Suivi réf. 18 : suivi « À étudier » → « Plus disponible »', m)


class Annulation(unittest.TestCase):
    def test_annuler_remet_le_suivi_et_empeche_la_reprise(self):
        avant = etat0(**{'1': {}, '2': {'statut': 'visite'}})
        apres, _ = v.synchroniser(avant, {'1': ann('indisponible'), '2': ann('vendue')}, J1)
        nouveau, remis, laisses = an.annuler(avant, apres, apres)
        self.assertEqual((remis, laisses), (['1', '2'], []))
        self.assertEqual((nouveau['biens']['1']['statut'], nouveau['biens']['2']['statut']), ('etude', 'visite'))
        self.assertEqual(nouveau['biens']['1']['vu'], 'indisponible')
        self.assertNotIn('auto', nouveau['biens']['1'])
        e, ch = v.synchroniser(nouveau, {'1': ann('indisponible'), '2': ann('vendue')}, J2)   # le lendemain
        self.assertEqual(ch, [])
        self.assertEqual(e['biens']['1']['statut'], 'etude')

    def test_bien_modifie_depuis_est_laisse(self):
        avant = etat0(**{'1': {}, '2': {}})
        apres, _ = v.synchroniser(avant, {'1': ann('indisponible'), '2': ann('indisponible')}, J1)
        actuel = json.loads(json.dumps(apres))
        actuel['biens']['2'].update(statut='ecarte', maj='2026-11-16')
        nouveau, remis, laisses = an.annuler(avant, apres, actuel)
        self.assertEqual((remis, laisses), (['1'], ['2']))
        self.assertEqual(nouveau['biens']['2']['statut'], 'ecarte')


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

    def test_seules_les_annonces_bienici_sont_lues(self):
        self.assertTrue(v.surveillee('https://www.bienici.com/annonce/vente/nimes/maison/5pieces/x-1'))
        self.assertFalse(v.surveillee('https://www.leboncoin.fr/ad/ventes_immobilieres/3228407854'))
        self.assertFalse(v.surveillee('https://www.bienici.com.autre.fr/annonce/1'))
        lues = v.lire_annonces()
        self.assertTrue(lues)
        self.assertTrue(all('bienici.com' in url for _, _, url, _ in lues))

    def test_api_ok_prix_et_drapeau(self):
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'description': 'vendu avec meubles'}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), ('ok', {'prix': 345000, 'drapeau': None}))
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'isSold': True}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1')[1]['drapeau'], 'vendue')
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'status': 'under offer'}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1')[1]['drapeau'], 'compromis')

    def test_mentions_de_l_annonceur(self):
        cas = [('Maison 5 pièces', 'SOUS COMPROMIS - belle maison', 'compromis'),
               ('Maison 5 pièces', 'Maison sous offre depuis lundi.', 'compromis'),
               ('VENDU - Maison 5 pièces', 'x', 'vendue'),
               ('Maison', 'Vendue ! Merci à tous.', 'vendue'),
               ('Maison', 'Cette maison est vendue.', 'vendue'),
               ('Maison', 'Maison vendue avec ses meubles et la piscine.', None),
               ('Maison', 'Possibilité de compromis rapide, offre à discuter.', None),
               ('Maison', 'Belle maison. ' + 'a' * 500 + ' sous compromis', None)]
        for titre, desc, attendu in cas:
            self.assertEqual(v.drapeau_texte(titre, desc), attendu, (titre, desc))
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'title': 'Maison', 'description': 'SOUS COMPROMIS. Maison lumineuse'}))})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), ('ok', {'prix': 345000, 'drapeau': 'compromis'}))
        # « vendu » écrit par l'annonceur l'emporte sur « plus disponible »
        self.fake({'realEstateAd.json': (200, {}, json.dumps({'price': 345000, 'title': 'VENDU - Maison', 'description': ''})),
                   'annonce/vente': (200, {}, '<h1>Cette annonce n’est plus disponible</h1>')})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1')[1]['drapeau'], 'vendue')

    def test_api_hors_marche(self):
        # Réponse réelle observée pour une annonce dépubliée : status.onTheMarket = False, closingDate renseignée.
        corps = json.dumps({'price': 390000, 'closingDate': '2026-11-13T08:44:31.551Z', 'publicationDate': '1970-01-01T00:00:00.000Z',
                            'status': {'onTheMarket': False, 'autoImported': True}})
        self.fake({'realEstateAd.json': (200, {}, corps)})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'),
                         (v.GONE, {'statut': 'indisponible', 'depuis': '2026-11-13'}))
        corps = json.dumps({'price': 390000, 'status': {'onTheMarket': True, 'autoImported': True}})
        self.fake({'realEstateAd.json': (200, {}, corps)})
        self.assertEqual(v.observer('https://x/annonce/vente/a/id-1'), ('ok', {'prix': 390000, 'drapeau': None}))

    def test_depuis_utilise_la_date_du_site(self):
        obs = {i: OK() for i in range(1, 11)}
        res, ver, _, _ = jour(obs, {}, {}, J1)
        obs[7] = (v.GONE, {'statut': 'indisponible', 'depuis': '2026-11-14'})
        res, ver, _, _ = jour(obs, res, ver, J2)
        self.assertEqual(res['7']['depuis'], '2026-11-14')
        self.assertEqual(res['7']['hist'][-1]['d'], '2026-11-14')

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
