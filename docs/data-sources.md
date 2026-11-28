# Sources de données — InvestPilot

## Catalogue des produits Amundi

Source primaire utilisée par le connecteur :
- https://www.amundietf.fr/fr/particuliers/produits-etf/recherche
- Consultation du catalogue : 27 novembre 2026
- Le moteur de recherche Amundi affichait 654 produits sur cette page à cette date.

Le connecteur Cloudflare Pages lit les lignes de résultats et extrait les champs réellement présents : ticker tel que publié, WKN, nom, ISIN, devise de part, frais de gestion affichés, encours affiché, classification SFDR, exposition, valeur liquidative et date de VL, performances YTD et 1 an.

L'ISIN identifie le produit/compartiment dans InvestPilot. Le ticker accompagné du suffixe de place identifie la ligne de cotation publiée. Les lignes sont regroupées par ISIN et peuvent être dépliées dans l'interface.

### Contrôle d'exhaustivité

Le nombre annoncé par Amundi et le nombre de lignes réellement extraites sont comparés. La réponse API indique `completeness: complete` uniquement si les deux nombres concordent. Sinon, elle indique `partial`. Le connecteur suit les liens de pagination présents dans le HTML de la page ; si Amundi ne publie pas ces liens dans la réponse HTML, la collecte doit être complétée par le mécanisme officiel d'export avant de revendiquer l'exhaustivité.

Les champs absents restent vides. Aucun ticker, ISIN, frais, cours ou historique n'est fabriqué.

## Valeur liquidative et cours de Bourse

La VL Amundi est une valeur publiée par la société de gestion, avec sa propre date de calcul. Elle n'est pas assimilée au dernier cours négocié en Bourse. Les deux séries doivent être conservées séparément.

## Flux de marché

Pour les cotations Euronext, Euronext Web Services documente un accès HTTP/JSON REST aux cours, derniers prix, transactions et données de référence, en temps réel, différé ou historique. L'accès temps réel peut entraîner des frais. L'usage différé interne est annoncé gratuit sous conditions ; l'affichage ou la redistribution à des tiers peut nécessiter des accords et licences spécifiques.

Source documentation :
- https://www.euronext.com/en/data/how-access-market-data
- https://www.euronext.com/en/data/real-time-data/pricing-specs-agreements/market-data-pricing-policies
- https://www.euronext.com/en/data/pricing-specs-agreements/data-agreements-types

Pour les autres places (Xetra, Londres, SIX, Milan, etc.), un fournisseur couvrant chaque marché sera nécessaire. Un fournisseur unique ne sera retenu qu'après vérification de la couverture, des horodatages, des droits d'affichage, de l'historique, du coût et des conditions de redistribution.

## Statut de mise en service

- Catalogue Amundi : connecteur développé, validation d'exécution et d'exhaustivité encore requise.
- Cours temps réel : non connecté ; aucun droit de marché ni identifiant fournisseur n'est configuré.
- Cloudflare D1 : schéma initial présent dans `migrations/0001_initial.sql`, base et binding à créer.
- Production : non validée tant que CI, collecte réelle, migration D1, sécurité et tests de déploiement ne sont pas passés.

## Étude préliminaire des fournisseurs de cours

### Twelve Data — candidat à tester, pas encore retenu

Au 27 novembre 2026, l'offre individuelle Pro est affichée à 229 USD/mois avec 1 597 crédits API/minute et 1 500 crédits WebSocket. La page commerciale mentionne 70+ marchés et des données européennes en temps réel. En revanche, la matrice des places indique notamment Euronext Paris, Amsterdam, Xetra, Londres et SIX en fin de journée (EOD), tandis que Cboe Europe est identifié comme flux temps réel et add-on. La couverture temps réel de chaque ligne Amundi doit donc être vérifiée par ISIN/ticker et place, sans déduire qu'un marché entier est live à partir du nombre de places annoncées.

Les plans individuels sont limités à l'usage personnel/interne et n'autorisent ni redistribution ni affichage commercial à des tiers. Les plans business commencent avec Venture à 499 USD/mois affichés ; les données hors États-Unis nécessitent une approbation supplémentaire pour l'usage commercial, et la redistribution demande un accord distinct.

### EOD Historical Data — non retenu comme source de cours live de référence

Le fournisseur annonce une couverture européenne via Cboe pour les données différées et de fin de journée. Sa documentation précise que certains prix d'ETF/CFD proviennent de market makers et peuvent être indicatifs plutôt que des prix de marché exacts. Cela ne répond pas à l'exigence d'un dernier cours négocié vérifiable sur la place de cotation.

### Décision

Aucun fournisseur n'est retenu à ce stade. Le choix exige un test de couverture sur un échantillon représentatif d'ETF Amundi (ISIN, ticker, MIC), la vérification des horodatages et du type de prix, puis une confirmation écrite des droits d'affichage correspondant à l'usage réel d'InvestPilot. Aucun abonnement ne sera activé sans accord explicite.


## Historiques ETF et graphiques

Pour les cotations rattachées aux marchés Euronext Paris, Amsterdam, Bruxelles et Milan, InvestPilot interroge le service public de cours historiques de Euronext Live par couple ISIN + MIC. Le graphique restitue les clôtures quotidiennes ajustées réellement retournées par la source. Dans cette première version, InvestPilot limite la fenêtre interrogée aux deux dernières années ; la série n'est pas assimilée à un flux temps réel et peut être indisponible pour une cotation ou une place non couverte.

Source d'accès et exemple de formulaire historique :
- https://live.euronext.com/fr/popout-page/getHistoricalPrice/LU1681043599-XPAR
- Requête publique observée dans l'implémentation communautaire du paquet R Euronext : https://github.com/cran/Euronext/blob/master/R/EN_HistData.R

Les graphiques assurance-vie utilisent les taux annuels publiés du fonds euros dans le jeu de données ouvert « taux des fonds euros des contrats d'assurance vie et PER ». Ils ne décrivent ni les unités de compte, ni les performances du contrat complet. Les années sans taux publié restent absentes et ne sont ni interpolées ni estimées.

La collecte Euronext différée toutes les 15 minutes n'est pas un historique intraday : la publication réglementaire a jusqu'à 15 minutes de délai et les fichiers de transactions récents ne constituent pas une base historique durable. Aucun relevé intraday n'est reconstitué artificiellement.
