import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";

export default function CreatorSearch({ api, assetSrc, onOpen }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) {
      setResults([]); setLoading(false); setFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    const timer = window.setTimeout(() => {
      fetch(`${api}/discover/creators?search=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject(new Error()))
        .then(data => setResults(Array.isArray(data) ? data : []))
        .catch(error => { if (error.name !== "AbortError") { setResults([]); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [api, term]);
  return <section className="creator-search" aria-label="Search creators">
    <div className="gallery-search creator-search-box"><Search size={17}/><input type="search" aria-label="Search content creators" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search content creators"/>{query && <button type="button" aria-label="Clear creator search" onClick={() => setQuery("")}><X size={16}/></button>}</div>
    {term.length >= 2 && <div className="creator-search-results" aria-live="polite">
      {loading ? <p className="muted">Searching creators…</p>
        : failed ? <p className="muted">Couldn't search creators. Try again.</p>
        : results.length === 0 ? <p className="muted">No creators match "{term}".</p>
        : results.map(creator => <button type="button" className="creator-search-result" key={creator.id} onClick={() => onOpen(creator)}>
          {creator.profilePhotoUrl ? <img src={assetSrc(creator.profilePhotoUrl)} alt=""/> : <span className="popular-avatar"><UserRound size={18}/></span>}
          <span><strong>{creator.displayName || creator.username}</strong><small>@{creator.username}{Number.isFinite(creator.followerCount) ? ` · ${Number(creator.followerCount).toLocaleString()} followers` : ""}</small></span>
        </button>)}
    </div>}
  </section>;
}
