# Suivi · Maisons autour de Nîmes

Site statique publié avec GitHub Pages sur https://suivi.becheroy.fr.
Aucune dépendance à installer, aucune étape de construction dans ce dépôt.

## Contenu

| Chemin | Rôle |
| --- | --- |
| `index.html` | Page publique : liste, filtres, fiches, comparaison, plan |
| `admin/` | Page d'administration : afficher ou masquer un bien, suivi, contact |
| `assets/app.js`, `assets/style.css` | Code et styles de la page publique |
| `assets/admin.js`, `assets/admin.css` | Code et styles de l'administration |
| `assets/data.js` | Données des biens (fichier généré, ne pas modifier à la main) |
| `data/etat.json` | Suivi modifiable : visibilité, statut et note de chaque bien, contact |
| `photos/` | Photos des annonces, en deux tailles (`-s` vignette, `-l` grande) |
| `assets/vendor/leaflet/` | Leaflet 1.9.4 (licence BSD-2-Clause), chargé seulement pour le plan |

## Mettre à jour

- **Suivi d'un bien, visibilité, contact** : page `/admin/`. Elle enregistre `data/etat.json`
  dans ce dépôt avec un jeton GitHub personnel, puis GitHub Pages republie le site en une à deux minutes.
- **Ajout ou retrait de biens, photos, critères** : par pull request.

## Adresses utiles

- Fiche d'un bien : `https://suivi.becheroy.fr/#bien-14`
- Comparaison : `https://suivi.becheroy.fr/#comparer=14,18,16`

Les pages portent une balise `noindex`. Les photos appartiennent aux agences et aux annonceurs.

## Mise à jour automatique des annonces

Chaque matin vers 7 h (heure de Paris), le workflow **Vérifier les annonces** (`.github/workflows/annonces.yml`) lance `scripts/verifier_annonces.py`. Le script ouvre chaque annonce de `assets/data.js` et en déduit un statut :

| Statut | Quand |
| --- | --- |
| Disponible | l'annonce est en ligne, sans changement |
| Prix modifié | le prix a changé (ancien et nouveau prix affichés pendant 14 jours) |
| Sous compromis | l'annonceur l'écrit dans le titre ou le début de la description (« sous compromis », « sous offre »…) |
| Vendue | l'annonceur l'écrit dans le titre ou le début de la description (« VENDU », « vendue ! »…), deux lectures concordantes |
| Plus disponible | la page reste en ligne mais affiche « Cette annonce n'est plus disponible », sans raison : vendue, retirée ou en pause (deux lectures concordantes) |
| Retirée | page supprimée ou renvoyée vers une liste (deux lectures concordantes) |
| À vérifier | le site a bloqué la lecture 3 jours de suite : aucune conclusion |

Les annonces vendues, retirées ou plus disponibles restent visibles, grisées et placées en fin de liste. Un blocage isolé ne change rien. Si près de la moitié des annonces disparaissent en même temps, le script suppose une panne du site et ne change rien.

Les résultats sont écrits dans `data/annonces.json` (statuts, prix, historique) et `data/verification.json` (date de la dernière lecture réussie). Chaque vérification est **un commit sur `main`** au message lisible, par exemple « Annonces 14 nov. : réf. 16 vendue ».

### Revenir en arrière

- **Corriger une annonce** : page `/admin/`, champ « Annonce » de la ligne du bien. « Forcer : … » l'emporte sur la lecture automatique, « Automatique » rend la main au script. C'est la solution durable.
- **Annuler une mise à jour** : GitHub, onglet *Actions*, workflow **Annuler une mise à jour des annonces**, *Run workflow*. Sans autre précision, il remet les statuts dans l'état d'avant la dernière mise à jour qui en a changé un. On peut aussi donner le numéro d'un commit précis. L'annulation est un nouveau commit : rien n'est effacé.
- **Mettre en pause** : onglet *Actions*, **Vérifier les annonces**, menu « … », *Disable workflow*.
- **Lancer une vérification maintenant** : même workflow, *Run workflow*. Le champ facultatif « diagnostic » (ex. `18`) détaille dans le journal ce que le site renvoie pour cette réf., sans adresse.

Tests du script : `python3 scripts/test_verifier_annonces.py` (sans réseau).
