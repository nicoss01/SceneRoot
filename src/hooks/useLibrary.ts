import { useCallback, useEffect, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import type { MediaItem, MediaKind } from '../types';

export type LibraryMetadata = {
  provider: 'tmdb'|'tvmaze'|'wikipedia';
  providerId: number|string;
  title: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  genres?: string[];
  releaseDate?: string;
  runtime?: number;
  sourceUrl?: string;
};

export type LibraryGroup = {
  id: string;
  title: string;
  year?: number;
  kind: MediaKind;
  metadata?: LibraryMetadata;
  totalSize: number;
  episodeCount: number;
  versions: Array<{ id:string; technical?:Record<string, unknown> }>;
};

function quality(group:LibraryGroup):MediaItem['quality'] {
  const heights=group.versions.map(version=>Number(version.technical?.height??0));
  const height=Math.max(0,...heights);
  return height>=2000?'4K':height>=900?'1080p':'720p';
}

function duration(group:LibraryGroup) {
  if(group.kind==='serie')return group.episodeCount?`${group.episodeCount} ép.`:'Série';
  const seconds=Number(group.versions[0]?.technical?.duration??0);
  const minutes=group.metadata?.runtime??Math.round(seconds/60);
  return minutes?`${Math.floor(minutes/60)}h${String(minutes%60).padStart(2,'0')}`:'Durée inconnue';
}

function toMedia(group:LibraryGroup,index:number):MediaItem {
  const palettes:[string,string][]= [['#0e7490','#172554'],['#701a75','#1e40af'],['#065f46','#1e293b'],['#7c2d12','#581c87']];
  return {id:group.id,title:group.metadata?.title??group.title,kind:group.kind,year:group.year??new Date().getFullYear(),genres:group.metadata?.genres?.length?group.metadata.genres:['Non classé'],duration:duration(group),rating:0,quality:quality(group),description:group.metadata?.overview||'Média indexé dans votre bibliothèque SceneRoot.',palette:palettes[index%palettes.length],symbol:group.kind==='serie'?'▥':'◉',art:group.metadata?.backdrop??group.metadata?.poster,source:group.metadata?.provider??'local',sourceUrl:group.metadata?.sourceUrl,versionCount:group.versions.length,episodeCount:group.episodeCount,sizeBytes:group.totalSize,matched:Boolean(group.metadata)};
}

export function useLibrary() {
  const [groups,setGroups]=useState<LibraryGroup[]>([]);const[items,setItems]=useState<MediaItem[]>([]);const[loading,setLoading]=useState(true);const[error,setError]=useState('');
  const refresh=useCallback(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/library/grouped');if(!response.ok)throw new Error(`Bibliothèque indisponible (${response.status})`);const result=await response.json() as LibraryGroup[];const mapped=result.map(toMedia);setGroups(result);setItems(mapped);rememberCatalogItems(mapped)}catch(cause){setError((cause as Error).message)}finally{setLoading(false)}},[]);
  useEffect(()=>{void refresh()},[refresh]);
  return{groups,items,loading,error,refresh};
}
