import type { MediaItem, Profile } from '../types';

export const profiles: Profile[] = [
  { id: 'nicolas', name: 'Nicolas', ageLimit: 18, avatar: '/assets/avatars/geek.png', accent: '#22d3ee' },
  { id: 'cathy', name: 'Cathy', ageLimit: 10, avatar: '/assets/avatars/amour.png', accent: '#f472b6' },
  { id: 'nathan', name: 'Nathan', ageLimit: 13, avatar: '/assets/avatars/game.png', accent: '#60a5fa' },
  { id: 'lucie', name: 'Lucie', ageLimit: 18, avatar: '/assets/avatars/fun.png', accent: '#38bdf8' }
];

export const media: MediaItem[] = [
  { id:'atlas', title:"L’Aube d’Atlas", kind:'film', year:2024, genres:['Science-fiction','Aventure'], duration:'1h42', rating:8.7, progress:38, quality:'4K', description:"Quand l’humanité découvre un signal venu d’un autre monde, une équipe part explorer l’inconnu.", palette:['#0e7490','#172554'], symbol:'◐', art:'/assets/atlas.png' },
  { id:'orbite', title:'Orbite', kind:'serie', year:2025, genres:['Science-fiction','Drame'], duration:'S1 · E3', rating:8.1, progress:17, quality:'4K', description:'Une station isolée reçoit un message impossible.', palette:['#334155','#155e75'], symbol:'◉', art:'/assets/orbite.png' },
  { id:'silences', title:'Les Silences', kind:'film', year:2024, genres:['Thriller'], duration:'1h56', rating:7.8, progress:51, quality:'1080p', description:'Au fond des bois, une maison garde trop de secrets.', palette:['#1e293b','#064e3b'], symbol:'⌂', art:'/assets/silences.png' },
  { id:'milo', title:'Milo et la Lumière', kind:'film', year:2025, genres:['Animation','Famille'], duration:'1h28', rating:8.9, progress:72, quality:'1080p', description:'Un petit chat poursuit une lumière à travers la nuit.', palette:['#7c2d12','#581c87'], symbol:'✦', art:'/assets/milo.png' },
  { id:'terres', title:'Les Terres Oubliées', kind:'film', year:2025, genres:['Aventure'], duration:'2h04', rating:8.2, quality:'4K', description:'Une expédition au-delà des cartes connues.', palette:['#475569','#0f766e'], symbol:'△', art:'/assets/atlas.png' },
  { id:'neon', title:'Neon Harbor', kind:'serie', year:2025, genres:['Thriller','Science-fiction'], duration:'8 ép.', rating:7.9, quality:'1080p', description:'La ville dort. Le port, jamais.', palette:['#701a75','#1e40af'], symbol:'▥', art:'/assets/orbite.png' },
  { id:'fragments', title:'Fragment(s)', kind:'film', year:2024, genres:['Drame'], duration:'1h48', rating:8.4, quality:'1080p', description:'Cinq souvenirs, une seule vérité.', palette:['#1f2937','#52525b'], symbol:'◇', art:'/assets/orbite.png' },
  { id:'echoes', title:'Échos', kind:'serie', year:2025, genres:['Horreur','Mystère'], duration:'6 ép.', rating:7.6, quality:'4K', description:'Chaque nuit, la forêt répond.', palette:['#052e16','#1e293b'], symbol:'≋', art:'/assets/silences.png' },
  { id:'rivage', title:'Le Dernier Rivage', kind:'film', year:2025, genres:['Science-fiction'], duration:'1h51', rating:8.5, quality:'4K', description:'Au bord du monde, le ciel recommence.', palette:['#1e3a8a','#0e7490'], symbol:'◒', art:'/assets/atlas.png' },
  { id:'zero', title:'Planète Zéro', kind:'serie', year:2024, genres:['Science-fiction'], duration:'6 ép.', rating:8.4, quality:'4K', description:'Une planète neuve. Un ancien danger.', palette:['#0f172a','#1d4ed8'], symbol:'◉', art:'/assets/atlas.png' },
  { id:'lignes', title:'Lignes de Vie', kind:'film', year:2023, genres:['Drame'], duration:'1h39', rating:7.7, quality:'1080p', description:'Des destins se croisent sur une route sans fin.', palette:['#78350f','#334155'], symbol:'〰', art:'/assets/silences.png' },
  { id:'saison', title:'Saison Noire', kind:'serie', year:2024, genres:['Horreur'], duration:'10 ép.', rating:7.5, quality:'1080p', description:'Cet hiver durera plus longtemps que prévu.', palette:['#111827','#064e3b'], symbol:'♠', art:'/assets/silences.png' }
];
