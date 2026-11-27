import { useEffect, useMemo, useState } from "react";
import { Globe2, Activity, ArrowDownRight, ArrowUpRight, BadgeCheck, BookOpen, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleAlert, Database, FileSpreadsheet, FilterX, Layers3, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import type { AmundiCatalogProduct, AmundiCatalogResponse } from "./lib/catalog";

type Page = "overview" | "etfs" | "assurance" | "portfolio" | "sources";
type Filters = { currency: string; venue: string; sfdr: string; exposure: string };
type EuronextTrade = { isin:string; status:string; price:string|null; currency?:string; tradeTime?:string; publicationTime?:string; quantity?:string };
type EuronextResponse = { status:string; source?:string; sourceName?:string; retrievedAt?:string; delayPolicy?:string; results?:EuronextTrade[]; message?:string };
type AssuranceContract = { slug:string; name:string; insurer:string|null; distributor:string|null; management:string|null; entryFeePct:number|null; ucManagementFeePct:number|null; euroManagementFeePct:number|null; arbitrationFeePct:number|null; supportCount:number|null; etfCount:number|null; scpiCount:number|null; minimumInitialEur:number|null; euroFund:string|null; euroRate2025Pct:number|null; euroRate2024Pct:number|null; euroRate2023Pct:number|null; feeCheckedAt:string|null; rateCheckedAt:string|null; contractSourceUrl:string|null; rateSourceUrl:string|null; detailUrl:string|null };
type AssuranceResponse = { status:string; sourceName?:string; retrievedAt?:string; sourceLicense?:string; sourceUrls?:{fees:string;euroRates:string}; methodology?:string; rateDefinition?:string; contractCount?:number; contracts?:AssuranceContract[]; message?:string };
const emptyFilters: Filters = { currency: "Toutes", venue: "Toutes", sfdr: "Toutes", exposure: "Toutes" };

function exchangeFromTicker(ticker: string): string {
  const suffix = ticker.trim().split(/\s+/).pop()?.toUpperCase();
  const map: Record<string, string> = { FP: "Euronext Paris", GY: "Xetra", LN: "London Stock Exchange", IM: "Euronext Milan", SW: "SIX Swiss Exchange", NA: "Euronext Amsterdam", BB: "Euronext Brussels", SM: "BME", GR: "Frankfurt", SS: "Nasdaq Stockholm" };
  return suffix ? map[suffix] ?? suffix : "Non identifié";
}
function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a,b)=>a.localeCompare(b,"fr"));
}
function groupProducts(products: AmundiCatalogProduct[]) {
  const map = new Map<string, AmundiCatalogProduct[]>();
  for (const product of products) map.set(product.isin, [...(map.get(product.isin) ?? []), product]);
  return [...map.entries()].map(([isin, listings]) => ({ isin, product: listings[0], listings }));
}
function App() {
  const [page, setPage] = useState<Page>("overview");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<AmundiCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [fxData, setFxData] = useState<{source:string;retrievedAt:string;observations:{currency:string;rate:number|null;observationDate:string|null;status:string}[]} | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [euronextTrades, setEuronextTrades] = useState<Record<string,EuronextTrade>>({});
  const [euronextLoading, setEuronextLoading] = useState(false);
  const [euronextRetrievedAt, setEuronextRetrievedAt] = useState<string|null>(null);
  const [euronextError, setEuronextError] = useState<string|null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string|null>(null);
  const [assuranceData, setAssuranceData] = useState<AssuranceResponse|null>(null);
  const [assuranceLoading, setAssuranceLoading] = useState(false);
  const [assuranceError, setAssuranceError] = useState<string|null>(null);
  const [assuranceSearch, setAssuranceSearch] = useState("");
  const loadFx = async () => { setFxLoading(true); setFxError(null); try { const response = await fetch("/api/market/fx", {headers:{Accept:"application/json"}}); const data = await response.json(); if (!response.ok) throw new Error("Source BCE indisponible"); setFxData(data); } catch (error) { setFxError(error instanceof Error ? error.message : "Source BCE indisponible"); } finally { setFxLoading(false); } };
  useEffect(() => { void refreshAll(); }, []);

  const loadEuronext = async (items: AmundiCatalogProduct[]) => {
    const isins = [...new Set(items.map(item=>item.isin).filter(Boolean))];
    if (!isins.length) return;
    setEuronextLoading(true); setEuronextError(null);
    const collected: Record<string,EuronextTrade> = {};
    try {
      const response=await fetch("/api/market/euronext?isins="+encodeURIComponent(isins.join(",")),{headers:{Accept:"application/json"}});
      const data=await response.json() as EuronextResponse;
      if (!response.ok || data.status!=="ok") throw new Error(data.message||"Flux Euronext indisponible.");
      for (const trade of data.results??[]) collected[trade.isin]=trade;
      setEuronextRetrievedAt(data.retrievedAt??null);
      setEuronextTrades(collected);
    } catch(error) {
      setEuronextError(error instanceof Error?error.message:"Erreur de lecture Euronext.");
    } finally { setEuronextLoading(false); }
  };

  const loadCatalog = async () => {
    setLoading(true); setCatalogError(null);
    try {
      const response = await fetch("/api/catalog/amundi", { headers: { Accept: "application/json" } });
      const data = await response.json() as AmundiCatalogResponse;
      if (!response.ok || data.status !== "ok") throw new Error(data.status === "unparsed_source" ? "La page Amundi a changé de format. Aucune donnée n'a été importée." : "La source Amundi est momentanément indisponible.");
      setCatalog(data);
      await loadEuronext(data.products);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Erreur inconnue lors du chargement.");
    } finally { setLoading(false); }
  };
  const loadAssuranceVie = async () => {
    setAssuranceLoading(true); setAssuranceError(null);
    try {
      const response = await fetch("/api/assurance-vie/contracts", {headers:{Accept:"application/json"}});
      const data = await response.json() as AssuranceResponse;
      if (!response.ok || data.status !== "ok" || !data.contracts?.length) throw new Error(data.message || "Jeux de données assurance-vie indisponibles.");
      setAssuranceData(data);
    } catch(error) {
      setAssuranceError(error instanceof Error ? error.message : "Erreur de lecture des données assurance-vie.");
    } finally { setAssuranceLoading(false); }
  };
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([loadFx(), loadCatalog(), loadAssuranceVie()]);
      setLastRefreshAt(new Date().toISOString());
    } finally { setRefreshing(false); }
  };
  useEffect(() => { if (page === "etfs" && catalog === null && !loading && !catalogError) void loadCatalog(); if (page === "assurance" && assuranceData === null && !assuranceLoading && !assuranceError) void loadAssuranceVie(); }, [page]);

  const products = catalog?.products ?? [];
  const filtered = useMemo(() => products.filter(p => {
    const haystack = [p.name,p.isin,p.ticker,p.wkn,p.exposure].join(" ").toLowerCase();
    return (!search || haystack.includes(search.toLowerCase()))
      && (filters.currency === "Toutes" || p.currency === filters.currency)
      && (filters.venue === "Toutes" || exchangeFromTicker(p.ticker) === filters.venue)
      && (filters.sfdr === "Toutes" || p.sfdr === filters.sfdr)
      && (filters.exposure === "Toutes" || p.exposure === filters.exposure);
  }), [products, search, filters]);
  const groups = useMemo(() => groupProducts(filtered), [filtered]);
  const currencies = unique(products.map(p=>p.currency));
  const venues = unique(products.map(p=>exchangeFromTicker(p.ticker)));
  const sfdrs = unique(products.map(p=>p.sfdr));
  const exposures = unique(products.map(p=>p.exposure));

  const resetFilters = () => { setSearch(""); setFilters(emptyFilters); };
  const hasFilters = search.length > 0 || Object.values(filters).some(v=>v!=="Toutes");
  const nav = [
    { id: "overview" as const, label: "Vue d'ensemble", icon: ChartNoAxesCombined },
    { id: "etfs" as const, label: "Catalogue ETF", icon: Layers3 },
    { id: "assurance" as const, label: "Assurance-vie", icon: ShieldCheck },
    { id: "portfolio" as const, label: "Portefeuille", icon: Wallet },
    { id: "sources" as const, label: "Sources & données", icon: Database },
  ];

  const todayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const appVersion = "0.5.0";

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();setPage("overview");}}><span className="brand-mark">I</span><span>invest<span className="brand-light">pilot</span></span></a>
      <div className="workspace-label">ESPACE PERSONNEL</div>
      <nav>{nav.map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${page===id?"active":""}`} onClick={()=>setPage(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="integrity"><ShieldCheck size={17}/><span>Mode factuel activé</span></div><p>Les données non vérifiées ne sont jamais présentées comme des faits.</p><span className="version">VERSION 0.5.0 · EN CONSTRUCTION</span></div>
    </aside>
    <section className="main-content">
      <header className="topbar"><div><span className="eyebrow">{page==="etfs"?"UNIVERS D'INVESTISSEMENT":page==="assurance"?"COMPARATEUR DE CONTRATS":page==="portfolio"?"SUIVI PERSONNEL":page==="sources"?"TRAÇABILITÉ":"TABLEAU DE BORD"}</span><h1>{page==="etfs"?"Catalogue des ETF Amundi":page==="assurance"?"Comparer les assurances-vie":page==="portfolio"?"Votre portefeuille":page==="sources"?"Sources & qualité des données":"Décider sur des faits."}</h1><div className="page-meta"><span>{todayLabel}</span><span className="meta-separator">·</span><span>InvestPilot v{appVersion}</span></div></div><div className="topbar-right"><button className="secondary-button" onClick={()=>void refreshAll()} disabled={refreshing} title="Actualiser toutes les sources disponibles"><RefreshCw size={15} className={refreshing?"spin":""}/>{refreshing?"Actualisation…":"Actualiser les données"}</button><span className="status-dot"/>{refreshing?"Synchronisation en cours":lastRefreshAt?`Actualisé à ${new Date(lastRefreshAt).toLocaleTimeString("fr-FR")}`:catalog?"Catalogue source accessible":"Sources en attente"}<span className="avatar">P</span></div></header>

      {page==="overview"&&<>
        <section className="intro"><div><div className="eyebrow pale">VOTRE COCKPIT D'INVESTISSEMENT</div><h2>Moins d'intuition.<br/><em>Plus de preuves.</em></h2><p>Comparer, comprendre et arbitrer à partir de données vérifiables — jamais à partir de chiffres inventés.</p></div><div className="intro-stamp"><BadgeCheck size={18}/><span>Engagement<br/><strong>zéro donnée inventée</strong></span></div></section>
        <section className="section-heading"><div><span className="eyebrow">SITUATION ACTUELLE</span><h2>Vos indicateurs</h2></div><span className="muted small">En attente de connexion aux sources</span></section>
        <div className="metric-grid"><article className="metric-card"><div className="metric-label">Portefeuille analysé <Wallet size={17}/></div><div className="metric-value">—</div><div className="metric-note">Aucune donnée importée</div></article><article className="metric-card"><div className="metric-label">ETF Amundi <FileSpreadsheet size={17}/></div><div className="metric-value">{catalog?.sourceTotal ?? "—"}</div><div className="metric-note">Catalogue officiel à synchroniser</div></article><article className="metric-card"><div className="metric-label">Dernière actualisation <Activity size={17}/></div><div className="metric-value">—</div><div className="metric-note">Pas de flux de marché connecté</div></article><article className="metric-card"><div className="metric-label">Alertes de fiabilité <CircleAlert size={17}/></div><div className="metric-value">—</div><div className="metric-note">Contrôles en cours de construction</div></article></div>
        <section className="fx-section"><div className="section-heading"><div><span className="eyebrow">REPÈRES DE CHANGE</span><h2>Références quotidiennes BCE</h2></div><button className="secondary-button" onClick={()=>void loadFx()} disabled={fxLoading}><RefreshCw size={14}/> Actualiser</button></div><div className="fx-grid">{fxData?.observations.map(item=><article className="fx-card" key={item.currency}><div className="fx-currency"><Globe2 size={15}/> EUR / {item.currency}</div><strong>{item.status==="ok"&&item.rate!==null?item.rate.toLocaleString("fr-FR",{minimumFractionDigits:4,maximumFractionDigits:4}):"Indisponible"}</strong><small>{item.observationDate?("Référence du "+new Date(item.observationDate+"T00:00:00Z").toLocaleDateString("fr-FR")):"Aucune observation récente"}</small></article>) || <div className="fx-empty">{fxLoading?"Chargement des taux BCE…":fxError||"Données BCE non disponibles"}</div>}</div><p className="fx-source">Source : <a href="https://data.ecb.europa.eu/data/datasets/EXR" target="_blank" rel="noreferrer">Banque centrale européenne</a> · Taux de référence quotidiens, non assimilables à des cours de transaction. Collecte : {fxData?.retrievedAt?new Date(fxData.retrievedAt).toLocaleString("fr-FR"):"en attente"} · Toute observation de plus de 7 jours est masquée.</p></section>
        <section className="section-heading"><div><span className="eyebrow">MÉTHODE</span><h2>Notre règle de décision</h2></div><span className="tag"><ShieldCheck size={14}/> Factuel uniquement</span></section>
        <div className="principle-grid">{[{title:"Source obligatoire",detail:"Chaque chiffre renvoie à une source identifiable.",icon:Database},{title:"Date visible",detail:"La date de collecte et la fraîcheur sont affichées.",icon:Activity},{title:"Fait ≠ analyse",detail:"Observations, calculs et scénarios sont séparés.",icon:ShieldCheck}].map(({title,detail,icon:Icon},i)=><article className="principle-card" key={title}><div className="principle-top"><span>0{i+1}</span><Icon size={19}/></div><h3>{title}</h3><p>{detail}</p></article>)}</div>
        <section className="decision-panel"><div className="decision-icon"><BookOpen size={20}/></div><div><span className="eyebrow">AIDE À LA DÉCISION</span><h2>Aucune recommandation sans éléments vérifiables.</h2><p>Chaque analyse présentera les faits observés, les calculs reproductibles, les limites des données et les risques. Une conclusion pourra être « données insuffisantes ».</p></div><div className="decision-mark"><ArrowUpRight size={20}/><ArrowDownRight size={20}/></div></section>
      </>}

      {page==="etfs"&&<section className="catalog-page">
        <div className="catalog-intro"><div><span className="eyebrow">AMUNDI · SOURCE OFFICIELLE</span><h2>Le catalogue, lisible à votre rythme.</h2><p>Recherche et filtres sur les données publiées par Amundi. Les lignes sont regroupées par ISIN ; dépliez un produit pour voir ses cotations disponibles dans la source.</p></div><div className="catalog-count"><Layers3 size={19}/><span><strong>{catalog?.sourceTotal??"—"} produits référencés</strong><small>{catalog?.retrievedAt?new Date(catalog.retrievedAt).toLocaleString("fr-FR"):"Synchronisation non effectuée"}</small></span></div></div>
        <div className="catalog-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Rechercher un ETF" placeholder="Nom, ISIN, ticker, WKN ou indice…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="clear-search" onClick={()=>setSearch("")} aria-label="Effacer">×</button>}</div><button className={`secondary-button ${showFilters?"selected":""}`} onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={16}/> Filtres <ChevronDown size={14}/></button><div className="view-switch"><button className={grouped?"chosen":""} onClick={()=>setGrouped(true)}>Par produit</button><button className={!grouped?"chosen":""} onClick={()=>setGrouped(false)}>Par cotation</button></div><button className="refresh-button" onClick={()=>void loadCatalog()} disabled={loading} title="Actualiser le catalogue"><RefreshCw size={16} className={loading?"spin":""}/></button></div>
        {showFilters&&<div className="filter-panel">
          <label className="filter-control"><span>Devise de la part</span><select value={filters.currency} onChange={e=>setFilters(p=>({...p,currency:e.target.value}))}><option>Toutes</option>{currencies.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Place (déduite du ticker source)</span><select value={filters.venue} onChange={e=>setFilters(p=>({...p,venue:e.target.value}))}><option>Toutes</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Classification SFDR</span><select value={filters.sfdr} onChange={e=>setFilters(p=>({...p,sfdr:e.target.value}))}><option>Toutes</option>{sfdrs.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Exposition publiée</span><select value={filters.exposure} onChange={e=>setFilters(p=>({...p,exposure:e.target.value}))}><option>Toutes</option>{exposures.map(v=><option key={v}>{v}</option>)}</select></label>
          <button className="reset-button" onClick={resetFilters} disabled={!hasFilters}><FilterX size={15}/> Réinitialiser</button>
        </div>}
        <div className="catalog-summary"><div><strong>{filtered.length} lignes affichées</strong><span> · {groups.length} ISIN dans le résultat filtré</span></div><span className={`data-status ${catalog?.completeness==="complete"?"verified":"warning"}`}><i/>{catalog?.completeness==="complete"?"Audit complet : total officiel rapproché":"Audit incomplet : exhaustivité non démontrée"}</span></div>
        {catalog?.audit&&<div className="catalog-audit-grid" aria-label="Contrôle d'exhaustivité du catalogue Amundi">
          <div><small>Total annoncé par Amundi</small><strong>{catalog.audit.officialProductTotal??"Indisponible"}</strong></div>
          <div><small>ISIN distincts récupérés</small><strong>{catalog.audit.uniqueIsinCount}</strong></div>
          <div><small>Cotations analysées</small><strong>{catalog.audit.parsedListingCount}</strong></div>
          <div><small>Pages non récupérées</small><strong>{catalog.audit.failedPages}</strong></div>
          <div><small>VL sans valeur</small><strong>{catalog.audit.missingNavCount}</strong></div>
          <div><small>VL sans date</small><strong>{catalog.audit.navWithoutPublicationDateCount}</strong></div>
          <p>Règle : le catalogue n'est déclaré complet que si le nombre d'ISIN distincts correspond au total officiel Amundi et si toutes les pages détectées ont été récupérées. Dernière VL publiée : {catalog.audit.newestNavDate??"non disponible"}.</p>
        </div>}
        {loading&&<div className="catalog-message"><RefreshCw className="spin" size={18}/> Chargement des données officielles Amundi…</div>}
        {catalogError&&<div className="catalog-error"><CircleAlert size={18}/><span>{catalogError}</span><button onClick={()=>void loadCatalog()}>Réessayer</button></div>}
        {!loading&&!catalogError&&catalog&&<div className="catalog-table-wrap">
          <div className="catalog-table-head"><span>PRODUIT / COTATION</span><span>ISIN</span><span>DEVISE</span><span>FRAIS</span><span>VL AMUNDI / PART</span><span>DATE DE PUBLICATION</span><span>DERNIER ÉCHANGE Euronext</span><span>ÉTAT</span></div>
          {grouped?groups.map(group=><div className="product-group" key={group.isin}>
            <button className="product-parent" onClick={()=>setExpanded(old=>{const next=new Set(old);next.has(group.isin)?next.delete(group.isin):next.add(group.isin);return next;})}><span className="product-name"><span className="expand-icon">{expanded.has(group.isin)?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</span><span><strong>{group.product.name||"Produit sans nom"}</strong><small>{group.listings.length} cotation(s) référencée(s) · {group.product.exposure||"Exposition non renseignée"}</small></span></span><span className="mono">{group.isin}</span><span>{group.product.currency||"—"}</span><span>{group.product.ongoingCharges||"—"}</span><span className="nav-value">{group.product.nav ? `${group.product.nav} ${group.product.currency}` : "Indisponible"}</span><span className="nav-date">{group.product.navDate ? `VL du ${group.product.navDate}` : "Date non publiée"}</span><span className="market-value">{euronextTrades[group.isin]?.status==="trade_found" ? `${euronextTrades[group.isin].price} ${euronextTrades[group.isin].currency||group.product.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[group.isin]?.tradeTime?new Date(euronextTrades[group.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="source-tag">SOURCE AMUNDI</span></button>
            {expanded.has(group.isin)&&<div className="listing-detail">{group.listings.map((item,i)=><div className="listing-row" key={item.ticker+"-"+i}><span><strong>{item.ticker}</strong><small>{exchangeFromTicker(item.ticker)}</small></span><span className="mono">{item.isin}</span><span>{item.currency}</span><span>{item.ongoingCharges||"—"}</span><span className="nav-value">{item.nav ? `${item.nav} ${item.currency}` : "Indisponible"}</span><span className="nav-date">{item.navDate ? `VL du ${item.navDate}` : "Date non publiée"}</span><span className="market-value">{euronextTrades[item.isin]?.status==="trade_found" ? `${euronextTrades[item.isin].price} ${euronextTrades[item.isin].currency||item.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[item.isin]?.tradeTime?new Date(euronextTrades[item.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="source-tag">VL, pas un cours live</span></div>)}</div>}
          </div>):filtered.map((item,i)=><div className="listing-row standalone" key={item.isin+"-"+item.ticker+"-"+i}><span><strong>{item.name}</strong><small>{item.ticker} · {exchangeFromTicker(item.ticker)}</small></span><span className="mono">{item.isin}</span><span>{item.currency}</span><span>{item.ongoingCharges||"—"}</span><span className="nav-value">{item.nav ? `${item.nav} ${item.currency}` : "Indisponible"}</span><span className="nav-date">{item.navDate ? `VL du ${item.navDate}` : "Date non publiée"}</span><span className="market-value">{euronextTrades[item.isin]?.status==="trade_found" ? `${euronextTrades[item.isin].price} ${euronextTrades[item.isin].currency||item.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[item.isin]?.tradeTime?new Date(euronextTrades[item.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="source-tag">SOURCE AMUNDI</span></div>)}
          {filtered.length===0&&<div className="catalog-message">Aucun produit ne correspond à ces critères.</div>}
        </div>}
        {!loading&&!catalogError&&!catalog&&<div className="catalog-message">Le catalogue officiel sera chargé à l'ouverture de cette page.</div>}
        {catalog&&<div className="catalog-footnote">{euronextError&&<p className="catalog-error">{euronextError}</p>}<p>Transactions Euronext : {euronextLoading?"actualisation…":euronextRetrievedAt?`collectées le ${new Date(euronextRetrievedAt).toLocaleString("fr-FR")}`:"non disponibles"}. Dernier échange Euronext sur la dernière heure, avec un délai de publication maximal annoncé de 15 minutes. Horodatages source UTC ; affichage en heure de Paris. Les absences de transaction ne sont jamais remplacées par une VL. <a href="https://marketdata.euronext.com/data-reporting-service/trades-file" target="_blank" rel="noreferrer">Source Euronext et conditions</a>. <button className="text-button" onClick={()=>void loadEuronext(catalog.products)} disabled={euronextLoading}>Actualiser les échanges</button></p>Source : <a href={catalog.source} target="_blank" rel="noreferrer">outil de recherche Amundi ETF</a>. Collecte : {catalog.retrievedAt?new Date(catalog.retrievedAt).toLocaleString("fr-FR"):"non connue"}. La VL est publiée par Amundi et n'est pas le cours négocié en Bourse. Les cours temps réel ne sont pas encore connectés.</div>}
      </section>}

      {page==="assurance"&&<section className="catalog-page">
        <div className="catalog-intro"><div><span className="eyebrow">ASSURANCE-VIE · DONNÉES OUVERTES</span><h2>Comparer les contrats sur leurs chiffres publiés.</h2><p>Frais contractuels, nombre de supports et taux des fonds euros. Les données manquantes restent non renseignées ; aucun score ni classement n'est inventé.</p></div><div className="catalog-count"><ShieldCheck size={19}/><span><strong>{assuranceData?.contractCount??"—"} contrats AV</strong><small>{assuranceData?.retrievedAt?new Date(assuranceData.retrievedAt).toLocaleString("fr-FR"):"Synchronisation non effectuée"}</small></span></div></div>
        <div className="catalog-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Rechercher un contrat d'assurance-vie" placeholder="Contrat, assureur ou courtier…" value={assuranceSearch} onChange={e=>setAssuranceSearch(e.target.value)}/>{assuranceSearch&&<button className="clear-search" onClick={()=>setAssuranceSearch("")} aria-label="Effacer">×</button>}</div><button className="secondary-button" onClick={()=>void loadAssuranceVie()} disabled={assuranceLoading}><RefreshCw size={15} className={assuranceLoading?"spin":""}/> Actualiser</button></div>
        {assuranceLoading&&<div className="catalog-message"><RefreshCw className="spin" size={18}/> Chargement des fichiers publics…</div>}
        {assuranceError&&<div className="catalog-error"><CircleAlert size={18}/><span>{assuranceError}</span><button onClick={()=>void loadAssuranceVie()}>Réessayer</button></div>}
        {assuranceData?.contracts&&<><div className="catalog-summary"><div><strong>{assuranceData.contracts.filter(c=>[c.name,c.insurer,c.distributor].some(v=>v?.toLowerCase().includes(assuranceSearch.toLowerCase()))).length} contrats affichés</strong><span> · Assurance-vie uniquement, PER exclus</span></div><span className="data-status verified"><i/>Sources ouvertes</span></div>
          <div className="catalog-table-wrap insurance-table"><div className="insurance-table-head"><span>CONTRAT / ASSUREUR</span><span>FRAIS VERSEMENT</span><span>GESTION UC</span><span>GESTION €</span><span>ARBITRAGE</span><span>FONDS € 2025</span><span>ETF / SUPPORTS</span><span>MINIMUM</span></div>
          {assuranceData.contracts.filter(c=>[c.name,c.insurer,c.distributor].some(v=>v?.toLowerCase().includes(assuranceSearch.toLowerCase()))).map(c=><div className="insurance-row" key={c.slug}><span><strong>{c.name}</strong><small>{c.insurer??"Assureur non renseigné"}{c.distributor?" · "+c.distributor:""}</small></span><span>{c.entryFeePct===null?"n.c.":c.entryFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.ucManagementFeePct===null?"n.c.":c.ucManagementFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.euroManagementFeePct===null?"n.c.":c.euroManagementFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.arbitrationFeePct===null?"n.c.":c.arbitrationFeePct.toLocaleString("fr-FR")+" %"}</span><span className="nav-value">{c.euroRate2025Pct===null?"n.c.":c.euroRate2025Pct.toLocaleString("fr-FR")+" %"}<small>{c.euroFund??"Fonds non précisé"}</small></span><span>{c.etfCount===null?"n.c.":c.etfCount} ETF / {c.supportCount===null?"n.c.":c.supportCount}</span><span>{c.minimumInitialEur===null?"n.c.":c.minimumInitialEur.toLocaleString("fr-FR")+" €"}</span></div>)}
          </div>
          <div className="catalog-footnote"><p>Les taux fonds euros 2025 sont nets des frais de gestion du contrat et bruts des prélèvements sociaux ; ils excluent les bonus conditionnels. Ils ne constituent pas des cours boursiers. Les unités de compte n'ont pas de valeur unique par contrat : leur valeur doit être consultée support par support et par ISIN.</p><p>{assuranceData.methodology} Licence : {assuranceData.sourceLicense}. Collecte InvestPilot : {new Date(assuranceData.retrievedAt??"").toLocaleString("fr-FR")}.</p><p>Sources : <a href={assuranceData.sourceUrls?.fees} target="_blank" rel="noreferrer">frais des contrats</a> · <a href={assuranceData.sourceUrls?.euroRates} target="_blank" rel="noreferrer">taux fonds euros</a> · <a href="https://www.data.gouv.fr/" target="_blank" rel="noreferrer">data.gouv.fr</a>. Les dates de vérification des lignes et les sources des assureurs sont disponibles dans les jeux de données d'origine.</p></div>
        </>}
      </section>}
      {page==="portfolio"&&<section className="placeholder-page"><Wallet size={24}/><h2>Suivi du portefeuille</h2><p>Cette section sera activée avec l'import des positions et le rapprochement des ISIN.</p></section>}
      {page==="sources"&&<section className="placeholder-page"><Database size={24}/><h2>Sources & qualité des données</h2><p>Catalogue : outil de recherche officiel Amundi. Cotations temps réel : fournisseur de marché et droits de diffusion à configurer. Aucune valeur liquidative n'est assimilée à un cours boursier.</p></section>}
      <footer><span>INVESTPILOT · 2026</span><span>Les performances passées ne préjugent pas des performances futures.</span></footer>
    </section>
  </main>;
}
export default App;
