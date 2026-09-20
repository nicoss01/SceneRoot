import { Check, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LibraryGroup, LibraryMetadata } from '../hooks/useLibrary';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { artworkUrl, placeholderFor } from '../lib/image';
import { useModalFocus } from '../hooks/useModalFocus';

export function MetadataMatcher({group,onClose,onMatched}:{group:LibraryGroup;onClose:()=>void;onMatched:()=>void}) {
  useEscapeClose(onClose);
  const modalRef=useModalFocus<HTMLDivElement>();
  const[query,setQuery]=useState(group.title);const[candidates,setCandidates]=useState<LibraryMetadata[]>([]);const[loading,setLoading]=useState(false);const[saving,setSaving]=useState<number|string|null>(null);const[error,setError]=useState('');
  const search=async()=>{setLoading(true);setError('');try{const params=new URLSearchParams({q:query,kind:group.kind});if(group.year)params.set('year',String(group.year));const response=await fetch(`/api/metadata/search?${params}`);if(!response.ok)throw new Error('Recherche indisponible');setCandidates(await response.json() as LibraryMetadata[])}catch(cause){setError((cause as Error).message)}finally{setLoading(false)}};
  useEffect(()=>{void search()},[]);
  const choose=async(candidate:LibraryMetadata)=>{setSaving(candidate.providerId);setError('');try{const response=await fetch(`/api/library/${group.id}/match`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:candidate.provider,providerId:candidate.providerId})});if(!response.ok)throw new Error('Impossible d’enregistrer cette correspondance');await onMatched();onClose()}catch(cause){setError((cause as Error).message)}finally{setSaving(null)}};
  return <div className="modal-backdrop"><div className="match-modal" role="dialog" aria-modal="true" ref={modalRef}><button className="modal-close" onClick={onClose}><X/></button><h2>Identifier ce média</h2><p><strong>{group.title}</strong>{group.year?` · ${group.year}`:''}</p><form onSubmit={event=>{event.preventDefault();void search()}}><Search/><input value={query} onChange={event=>setQuery(event.target.value)} autoFocus/><button className="primary" disabled={loading}>{loading?'Recherche…':'Rechercher'}</button></form>{error&&<div className="match-error">{error}</div>}<div className="candidate-list">{candidates.map(candidate=><button className="candidate" key={`${candidate.provider}-${candidate.providerId}`} onClick={()=>void choose(candidate)} disabled={saving!==null}><img src={artworkUrl(candidate.poster,group.kind)} alt="" loading="lazy" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=placeholderFor(group.kind)}}/><span><strong>{candidate.title}</strong><small>{candidate.releaseDate?.slice(0,4)||'Année inconnue'} · {candidate.provider}</small><p>{candidate.overview||'Aucun résumé disponible.'}</p></span>{saving===candidate.providerId?<i className="candidate-spinner"/>:<Check/>}</button>)}</div>{!loading&&!candidates.length&&!error&&<div className="empty-candidates">Aucune correspondance trouvée. Modifiez le titre puis relancez la recherche.</div>}</div></div>;
}
