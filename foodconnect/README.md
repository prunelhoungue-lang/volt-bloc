# FoodConnect

Application de commande de repas pour Cotonou (Bénin) : le client commande, le restaurant prépare, le livreur livre.

## Ce que contient la version 1 (démo)

| Espace | Écrans |
|---|---|
| Client | Accueil, inscription / connexion, restaurants à proximité (liste + carte), page restaurant (menu, avis, infos), panier, adresse de livraison (carte + GPS), paiement (MTN MoMo, Moov Money, Celtiis Cash, espèces), suivi de commande en direct, historique, profil |
| Restaurant | Tableau de bord du jour, commandes (accepter / refuser / « prête »), gestion du menu (ajouter, modifier, marquer épuisé), ouvert / fermé |
| Livreur | En ligne / hors ligne, commandes disponibles, course en cours avec carte, bouton « Naviguer » (Google Maps), récupérée / livrée, gains |
| Administration | Clients, restaurants, livreurs, commandes, chiffre d'affaires sur 7 jours, commissions (7 %), suspendre un restaurant |

**Mode démo :** les données restent sur le téléphone. Le paiement Mobile Money est simulé (aucun argent débité). Pour tester toute la chaîne sur un seul téléphone : Compte → Espaces de démonstration.

## Obtenir l'APK

1. Sur GitHub, ouvre l'onglet **Actions**.
2. Choisis **Construire FoodConnect (APK)**. La compilation se lance toute seule à chaque modification du dossier `foodconnect/` (ou bouton **Run workflow**).
3. Quand c'est vert (environ 5 minutes), ouvre l'exécution et télécharge **foodconnect-apk** en bas de la page.
4. Décompresse le zip sur ton téléphone et installe `app-debug.apk` (autorise « sources inconnues » si Android le demande).

## Prochaines étapes

1. **Firebase** : vrais comptes, et commandes partagées en temps réel entre clients, restaurants et livreurs.
2. **Paiement réel** : brancher un agrégateur Mobile Money du Bénin (par exemple FedaPay ou KKiaPay) pour MTN, Moov et Celtiis.
3. **Notifications** : prévenir le restaurant et le livreur à chaque nouvelle commande.
4. Vraies photos des plats, et restaurants partenaires réels.

## Fichiers

- `index.html` : styles et structure de la page
- `app.js` : toute l'application (écrans, données de démo, logique des commandes)
- `leaflet.js`, `leaflet.css` : bibliothèque de cartes (Leaflet 1.9.4, licence BSD-2), fonds de carte © OpenStreetMap © CARTO
- `.github/workflows/build-foodconnect.yml` : recette de compilation de l'APK
