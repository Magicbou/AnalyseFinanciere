# InvestPilot — audit des fournisseurs de cotations ETF

**État au 27 novembre 2026 — étude documentaire, aucun fournisseur sélectionné ni connecté.**

## 1. Périmètre à couvrir

Le catalogue public Amundi France annonce **654 produits**. Ce nombre désigne les produits/fonds de la gamme, pas nécessairement les lignes de cotation : un même ISIN peut être négocié sur plusieurs places. La gamme est internationale. Les places visibles dans les filtres Amundi comprennent notamment Euronext Paris, Xetra, Borsa Italiana, LSE, SIX Swiss Exchange, BX Swiss, BMV, BIVA, Euronext Amsterdam, CBOE CXE/DXE, SGX, TASE, WSE, Frankfurt, OMX, BME et Euronext Brussels.

Source catalogue : https://www.amundietf.fr/fr/particuliers/produits-etf/recherche

**Conséquence technique :** l'identifiant de rapprochement du fonds est l'ISIN ; la cotation doit être identifiée séparément par ticker + place + devise. Ne jamais supposer qu'un ticker isolé est mondialement unique.

## 2. Comparaison documentaire des fournisseurs

| Fournisseur | Ce que les pages publiques confirment | Limite pour notre besoin |
|---|---|---|
| Twelve Data | Offre Basic gratuite : données temps réel sur actions/ETF US ; Grow : ETF mondiaux en fin de journée ; Pro : données de marché temps réel européennes annoncées, 70+ marchés. | La matrice des places indique Euronext Paris, Amsterdam, Brussels et Xetra en EOD sur les plans individuels indiqués ; SIX à partir de Pro ; Cboe Europe temps réel en option payante (annoncée à partir de 300 USD/an). Donc « Pro » ne prouve pas une couverture temps réel de chaque cotation Amundi. |
| EODHD | Plans publics avec historique mondial ETF et données intraday ; flux temps réel européens annoncés sur des marchés/actions. | Le fournisseur précise que certaines données ETF/CFD sont indicatives, agrégées et pas nécessairement issues des places boursières. Le flux temps réel européen décrit est centré sur les actions/Cboe Europe : la couverture ETF par ISIN et place doit être démontrée instrument par instrument. Non retenu comme source de référence de cours ETF à ce stade. |
| Euronext Data | Web Services fournit des quotes, derniers prix, transactions et données de référence en temps réel, différé ou historique ; les ETF Euronext font partie des classes d'actifs couvertes. | Source officielle pour les seules places Euronext couvertes. Ne peut pas, à elle seule, couvrir Xetra, LSE, SIX, BMV, BIVA, SGX, etc. Les droits/licences et tarifs doivent être confirmés. |

### Liens et éléments tarifaires observés

- Twelve Data ETF : https://twelvedata.com/etf
- Twelve Data tarifs et conditions par plan : https://twelvedata.com/pricing
  - Basic : 0 USD/mois, 8 crédits/minute (800/jour), temps réel US actions/ETF, usage non-display interne.
  - Grow : à partir de 29 USD/mois ; ETF mondiaux EOD.
  - Pro : à partir de 99 USD/mois ; temps réel européen annoncé, mais disponibilité dépendante de la place et des options.
  - Option Cboe Europe : annoncée à partir de 300 USD/an ; option ISIN affichée à partir de 24 000 USD/an. Ces prix sont ceux affichés publiquement à la date de l'audit, pas un devis commercial.
- Liste des places Twelve Data et délais : https://twelvedata.com/exchanges
- EODHD tarifs : https://eodhd.com/pricing/
- EODHD flux temps réel : https://eodhd.com/financial-apis/new-real-time-data-api-websockets
- Euronext accès aux données : https://www.euronext.com/en/data/real-time-data/how-access-market-data
- Euronext Web Services : https://www.euronext.com/en/data/how-access-market-data/web-services
- Politique de licences Euronext : https://www.euronext.com/en/data/real-time-data/pricing-specs-agreements/market-data-pricing-policies

## 3. Verdict à ce stade

**Aucun fournisseur n'est encore validé pour fournir le cours réellement négocié en temps réel sur toutes les cotations des 654 produits Amundi dans le monde.** Choisir Twelve Data ou EODHD sur la seule base d'une promesse « global » serait prématuré.

La piste la plus sérieuse à tester en premier est Twelve Data, car elle propose une API unifiée et une couverture ETF internationale ; mais il faut contrôler les droits et le délai exacts pour chaque place. Pour les places Euronext, le flux officiel Euronext sert de référence de comparaison. Un fournisseur complémentaire ou un contrat data global pourrait être nécessaire pour les places non couvertes.

## 4. Échantillon de validation reproductible

Les instruments ci-dessous sont extraits du catalogue Amundi visible lors de l'audit. Ils couvrent plusieurs indices, devises, places et formes de part :

| Produit | ISIN | Ticker Amundi | Place à valider |
|---|---|---|---|
| Amundi Core S&P 500 Swap UCITS ETF Acc | LU1135865084 | SP5C FP | Euronext Paris |
| Amundi Core S&P 500 Swap UCITS ETF USD Dist | LU0496786657 | 6TVM GY | Xetra |
| Amundi Core MSCI World UCITS ETF Acc | IE000BI8OT95 | MWRD FP | Euronext Paris |
| Amundi Core MSCI Emerging Markets Swap UCITS ETF Dist | LU2573966905 | AE5A GY | Xetra |
| Amundi Core MSCI Emerging Markets Swap UCITS ETF Acc | LU2573967036 | LEMA IM | Borsa Italiana |
| Amundi PEA Nasdaq-100 UCITS ETF Acc | FR0011871110 | PUST FP | Euronext Paris |

Source des instruments : catalogue Amundi et fiches mensuelles Amundi. Pour chaque instrument, la résolution fournisseur devra confirmer le couple ISIN/place ; le suffixe ticker Amundi ne sera pas converti automatiquement en symbole fournisseur.

## 5. Protocole de test obligatoire avant sélection

Pour chaque couple ISIN/place et chaque fournisseur :

1. Résoudre l'instrument via la référence officielle du fournisseur ; conserver le symbole et le MIC retournés.
2. Relever dernier prix, bid, ask, devise, horodatage de marché, horodatage de réception, place, statut de séance et indicateur temps réel/différé.
3. Vérifier la fraîcheur pendant une séance ouverte ; comparer simultanément au flux officiel de la place lorsque disponible.
4. Répéter au minimum à l'ouverture, en milieu de séance et à la clôture ; inclure une séance fermée pour vérifier que le dernier cours n'est pas présenté comme actuel.
5. Contrôler les erreurs, trous, limites API, débit, couverture par place et coûts.
6. Obtenir par écrit les droits d'affichage dans une application personnelle et les éventuelles restrictions de redistribution.

Un résultat sans timestamp de marché fiable, sans place identifiée ou sans droit d'utilisation explicite est rejeté. Une donnée EOD ou différée reste disponible uniquement avec son statut clairement affiché ; elle n'est jamais étiquetée « temps réel ».

## 6. Accès nécessaires pour le test technique

Aucune clé API ni licence fournisseur n'est actuellement configurée dans le dépôt. Les essais réels authentifiés ne peuvent donc pas être exécutés depuis le code seul. Les secrets, lorsqu'ils seront disponibles, devront être ajoutés aux secrets GitHub/Cloudflare — jamais dans le code, les commits ou une conversation.

Le code de production ne doit pas basculer vers un fournisseur avant que l'échantillon soit passé et que les limites de couverture soient connues.
