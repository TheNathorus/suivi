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
