import { Fragment, useEffect, useMemo, useState } from "react";
import { Globe2, Activity, ArrowDownRight, ArrowUpRight, BadgeCheck, BookOpen, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleAlert, Database, FileSpreadsheet, FilterX, Layers3, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { matchesAmundiFilters, matchesAmundiSearch, type AmundiCatalogProduct, type AmundiCatalogResponse } from "./lib/catalog";

type Page = "overview" | "etfs" | "assurance" | "portfolio" | "sources";
type Filters = { currency: string; venue: string; sfdr: string; exposure: string };
type EuronextTrade = { isin:string; status:string; price:string|null; currency?:string; tradeTime?:string; publicationTime?:string; quantity?:string };
type EuronextResponse = { status:string; source?:string; sourceName?:string; retrievedAt?:string; delayPolicy?:string; results?:EuronextTrade[]; message?:string };
type AssuranceSortPeriod = "1" | "3" | "5" | "8";
type AssurancePerformance = { annualizedPct:number|null; cumulativePct:number|null; years:number; fromYear:number; toYear:number; observations:number };
type AnnualRate = { year:number; ratePct:number|null };
type AssuranceHistoryObservation = { slug:string; fundName:string|null; year:number; ratePct:number; sourceUrl:string; sourceCheckedAt:string|null; collectedDate:string; collectedAt:string };
type AssuranceHistoryResponse = { status:string; slug?:string; count?:number; observations?:AssuranceHistoryObservation[]; methodology?:string; message?:string };
type EuronextHistoryPoint = { date:string; close:number; rawClose:number|null; open:number|null; high:number|null; low:number|null; volume:number|null };
type EuronextHistory = { status:string; source?:string; sourceName?:string; retrievedAt?:string; from?:string; to?:string; currency?:string|null; exchangeName?:string|null; adjusted?:boolean; points?:EuronextHistoryPoint[]; annualReturns?:{year:number;returnPct:number;fromDate:string;toDate:string;period:string}[]; methodology?:string; message?:string };
type AssuranceContract = { slug:string; name:string; insurer:string|null; distributor:string|null; management:string|null; entryFeePct:number|null; ucManagementFeePct:number|null; euroManagementFeePct:number|null; arbitrationFeePct:number|null; supportCount:number|null; etfCount:number|null; scpiCount:number|null; minimumInitialEur:number|null; euroFund:string|null; euroRate2025Pct:number|null; euroRate2024Pct:number|null; euroRate2023Pct:number|null; annualRates?:AnnualRate[]; euroPerformance:Record<AssuranceSortPeriod,AssurancePerformance>; feeCheckedAt:string|null; rateCheckedAt:string|null; contractSourceUrl:string|null; rateSourceUrl:string|null; detailUrl:string|null };
type AssuranceResponse = { status:string; sourceName?:string; retrievedAt?:string; sourceLicense?:string; sourceUrls?:{fees:string;euroRates:string}; methodology?:string; rateDefinition?:string; performanceEndYear?:number; contractCount?:number; contracts?:AssuranceContract[]; message?:string };
const emptyFilters: Filters = { currency: "Toutes", venue: "Toutes", sfdr: "Toutes", exposure: "Toutes" };

function exchangeFromTicker(ticker: string): string {
  const suffix = ticker.trim().split(/\s+/).pop()?.toUpperCase();
  const map: Record<string, string> = { FP: "Euronext Paris", GY: "Xetra", LN: "London Stock Exchange", IM: "Euronext Milan", SW: "SIX Swiss Exchange", NA: "Euronext Amsterdam", BB: "Euronext Brussels", SM: "BME", GR: "Frankfurt", SS: "Nasdaq Stockholm" };
  return suffix ? map[suffix] ?? suffix : "Non identifié";
}
function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a,b)=>a.localeCompare(b,"fr"));
}
function CertificationLabel({ product }: { product: AmundiCatalogProduct }) {
  // Sans statut explicite issu des contrôles, rester conservateur.
  const status = product.certificationStatus
    ?? (product.sourceType === "manual" ? "unverified" : "partial");
  const labels = {
    certified: "Certifié",
    partial: "Partiellement vérifié",
    unverified: "Non vérifié"
  } as const;
  const detail = product.certificationReason
    ?? (status === "certified"
      ? "Les contrôles de certification associés à cette donnée ont été validés."
      : status === "partial"
        ? "Source émetteur identifiée ; rapprochement indépendant de l'instrument/place et contrôles exhaustifs encore requis."
        : "Identité, provenance et justificatifs non suffisamment contrôlés.");
  return <span className={`certification-label certification-${status}`} title={detail} aria-label={`Statut de certification : ${labels[status]}. ${detail}`}>
    <i aria-hidden="true"/>{labels[status]}
  </span>;
}

function groupProducts(products: AmundiCatalogProduct[]) {
  const map = new Map<string, AmundiCatalogProduct[]>();
  for (const product of products) map.set(product.isin, [...(map.get(product.isin) ?? []), product]);
  return [...map.entries()].map(([isin, listings]) => ({ isin, product: listings[0], listings }));
}

function MarketHistoryChart({ title, history }: { title:string; history:EuronextHistory }) {
  const points = history.points ?? [];
  if (!points.length) return <div className="history-empty">{history.message ?? "Aucun historique exploitable pour cette cotation."}</div>;
  const values = points.map(point=>point.close);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max-min || Math.max(Math.abs(max)*0.01,0.01);
  const coordinates = points.map((point,index)=>({
    x: 34 + (points.length===1 ? 460 : index/(points.length-1)*920),
    y: 198 - ((point.close-min)/range)*156
  }));
  const path = coordinates.map((point,index)=>(index===0?"M":"L")+point.x.toFixed(1)+" "+point.y.toFixed(1)).join(" ");
  const first = points[0], last = points[points.length-1];
  const change = first.close ? (last.close/first.close-1)*100 : null;
  return <section className="history-chart-panel">
    <div className="history-chart-heading"><div><strong>{title}</strong><small>{history.adjusted?"Clôtures ajustées":"Clôtures non ajustées"} · {points.length} observations</small></div><div className="history-chart-current"><strong>{last.close.toLocaleString("fr-FR",{maximumFractionDigits:4})}</strong><small>{change===null?"":(change>=0?"+":"")+change.toLocaleString("fr-FR",{maximumFractionDigits:2})+" % sur la période"}</small></div></div>
    <svg className="history-line-chart" viewBox="0 0 980 240" role="img" aria-label={"Historique de cours de "+title}>
      <line x1="34" y1="42" x2="954" y2="42" />
      <line x1="34" y1="120" x2="954" y2="120" />
      <line x1="34" y1="198" x2="954" y2="198" />
      <path d={path} />
      <circle cx={coordinates[coordinates.length-1].x} cy={coordinates[coordinates.length-1].y} r="4" />
      <text x="34" y="225">{first.date}</text><text x="954" y="225" textAnchor="end">{last.date}</text>
      <text x="34" y="28">{max.toLocaleString("fr-FR",{maximumFractionDigits:3})}</text><text x="34" y="214">{min.toLocaleString("fr-FR",{maximumFractionDigits:3})}</text>
    </svg>
    {history.annualReturns?.length?<div className="history-annual-performance"><strong>Performance par année, calculée sur les clôtures {history.adjusted?"ajustées":"non ajustées"}</strong><div>{history.annualReturns.map(item=><span key={item.year}><b>{item.period==="year_to_date"?item.year+" à date":item.year}</b><strong>{(item.returnPct>=0?"+":"")+item.returnPct.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} %</strong><small>{item.fromDate} → {item.toDate}</small></span>)}</div></div>:null}
    <div className="history-chart-foot"><span>Source : <a href={history.source} target="_blank" rel="noreferrer">{history.sourceName??"Yahoo Finance"}</a></span><span>Collecte : {history.retrievedAt?new Date(history.retrievedAt).toLocaleString("fr-FR"):"n.c."}</span></div>
    <p>{history.methodology ?? "Historique publié par Euronext. Cours ajustés ; la série n'est pas un flux temps réel."}</p>
  </section>;
}

function AnnualRateChart({ title, rates, sourceUrl, checkedAt }: { title:string; rates:AnnualRate[]; sourceUrl:string|null; checkedAt:string|null }) {
  const available = rates.filter(item=>item.ratePct!==null);
  if (!available.length) return <div className="history-empty">Aucun taux annuel publié pour ce fonds euros dans la source.</div>;
  const values = available.map(item=>item.ratePct as number);
  const min = Math.min(0,...values), max = Math.max(0,...values);
  const range = max-min || 1;
  const baseline = 22 + (max/range)*112;
  const slot = 900/Math.max(rates.length,1);
  return <section className="history-chart-panel annual-history-panel">
    <div className="history-chart-heading"><div><strong>{title}</strong><small>Rendements annuels publiés du fonds euros · valeurs non interpolées</small></div><div className="history-chart-current"><strong>{available.length} années</strong><small>{available[0].year}–{available[available.length-1].year}</small></div></div>
    <svg className="annual-bar-chart" viewBox="0 0 980 190" role="img" aria-label={"Rendements annuels du fonds euros "+title}>
      <line x1="34" y1={baseline} x2="954" y2={baseline}/>
      {rates.map((item,index)=>{
        const x=38+index*slot+slot*.15;
        const width=Math.max(8,slot*.68);
        if(item.ratePct===null) return <g key={item.year}><text x={x+width/2} y={baseline-7} textAnchor="middle">n.c.</text><text x={x+width/2} y="184" textAnchor="middle">{item.year}</text></g>;
        const value=item.ratePct;
        const height=Math.abs(value)/range*112;
        const y=value>=0?baseline-height:baseline;
        return <g key={item.year}><rect x={x} y={y} width={width} height={Math.max(1,height)} rx="3"/><text x={x+width/2} y={value>=0?Math.max(12,y-5):Math.min(174,y+height+14)} textAnchor="middle">{value.toLocaleString("fr-FR",{maximumFractionDigits:2})} %</text><text x={x+width/2} y="184" textAnchor="middle">{item.year}</text></g>;
      })}
    </svg>
    <div className="history-chart-foot"><span>Source : {sourceUrl?<a href={sourceUrl} target="_blank" rel="noreferrer">jeu de données public</a>:"non renseignée"}</span><span>Relevé source : {checkedAt??"n.c."}</span></div>
    <p>Taux annuels nets des frais de gestion du contrat et bruts des prélèvements sociaux, selon la définition du jeu de données. Le graphique concerne le fonds euros, pas les unités de compte.</p>
  </section>;
}

function AssuranceSnapshotChart({ title, history }: { title:string; history:AssuranceHistoryResponse }) {
  const [windowDays, setWindowDays] = useState<7|30|365>(30);
  const years = [...new Set((history.observations??[]).map(item=>item.year))].sort((a,b)=>a-b);
  const [selectedYear,setSelectedYear] = useState<number|null>(null);
  const year = selectedYear!==null && years.includes(selectedYear) ? selectedYear : (years[years.length-1]??null);
  const cutoff = Date.now()-windowDays*86400000;
  const points = (history.observations??[])
    .filter(item=>item.year===year && Date.parse(item.collectedAt)>=cutoff)
    .sort((a,b)=>a.collectedAt.localeCompare(b.collectedAt));
  if (!history.observations?.length) return <div className="history-empty">{history.message??"Aucune collecte historique enregistrée pour ce contrat. La première apparaîtra après activation de la base D1."}</div>;
  const values=points.map(item=>item.ratePct);
  const min=Math.min(...values), max=Math.max(...values), range=max-min||Math.max(Math.abs(max)*0.01,0.01);
  const coords=points.map((item,index)=>({x:34+(points.length===1?460:index/(points.length-1)*920),y:184-((item.ratePct-min)/range)*142}));
  const path=coords.map((p,index)=>(index===0?"M":"L")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
  const last=points[points.length-1];
  return <section className="history-chart-panel">
    <div className="history-chart-heading"><div><strong>{title} · archives InvestPilot</strong><small>{points.length} collecte(s) sur {windowDays===7?"7 jours":windowDays===30?"30 jours":"365 jours"} · taux source de {year??"—"}</small></div><div className="history-chart-current"><strong>{last?last.ratePct.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" %":"—"}</strong><small>{last?"Dernière valeur archivée":"Aucune observation sur cette période"}</small></div></div>
    <div className="insurance-period-switch" aria-label="Période de l'historique">{([7,30,365] as const).map(days=><button key={days} className={windowDays===days?"active":""} onClick={()=>setWindowDays(days)}>{days===7?"Semaine":days===30?"Mois":"Année"}</button>)}
      <select aria-label="Année de rendement archivée" value={year??""} onChange={event=>setSelectedYear(Number(event.target.value))}>{years.map(item=><option key={item} value={item}>{item}</option>)}</select>
    </div>
    {points.length>0?<svg className="history-line-chart" viewBox="0 0 980 220" role="img" aria-label={"Historique des collectes du taux "+year+" pour "+title}>
      <line x1="34" y1="42" x2="954" y2="42"/><line x1="34" y1="113" x2="954" y2="113"/><line x1="34" y1="184" x2="954" y2="184"/>
      <path d={path}/><circle cx={coords[coords.length-1].x} cy={coords[coords.length-1].y} r="4"/>
      <text x="34" y="207">{points[0].collectedDate}</text><text x="954" y="207" textAnchor="end">{last.collectedDate}</text>
      <text x="34" y="28">{max.toLocaleString("fr-FR",{maximumFractionDigits:3})} %</text><text x="34" y="200">{min.toLocaleString("fr-FR",{maximumFractionDigits:3})} %</text>
    </svg>:<div className="history-empty">Aucune collecte sur cette période. Élargis l'horizon ou attends les prochaines collectes quotidiennes.</div>}
    <div className="history-chart-foot"><span>Source : {last?.sourceUrl?<a href={last.sourceUrl} target="_blank" rel="noreferrer">source du taux publié</a>:"non renseignée"}</span><span>Dernière collecte : {last?new Date(last.collectedAt).toLocaleString("fr-FR"):"n.c."}</span></div>
    <p>{history.methodology??"Snapshots des taux annuels publiés, archivés à chaque collecte. Une ligne stable signifie que le taux annuel publié n'a pas changé ; ce graphique n'est pas un rendement quotidien du placement."}</p>
  </section>;
}

function App() {
  const [page, setPage] = useState<Page>(() => { const candidate = window.location.hash.slice(1) as Page; return ["overview","etfs","assurance","portfolio","sources"].includes(candidate) ? candidate : "overview"; });
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [manualProducts, setManualProducts] = useState<AmundiCatalogProduct[]>(() => {
    try { return JSON.parse(localStorage.getItem("investpilot.manualEtfs") || "[]") as AmundiCatalogProduct[]; }
    catch { return []; }
  });
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDraft, setManualDraft] = useState({ name:"", isin:"", ticker:"", wkn:"", currency:"EUR", exposure:"", sfdr:"", ongoingCharges:"", nav:"", navDate:"", manualSource:"" });
  const [manualError, setManualError] = useState<string|null>(null);
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
  const [assuranceSortPeriod, setAssuranceSortPeriod] = useState<AssuranceSortPeriod>("5");
  const [historyByIsin, setHistoryByIsin] = useState<Record<string,EuronextHistory>>({});
  const [historyLoadingIsin, setHistoryLoadingIsin] = useState<string|null>(null);
  const [historyOpenIsin, setHistoryOpenIsin] = useState<string|null>(null);
  const [assuranceHistorySlug, setAssuranceHistorySlug] = useState<string|null>(null);
  const [assuranceHistoryBySlug,setAssuranceHistoryBySlug]=useState<Record<string,AssuranceHistoryResponse>>({});
  const [assuranceHistoryLoadingSlug,setAssuranceHistoryLoadingSlug]=useState<string|null>(null);
  const loadFx = async () => { setFxLoading(true); setFxError(null); try { const response = await fetch("/api/market/fx", {headers:{Accept:"application/json"}}); const data = await response.json(); if (!response.ok) throw new Error("Source BCE indisponible"); setFxData(data); } catch (error) { setFxError(error instanceof Error ? error.message : "Source BCE indisponible"); } finally { setFxLoading(false); } };
  useEffect(() => { void refreshAll(); }, []);
  useEffect(() => { localStorage.setItem("investpilot.manualEtfs", JSON.stringify(manualProducts)); }, [manualProducts]);

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

  const loadEtfHistory = async (product: AmundiCatalogProduct) => {
    setHistoryLoadingIsin(product.isin);
    try {
      const params = new URLSearchParams({ isin:product.isin, ticker:product.ticker });
      const response = await fetch("/api/market/history?"+params.toString(),{headers:{Accept:"application/json"}});
      const data = await response.json() as EuronextHistory;
      if (!response.ok && data.status!=="no_history") throw new Error(data.message||"Historique indisponible.");
      setHistoryByIsin(current=>({...current,[product.isin]:data}));
    } catch(error) {
      setHistoryByIsin(current=>({...current,[product.isin]:{status:"source_unavailable",message:error instanceof Error?error.message:"Erreur de lecture de l'historique."}}));
    } finally { setHistoryLoadingIsin(null); }
  };
  const toggleEtfHistory = (product: AmundiCatalogProduct) => {
    if (historyOpenIsin===product.isin) { setHistoryOpenIsin(null); return; }
    setHistoryOpenIsin(product.isin);
    if (!historyByIsin[product.isin]) void loadEtfHistory(product);
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
  const toggleAssuranceHistory = async (slug:string) => {
    if (assuranceHistorySlug===slug) { setAssuranceHistorySlug(null); return; }
    setAssuranceHistorySlug(slug);
    if (assuranceHistoryBySlug[slug]) return;
    setAssuranceHistoryLoadingSlug(slug);
    try {
      const response=await fetch("/api/assurance-vie/history?slug="+encodeURIComponent(slug),{headers:{Accept:"application/json"}});
      const data=await response.json() as AssuranceHistoryResponse;
      if (!response.ok || data.status!=="ok") throw new Error(data.message??"Historique D1 indisponible.");
      setAssuranceHistoryBySlug(current=>({...current,[slug]:data}));
    } catch(error) {
      setAssuranceHistoryBySlug(current=>({...current,[slug]:{status:"unavailable",message:error instanceof Error?error.message:"Historique D1 indisponible."}}));
    } finally { setAssuranceHistoryLoadingSlug(null); }
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

  const filteredAssuranceContracts = useMemo(() => (assuranceData?.contracts ?? [])
    .filter(contract => [contract.name, contract.insurer, contract.distributor].some(value => value?.toLocaleLowerCase("fr-FR").includes(assuranceSearch.toLocaleLowerCase("fr-FR"))))
    .sort((left, right) => {
      const leftValue = left.euroPerformance?.[assuranceSortPeriod]?.annualizedPct ?? null;
      const rightValue = right.euroPerformance?.[assuranceSortPeriod]?.annualizedPct ?? null;
      if (leftValue === null && rightValue === null) return left.name.localeCompare(right.name, "fr");
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return rightValue - leftValue;
    }), [assuranceData, assuranceSearch, assuranceSortPeriod]);

  const products = useMemo(() => {
    const official = catalog?.products ?? [];
    const officialIsins = new Set(official.map(product => product.isin.toUpperCase()));
    return [...official, ...manualProducts.filter(product => !officialIsins.has(product.isin.toUpperCase()))];
  }, [catalog?.products, manualProducts]);
  const filtered = useMemo(() => products.filter(p => {
    return matchesAmundiSearch(p, search)
      && matchesAmundiFilters(p, filters, exchangeFromTicker(p.ticker));
  }), [products, search, filters]);
  const groups = useMemo(() => groupProducts(filtered), [filtered]);
  const currencies = unique(products.map(p=>p.currency));
  const venues = unique(products.map(p=>exchangeFromTicker(p.ticker)));
  const sfdrs = unique(products.map(p=>p.sfdr));
  const exposures = unique(products.map(p=>p.exposure));

  const addManualProduct = () => {
    const isin = manualDraft.isin.trim().toUpperCase();
    const name = manualDraft.name.trim();
    const nav = manualDraft.nav.trim();
    const navDate = manualDraft.navDate.trim();
    const source = manualDraft.manualSource.trim();
    if (!name || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
      setManualError("Renseigne un nom et un ISIN valide de 12 caractères.");
      return;
    }
    if (products.some(product => product.isin.toUpperCase() === isin)) {
      setManualError("Cet ISIN existe déjà dans le catalogue ou dans tes ajouts manuels.");
      return;
    }
    if (nav && (!navDate || !source)) {
      setManualError("Pour saisir une VL, indique obligatoirement sa date et l'URL de sa source.");
      return;
    }
    if (nav && !/^\d{2}\/\d{2}\/\d{4}$/.test(navDate)) {
      setManualError("La date de la VL doit être au format JJ/MM/AAAA.");
      return;
    }
    if (nav && (() => { try { const url = new URL(source); return url.protocol !== "https:" && url.protocol !== "http:"; } catch { return true; } })()) {
      setManualError("L'URL de la source de la VL doit être valide.");
      return;
    }
    if (nav && (!Number.isFinite(Number(nav.replace(",", "."))) || Number(nav.replace(",", ".")) <= 0)) {
      setManualError("La valeur liquidative doit être un nombre positif.");
      return;
    }
    const product: AmundiCatalogProduct = {
      name, isin, ticker: manualDraft.ticker.trim(), wkn: manualDraft.wkn.trim(),
      currency: manualDraft.currency.trim().toUpperCase() || "EUR",
      exposure: manualDraft.exposure.trim() || null, sfdr: manualDraft.sfdr.trim() || null,
      ongoingCharges: manualDraft.ongoingCharges.trim() || null,
      assetsUnderManagement: null, nav: nav ? nav.replace(",", ".") : null,
      navDate: navDate || null, performanceYtd: null, performance1y: null,
      performance3y: null, performance5y: null, performance10y: null, srri: null,
      sourceUrl: source || "Saisie manuelle", sourceType: "manual",
      manualSource: source || null, manualAddedAt: new Date().toISOString()
    };
    setManualProducts(current => [...current, product]);
    setManualDraft({ name:"", isin:"", ticker:"", wkn:"", currency:"EUR", exposure:"", sfdr:"", ongoingCharges:"", nav:"", navDate:"", manualSource:"" });
    setManualError(null);
    setShowManualForm(false);
    void loadEuronext([product]);
  };
  const removeManualProduct = (isin: string) => setManualProducts(current => current.filter(product => product.isin !== isin));
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
  const appVersion = "0.6.1";

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();window.location.hash="overview";setPage("overview");}}><span className="brand-mark">I</span><span>invest<span className="brand-light">pilot</span></span></a>
      <div className="workspace-label">ESPACE PERSONNEL</div>
      <nav>{nav.map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${page===id?"active":""}`} onClick={()=>{window.location.hash=id;setPage(id);}}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="integrity"><ShieldCheck size={17}/><span>Mode factuel activé</span></div><p>Les données non vérifiées ne sont jamais présentées comme des faits.</p><span className="version">VERSION 0.6.1</span></div>
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
        <div className="manual-entry-bar"><div><strong>Un ETF manque au catalogue ?</strong><small>Ajoute-le localement sans le faire passer pour une donnée Amundi vérifiée.</small></div><button className="secondary-button" onClick={()=>setShowManualForm(value=>!value)}>{showManualForm?"Fermer":"Ajouter un ETF manuellement"}</button></div>
        {showManualForm&&<section className="manual-entry-panel">
          <div className="manual-entry-heading"><strong>Ajout manuel d'un ETF</strong><span>Enregistré dans ce navigateur uniquement</span></div>
          <div className="manual-entry-grid">
            <label>Nom du fonds *<input value={manualDraft.name} onChange={e=>setManualDraft(d=>({...d,name:e.target.value}))} placeholder="Nom exact du fonds"/></label>
            <label>ISIN *<input value={manualDraft.isin} onChange={e=>setManualDraft(d=>({...d,isin:e.target.value.toUpperCase()}))} placeholder="LU0000000000" maxLength={12}/></label>
            <label>Ticker / mnémonique<input value={manualDraft.ticker} onChange={e=>setManualDraft(d=>({...d,ticker:e.target.value}))} placeholder="Ex. ETF FP"/></label>
            <label>WKN<input value={manualDraft.wkn} onChange={e=>setManualDraft(d=>({...d,wkn:e.target.value}))}/></label>
            <label>Devise<input value={manualDraft.currency} onChange={e=>setManualDraft(d=>({...d,currency:e.target.value.toUpperCase()}))} maxLength={3}/></label>
            <label>Indice / exposition<input value={manualDraft.exposure} onChange={e=>setManualDraft(d=>({...d,exposure:e.target.value}))} placeholder="Ex. MSCI World"/></label>
            <label>Classification SFDR<input value={manualDraft.sfdr} onChange={e=>setManualDraft(d=>({...d,sfdr:e.target.value}))} placeholder="Article 8"/></label>
            <label>Frais courants<input value={manualDraft.ongoingCharges} onChange={e=>setManualDraft(d=>({...d,ongoingCharges:e.target.value}))} placeholder="0,20 %"/></label>
            <label>VL (facultative)<input value={manualDraft.nav} onChange={e=>setManualDraft(d=>({...d,nav:e.target.value}))} placeholder="Ex. 125,43"/></label>
            <label>Date de la VL<input value={manualDraft.navDate} onChange={e=>setManualDraft(d=>({...d,navDate:e.target.value}))} placeholder="JJ/MM/AAAA"/></label>
            <label className="manual-source-field">URL de la source (obligatoire si VL saisie)<input value={manualDraft.manualSource} onChange={e=>setManualDraft(d=>({...d,manualSource:e.target.value}))} placeholder="https://..."/></label>
          </div>
          {manualError&&<p className="manual-entry-error">{manualError}</p>}
          <div className="manual-entry-actions"><span>* Champs obligatoires. Aucune VL n'est créée automatiquement.</span><button className="primary-button" onClick={addManualProduct}>Enregistrer cet ETF</button></div>
        </section>}
        {showFilters&&<div className="filter-panel">
          <label className="filter-control"><span>Devise de la part</span><select value={filters.currency} onChange={e=>setFilters(p=>({...p,currency:e.target.value}))}><option>Toutes</option>{currencies.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Place (déduite du ticker source)</span><select value={filters.venue} onChange={e=>setFilters(p=>({...p,venue:e.target.value}))}><option>Toutes</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Classification SFDR</span><select value={filters.sfdr} onChange={e=>setFilters(p=>({...p,sfdr:e.target.value}))}><option>Toutes</option>{sfdrs.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="filter-control"><span>Exposition publiée</span><select value={filters.exposure} onChange={e=>setFilters(p=>({...p,exposure:e.target.value}))}><option>Toutes</option>{exposures.map(v=><option key={v}>{v}</option>)}</select></label>
          <button className="reset-button" onClick={resetFilters} disabled={!hasFilters}><FilterX size={15}/> Réinitialiser</button>
        </div>}
        <div className="catalog-summary"><div><strong>{filtered.length} lignes affichées</strong><span> · {groups.length} ISIN dans le résultat filtré</span></div><span className={`data-status ${catalog?.completeness==="complete"?"verified":"warning"}`}><i/>{catalog?.completeness==="complete"?"Audit complet : catalogue officiel France / INSTIT":"Audit incomplet : exhaustivité non démontrée"}</span></div>
        {catalog?.audit&&<div className="catalog-audit-grid" aria-label="Contrôle d'exhaustivité du catalogue Amundi">
          <div><small>Enregistrements de l'API</small><strong>{catalog.audit.apiProductRecords}</strong></div>
          <div><small>Produits actifs Amundi</small><strong>{catalog.audit.activeProductRecords}</strong></div>
          <div><small>Exclus (visibilité France)</small><strong>{catalog.audit.excludedByFranceInstitutionalVisibility}</strong></div>
          <div><small>ISIN distincts visibles</small><strong>{catalog.audit.uniqueVisibleIsinCount}</strong></div>
          <div><small>VL sans valeur</small><strong>{catalog.audit.missingNavCount}</strong></div>
          <div><small>VL sans date</small><strong>{catalog.audit.navWithoutPublicationDateCount}</strong></div>
          <p>Règle : catalogue exhaustif pour le contexte France / profil institutionnel ; produits liquidés et produits masqués par les règles de visibilité exclus du décompte.</p>
        </div>}
        {loading&&<div className="catalog-message"><RefreshCw className="spin" size={18}/> Chargement des données officielles Amundi…</div>}
        {catalogError&&<div className="catalog-error"><CircleAlert size={18}/><span>{catalogError}</span><button onClick={()=>void loadCatalog()}>Réessayer</button></div>}
        {!loading&&!catalogError&&catalog&&<div className="catalog-table-wrap">
          <div className="catalog-table-head"><span>PRODUIT / COTATION</span><span>ISIN</span><span>DEVISE</span><span>FRAIS</span><span>VL AMUNDI / PART</span><span>DATE DE PUBLICATION</span><span>DERNIER COURS · EURONEXT PARIS</span><span>PERFORMANCES AMUNDI</span><span>RISQUE SRRI</span><span>ÉTAT</span></div>
          {grouped?groups.map(group=><div className="product-group" key={group.isin}>
            <button className="product-parent" onClick={()=>setExpanded(old=>{const next=new Set(old);next.has(group.isin)?next.delete(group.isin):next.add(group.isin);return next;})}><span className="product-name"><span className="expand-icon">{expanded.has(group.isin)?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</span><span><strong>{group.product.name||"Produit sans nom"}</strong><small>{group.listings.length} cotation(s) référencée(s) · {group.product.exposure||"Exposition non renseignée"}</small></span></span><span className="mono">{group.isin}</span><span>{group.product.currency||"—"}</span><span>{group.product.ongoingCharges||"—"}</span><span className="nav-value">{group.product.nav ? `${group.product.nav} ${group.product.currency}` : "Indisponible"}</span><span className="nav-date">{group.product.navDate ? `VL du ${group.product.navDate}` : "Date non publiée"}</span><span className={`market-value ${euronextTrades[group.isin]?.status==="trade_found"?"market-value-current":""}`}>{euronextTrades[group.isin]?.status==="trade_found" ? `${euronextTrades[group.isin].price} ${euronextTrades[group.isin].currency||group.product.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[group.isin]?.tradeTime?new Date(euronextTrades[group.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="performance-value">{[["1 an",group.product.performance1y],["3 ans",group.product.performance3y],["5 ans",group.product.performance5y],["10 ans",group.product.performance10y]].map(([label,value])=><span key={label}>{label} <strong>{value!==null&&value!==undefined?Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2})+" %":"—"}</strong></span>)}</span><span className="risk-value">{group.product.srri&&/^[1-7]$/.test(group.product.srri)?<><strong>{group.product.srri} / 7</strong><small>SRRI Amundi</small></>:"Indisponible"}</span><span className="source-status-cell"><CertificationLabel product={group.product}/><span className={`source-tag ${group.product.sourceType==="manual"?"manual-source-tag":""}`}>{group.product.sourceType==="manual"?"AJOUT MANUEL":"SOURCE AMUNDI"}</span></span></button>
            <button className="history-toggle text-button" onClick={()=>toggleEtfHistory(group.product)}>{historyOpenIsin===group.isin?"Masquer le graphique":"Graphique historique"}</button>
            {group.product.sourceType==="manual"&&<button className="remove-manual-button" onClick={()=>removeManualProduct(group.isin)}>Retirer cet ajout manuel</button>}
            {expanded.has(group.isin)&&<div className="listing-detail">{group.listings.map((item,i)=><Fragment key={item.ticker+"-"+i}><div className="listing-row"><span><strong>{item.ticker}</strong><small>{exchangeFromTicker(item.ticker)}</small></span><span className="mono">{item.isin}</span><span>{item.currency}</span><span>{item.ongoingCharges||"—"}</span><span className="nav-value">{item.nav ? `${item.nav} ${item.currency}` : "Indisponible"}</span><span className="nav-date">{item.navDate ? `VL du ${item.navDate}` : "Date non publiée"}</span><span className={`market-value ${euronextTrades[item.isin]?.status==="trade_found"?"market-value-current":""}`}>{euronextTrades[item.isin]?.status==="trade_found" ? `${euronextTrades[item.isin].price} ${euronextTrades[item.isin].currency||item.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[item.isin]?.tradeTime?new Date(euronextTrades[item.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="performance-value">{[["1 an",item.performance1y],["3 ans",item.performance3y],["5 ans",item.performance5y],["10 ans",item.performance10y]].map(([label,value])=><span key={label}>{label} <strong>{value!==null&&value!==undefined?Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2})+" %":"—"}</strong></span>)}</span><span className="risk-value">{item.srri&&/^[1-7]$/.test(item.srri)?<><strong>{item.srri} / 7</strong><small>SRRI Amundi</small></>:"Indisponible"}</span><span className="source-status-cell"><CertificationLabel product={item}/><span className={`source-tag ${item.sourceType==="manual"?"manual-source-tag":""}`}>{item.sourceType==="manual"?"AJOUT MANUEL":"SOURCE AMUNDI"}<button className="history-toggle text-button" onClick={()=>toggleEtfHistory(item)}>{historyOpenIsin===item.isin?"Masquer":"Graphique"}</button></span>{item.sourceType==="manual"&&<button className="remove-manual-button" onClick={()=>removeManualProduct(item.isin)} aria-label={"Supprimer "+item.name}>Retirer</button>}</span></div>{historyOpenIsin===item.isin&&<div className="history-chart-wrap">{historyLoadingIsin===item.isin?<div className="history-empty">Chargement de l’historique du marché…</div>:historyByIsin[item.isin]?<MarketHistoryChart title={item.name} history={historyByIsin[item.isin]}/>:null}</div>}</Fragment>)}</div>}
            {historyOpenIsin===group.isin&&<div className="history-chart-wrap">{historyLoadingIsin===group.isin?<div className="history-empty">Chargement de l’historique du marché…</div>:historyByIsin[group.isin]?<MarketHistoryChart title={group.product.name} history={historyByIsin[group.isin]}/>:null}</div>}
          </div>):filtered.map((item,i)=><Fragment key={item.isin+"-"+item.ticker+"-"+i}><div className="listing-row standalone"><span><strong>{item.name}</strong><small>{item.ticker} · {exchangeFromTicker(item.ticker)}</small></span><span className="mono">{item.isin}</span><span>{item.currency}</span><span>{item.ongoingCharges||"—"}</span><span className="nav-value">{item.nav ? `${item.nav} ${item.currency}` : "Indisponible"}</span><span className="nav-date">{item.navDate ? `VL du ${item.navDate}` : "Date non publiée"}</span><span className={`market-value ${euronextTrades[item.isin]?.status==="trade_found"?"market-value-current":""}`}>{euronextTrades[item.isin]?.status==="trade_found" ? `${euronextTrades[item.isin].price} ${euronextTrades[item.isin].currency||item.currency}` : euronextLoading?"Chargement…":"Indisponible"}<small>{euronextTrades[item.isin]?.tradeTime?new Date(euronextTrades[item.isin].tradeTime!).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"Aucun échange identifié sur 1 h"}</small></span><span className="performance-value">{[["1 an",item.performance1y],["3 ans",item.performance3y],["5 ans",item.performance5y],["10 ans",item.performance10y]].map(([label,value])=><span key={label}>{label} <strong>{value!==null&&value!==undefined?Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2})+" %":"—"}</strong></span>)}</span><span className="risk-value">{item.srri&&/^[1-7]$/.test(item.srri)?<><strong>{item.srri} / 7</strong><small>SRRI Amundi</small></>:"Indisponible"}</span><span className="source-status-cell"><CertificationLabel product={item}/><span className={`source-tag ${item.sourceType==="manual"?"manual-source-tag":""}`}>{item.sourceType==="manual"?"AJOUT MANUEL":"SOURCE AMUNDI"}</span></span>{item.sourceType==="manual"&&<button className="remove-manual-button" onClick={()=>removeManualProduct(item.isin)} aria-label={"Supprimer "+item.name}>Retirer</button>}</div>{historyOpenIsin===item.isin&&<div className="history-chart-wrap">{historyLoadingIsin===item.isin?<div className="history-empty">Chargement de l’historique du marché…</div>:historyByIsin[item.isin]?<MarketHistoryChart title={item.name} history={historyByIsin[item.isin]}/>:null}</div>}</Fragment>)}
          {filtered.length===0&&<div className="catalog-message">Aucun produit ne correspond à ces critères.</div>}
        </div>}
        {!loading&&!catalogError&&!catalog&&<div className="catalog-message">Le catalogue officiel sera chargé à l'ouverture de cette page.</div>}
        {catalog&&<div className="catalog-footnote">{euronextError&&<p className="catalog-error">{euronextError}</p>}<p>Performances historiques 1, 3, 5 et 10 ans et SRRI 1–7 : caractéristiques publiées par Amundi, indisponibles lorsqu'aucune valeur n'est fournie. Ces performances ne sont pas des rendements annuels calendaires. Transactions Euronext : {euronextLoading?"actualisation…":euronextRetrievedAt?`collectées le ${new Date(euronextRetrievedAt).toLocaleString("fr-FR")}`:"non disponibles"}. Dernier échange Euronext sur la dernière heure, avec un délai de publication maximal annoncé de 15 minutes. Horodatages source UTC ; affichage en heure de Paris. Les absences de transaction ne sont jamais remplacées par une VL. <a href="https://marketdata.euronext.com/data-reporting-service/trades-file" target="_blank" rel="noreferrer">Source Euronext et conditions</a>. <button className="text-button" onClick={()=>void loadEuronext(catalog.products)} disabled={euronextLoading}>Actualiser les échanges</button></p>Source : <a href={catalog.source} target="_blank" rel="noreferrer">outil de recherche Amundi ETF</a>. Collecte : {catalog.retrievedAt?new Date(catalog.retrievedAt).toLocaleString("fr-FR"):"non connue"}. La VL est publiée par Amundi et n'est pas le cours négocié en Bourse. Les cours temps réel ne sont pas encore connectés.</div>}
      </section>}

      {page==="assurance"&&<section className="catalog-page">
        <div className="catalog-intro"><div><span className="eyebrow">ASSURANCE-VIE · DONNÉES OUVERTES</span><h2>Comparer les contrats sur leurs chiffres publiés.</h2><p>Tous les contrats AV de la base sont affichés, même avec 0 ETF. Classement des fonds euros sur 1, 3, 5 et 8 ans ; les unités de compte restent comparables séparément.</p></div><div className="catalog-count"><ShieldCheck size={19}/><span><strong>{assuranceData?.contractCount??"—"} contrats AV</strong><small>{assuranceData?.retrievedAt?new Date(assuranceData.retrievedAt).toLocaleString("fr-FR"):"Synchronisation non effectuée"}</small></span></div></div>
        <div className="catalog-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Rechercher un contrat d'assurance-vie" placeholder="Contrat, assureur ou courtier…" value={assuranceSearch} onChange={e=>setAssuranceSearch(e.target.value)}/>{assuranceSearch&&<button className="clear-search" onClick={()=>setAssuranceSearch("")} aria-label="Effacer">×</button>}</div><button className="secondary-button" onClick={()=>void loadAssuranceVie()} disabled={assuranceLoading}><RefreshCw size={15} className={assuranceLoading?"spin":""}/> Actualiser</button></div>
        {assuranceLoading&&<div className="catalog-message"><RefreshCw className="spin" size={18}/> Chargement des fichiers publics…</div>}
        {assuranceError&&<div className="catalog-error"><CircleAlert size={18}/><span>{assuranceError}</span><button onClick={()=>void loadAssuranceVie()}>Réessayer</button></div>}
        {assuranceData?.contracts&&<><div className="catalog-summary"><div><strong>{filteredAssuranceContracts.length} contrats affichés sur {assuranceData.contractCount}</strong><span> · Tous les contrats AV de la base, même sans ETF · PER exclus</span></div><span className="data-status verified"><i/>Sources ouvertes</span></div>
          <section className="insurance-performance-panel">
            <div className="insurance-performance-heading"><div><span className="eyebrow">CLASSEMENT DES PERFORMANCES</span><h3>Fonds euros · classement par rendement</h3><p>Choisis l'horizon pour trier les contrats du meilleur au moins performant. Les quatre horizons restent visibles dans le tableau.</p></div><div className="insurance-period-switch" aria-label="Horizon de classement">{(["1","3","5","8"] as AssuranceSortPeriod[]).map(period=><button key={period} className={assuranceSortPeriod===period?"active":""} onClick={()=>setAssuranceSortPeriod(period)}>{period} an{period==="1"?"":"s"}</button>)}</div></div>
            <div className="insurance-performance-note">Rendement annualisé composé (CAGR), calculé à partir des taux annuels nets de frais de gestion du contrat et bruts de prélèvements sociaux. Dernière année publiée : {assuranceData.performanceEndYear??2025}. Les contrats sans fonds euros ou sans historique complet restent dans la liste, en bas, avec « n.c. ».</div>
            <div className="insurance-performance-table">
              <div className="insurance-performance-head"><span>RANG / CONTRAT / FONDS EUROS</span>{(["1","3","5","8"] as AssuranceSortPeriod[]).map(period=><span className={assuranceSortPeriod===period?"sorted-period":""} key={period}>{period} AN{period==="1"?"":"S"}</span>)}</div>
              {filteredAssuranceContracts.map((contract,index)=>{
                const selected=contract.euroPerformance?.[assuranceSortPeriod];
                const ranked=selected?.annualizedPct!==null && selected?.annualizedPct!==undefined;
                return <div className="insurance-performance-row" key={contract.slug}>
                  <span className="insurance-contract-cell"><b>{ranked?index+1:"—"}</b><strong>{contract.name}</strong><small>{contract.insurer??"Assureur non renseigné"}{contract.distributor?" · "+contract.distributor:""} · {contract.euroFund??"Fonds euros non référencé"}</small><small>{contract.etfCount??"n.c."} ETF · {contract.supportCount??"n.c."} supports · {contract.management??"Gestion non précisée"}</small><button className="text-button history-toggle" onClick={()=>void toggleAssuranceHistory(contract.slug)}>{assuranceHistorySlug===contract.slug?"Masquer l’historique":"Historique annuel"}</button></span>
                  {(["1","3","5","8"] as AssuranceSortPeriod[]).map(period=>{
                    const result=contract.euroPerformance?.[period];
                    return <span className={assuranceSortPeriod===period?"sorted-period":""} key={period}>{result?.annualizedPct===null||result?.annualizedPct===undefined?"n.c.":<><strong>{result.annualizedPct.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} % / an</strong><small>{result.cumulativePct===null?"":result.cumulativePct.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" % cumulés"}</small></>}</span>;
                  })}
                </div>;
              })}
              {filteredAssuranceContracts.length===0&&<div className="catalog-message">Aucun contrat ne correspond à cette recherche.</div>}
            </div>
            {assuranceHistorySlug&&(()=>{const selected=filteredAssuranceContracts.find(contract=>contract.slug===assuranceHistorySlug);return selected?<><AnnualRateChart title={selected.name+" · "+(selected.euroFund??"Fonds euros")} rates={selected.annualRates??[]} sourceUrl={selected.rateSourceUrl} checkedAt={selected.rateCheckedAt}/>{assuranceHistoryLoadingSlug===selected.slug?<div className="history-empty">Chargement des archives D1…</div>:assuranceHistoryBySlug[selected.slug]?<AssuranceSnapshotChart title={selected.name} history={assuranceHistoryBySlug[selected.slug]}/>:null}</>:null;})()}
          </section>
          <div className="catalog-summary"><strong>Frais et caractéristiques des contrats</strong><span className="muted small">Les données ETF et supports sont informatives, jamais un filtre</span></div>
          <div className="catalog-table-wrap insurance-table"><div className="insurance-table-head"><span>CONTRAT / ASSUREUR</span><span>FRAIS VERSEMENT</span><span>GESTION UC</span><span>GESTION €</span><span>ARBITRAGE</span><span>FONDS € 2025</span><span>ETF / SUPPORTS</span><span>MINIMUM</span></div>
          {filteredAssuranceContracts.map(c=><div className="insurance-row" key={c.slug}><span><strong>{c.name}</strong><small>{c.insurer??"Assureur non renseigné"}{c.distributor?" · "+c.distributor:""}</small><small>Frais vérifiés : {c.feeCheckedAt??"n.c."} · Taux vérifié : {c.rateCheckedAt??"n.c."}</small><small>{c.contractSourceUrl&&<a href={c.contractSourceUrl} target="_blank" rel="noreferrer">Source tarif</a>} {c.rateSourceUrl&&<a href={c.rateSourceUrl} target="_blank" rel="noreferrer">Source taux</a>}</small></span><span>{c.entryFeePct===null?"n.c.":c.entryFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.ucManagementFeePct===null?"n.c.":c.ucManagementFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.euroManagementFeePct===null?"n.c.":c.euroManagementFeePct.toLocaleString("fr-FR")+" %"}</span><span>{c.arbitrationFeePct===null?"n.c.":c.arbitrationFeePct.toLocaleString("fr-FR")+" %"}</span><span className="nav-value">{c.euroRate2025Pct===null?"2025 : n.c.":"2025 : "+c.euroRate2025Pct.toLocaleString("fr-FR")+" %"}<small>{c.euroRate2024Pct===null?"2024 : n.c.":"2024 : "+c.euroRate2024Pct.toLocaleString("fr-FR")+" %"} · {c.euroFund??"Fonds non précisé"}</small></span><span>{c.etfCount===null?"n.c.":c.etfCount} ETF / {c.supportCount===null?"n.c.":c.supportCount}</span><span>{c.minimumInitialEur===null?"n.c.":c.minimumInitialEur.toLocaleString("fr-FR")+" €"}</span></div>)}
          </div>
          <div className="catalog-footnote"><p>Les performances classées ici concernent exclusivement les fonds euros, pas les unités de compte ni la performance d'un mandat piloté. Les taux annuels sources sont nets des frais de gestion du contrat et bruts des prélèvements sociaux ; bonus conditionnels exclus. Les UC doivent être comparées support par support et par ISIN, avec leur propre historique.</p><p>{assuranceData.methodology} Licence : {assuranceData.sourceLicense}. Collecte InvestPilot : {new Date(assuranceData.retrievedAt??"").toLocaleString("fr-FR")}.</p><p>Sources : <a href={assuranceData.sourceUrls?.fees} target="_blank" rel="noreferrer">frais des contrats</a> · <a href={assuranceData.sourceUrls?.euroRates} target="_blank" rel="noreferrer">historique des taux fonds euros</a> · <a href="https://www.data.gouv.fr/" target="_blank" rel="noreferrer">data.gouv.fr</a>. Les dates de vérification et les sources des assureurs sont disponibles dans les jeux de données d'origine.</p></div>
        </>}
      </section>}
      {page==="portfolio"&&<section className="placeholder-page"><Wallet size={24}/><h2>Suivi du portefeuille</h2><p>Cette section sera activée avec l'import des positions et le rapprochement des ISIN.</p></section>}
      {page==="sources"&&<section className="placeholder-page"><Database size={24}/><h2>Sources & qualité des données</h2><p>Catalogue : outil de recherche officiel Amundi. Cotations temps réel : fournisseur de marché et droits de diffusion à configurer. Aucune valeur liquidative n'est assimilée à un cours boursier.</p></section>}
      <footer><span>INVESTPILOT · 2026</span><span>Les performances passées ne préjugent pas des performances futures.</span></footer>
    </section>
  </main>;
}
export default App;
