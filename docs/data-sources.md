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

Les graphiques ETF utilisent le point d'accès public de graphiques historiques de Yahoo Finance, sans clé API ni abonnement, à partir du ticker de cotation Amundi et de sa place (ex. CW8 FP → CW8.PA). La série quotidienne peut remonter jusqu'à dix ans selon l'ancienneté et la couverture de chaque ligne. Lorsque Yahoo fournit une série de clôtures ajustées, InvestPilot l'utilise pour calculer les rendements annuels ; sinon le graphique signale que les clôtures sont non ajustées. Les performances par année sont calculées sur les dernières clôtures observées de deux années successives ; l'année en cours est indiquée « à date ».

Limite importante : l'endpoint de graphique Yahoo Finance est public mais non documenté comme une API contractuelle. Sa disponibilité, sa couverture et ses règles d'accès peuvent évoluer. Les valeurs sont attribuées à Yahoo Finance, jamais présentées comme des données Euronext officielles. La cotation récente Euronext reste une source distincte et différée.

Les graphiques assurance-vie utilisent les taux annuels publiés du fonds euros dans le jeu de données ouvert « taux des fonds euros des contrats d'assurance vie et PER ». Ils ne décrivent ni les unités de compte, ni les performances du contrat complet. Les années sans taux publié restent visibles comme « n.c. » et ne sont ni interpolées ni estimées.

La collecte Euronext différée toutes les 15 minutes n'est pas un historique intraday : la publication réglementaire a jusqu'à 15 minutes de délai et les fichiers de transactions récents ne constituent pas une base historique durable. Aucun relevé intraday n'est reconstitué artificiellement.


## Règle qualité obligatoire — ETF (à appliquer à chaque ISIN et à chaque cotation)

Aucune valeur ETF ne doit être affichée comme vérifiée sur la seule base d'une correspondance de ticker supposée. Cette règle s'applique à l'ensemble du catalogue, et pas uniquement à un échantillon ou aux ETF Amundi.

### Identité et rapprochement
- L'ISIN est l'identifiant de la part/fonds ; il ne suffit pas à identifier une ligne de cotation.
- Chaque cotation doit être décrite par le triplet ISIN + ticker exact publié par l'émetteur + place/MIC, avec devise et type de cotation.
- Une conversion de suffixe (par exemple « FP » vers « .PA ») est une hypothèse technique, pas une preuve d'identité.
- Avant d'associer un historique à un ISIN, vérifier que la source de marché retourne une identité de cotation compatible (symbole, place, devise) et que cette ligne est explicitement rattachée à l'ISIN dans une source officielle. Si le rapprochement n'est pas démontré, refuser la série et afficher « non vérifié »/« indisponible ».

### Hiérarchie des sources
1. Émetteur/gestionnaire (Amundi pour ses fonds) : identité, caractéristiques de la part, devise, politique de distribution, valeur liquidative, dates de VL, distributions et performances officielles publiées.
2. Place de cotation officielle : transactions/cours de marché et métadonnées de cotation, dans la limite des droits et délais documentés.
3. Fournisseur tiers (ex. Yahoo Finance) : source secondaire de série historique uniquement après validation instrument par instrument ; ne jamais la présenter comme source officielle de la place ou de l'émetteur.

### Séries et calculs à ne pas confondre
- VL, cours de clôture coté, cours ajusté et performance officielle sont quatre notions distinctes.
- Une VL Amundi ne doit jamais être présentée comme un cours négocié.
- Un cours ajusté tiers ne doit pas être présenté comme une VL ni comme une performance officielle.
- Pour une part distribuante, vérifier le traitement des dividendes et fractionnements. Si la série ajustée, les distributions et leur réinvestissement ne sont pas documentés et contrôlés, ne pas qualifier le rendement de « total return ».
- Les périodes, devises, dates de début/fin et conventions de calcul doivent être visibles et cohérentes. Aucun remplissage, interpolation, extrapolation ou remplacement silencieux d'une donnée absente.

### Statut de validation par donnée
Chaque série affichée doit exposer au minimum : ISIN, ticker et place/MIC rapprochés, source et URL, nature de la donnée (VL/cours/clôture ajustée/performance officielle), devise, date de l'observation la plus récente, date de récupération, statut temps réel/différé/EOD, méthode de calcul et statut de validation.
- « Vérifié » uniquement si l'identité, la provenance, la devise, les dates et la méthode ont passé les contrôles.
- « Partiellement vérifié » si un contrôle secondaire manque ; afficher explicitement lequel et ne pas présenter la donnée comme certifiée.
- « Non vérifié » ou « indisponible » si l'identité ou la provenance ne peut pas être démontrée ; ne pas tracer de courbe ni calculer de performance à partir de cette série.

### Audit exhaustif avant certification du catalogue
L'audit doit couvrir 100 % des ISIN du catalogue et 100 % des lignes de cotation utilisées dans les graphiques, et non un simple échantillon. Pour chaque ligne, conserver le résultat de résolution, la source consultée, les champs comparés, l'horodatage, les écarts et la décision. Les échecs et absences doivent être comptés et consultables. La complétude du catalogue ne signifie pas que les historiques ou les cotations sont validés.

### État réel au 28 novembre 2026
- Le catalogue et les caractéristiques sont récupérés depuis l'API du site officiel Amundi.
- Le graphique ETF du code actuel interroge Yahoo Finance en construisant le symbole à partir du ticker Amundi et d'une table de suffixes. Le code valide le format de l'ISIN, mais ne démontre pas actuellement que le symbole Yahoo retourné correspond à cet ISIN et à la ligne/place exacte.
- En conséquence, les historiques Yahoo ne sont pas encore certifiés instrument par instrument. Ils ne doivent pas être décrits comme « validés » tant que le rapprochement exhaustif ci-dessus n'est pas implémenté et exécuté.
- La fiche officielle Amundi et l'historique de VL doivent être privilégiés pour contrôler la part. Les cours boursiers restent une série séparée.

Cette règle est bloquante : aucune couverture de 654 produits, aucun taux de réussite global et aucune courbe ne peut être qualifié de fiable si les lignes concernées n'ont pas passé leurs propres contrôles.
