export const avatarChoices = [
  { id:'geek', label:'Geek', src:'/assets/avatars/geek.png', accent:'#22d3ee' },
  { id:'fun', label:'Fun', src:'/assets/avatars/fun.png', accent:'#38bdf8' },
  { id:'space', label:'Espace', src:'/assets/avatars/space.png', accent:'#60a5fa' },
  { id:'pop', label:'Pop', src:'/assets/avatars/pop.png', accent:'#fbbf24' },
  { id:'colere', label:'Colère', src:'/assets/avatars/colere.png', accent:'#fb7185' },
  { id:'amour', label:'Amour', src:'/assets/avatars/amour.png', accent:'#f472b6' },
  { id:'triste', label:'Triste', src:'/assets/avatars/triste.png', accent:'#818cf8' },
  { id:'reflechi', label:'Réfléchi', src:'/assets/avatars/reflechi.png', accent:'#a78bfa' },
  { id:'trouve', label:'Eurêka', src:'/assets/avatars/trouve.png', accent:'#facc15' },
  { id:'game', label:'Gaming', src:'/assets/avatars/game.png', accent:'#0ea5e9' }
] as const;

export function accentForAvatar(src:string) {
  return avatarChoices.find(choice=>choice.src===src)?.accent??'#22d3ee';
}
