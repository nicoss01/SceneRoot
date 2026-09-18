import type { Profile } from '../types';

export function ProfileAvatar({profile,className=''}:{profile:Pick<Profile,'name'|'avatar'|'accent'>;className?:string}) {
  const isImage=profile.avatar.startsWith('/assets/avatars/');
  return <span className={`profile-avatar ${className}`} style={{'--accent':profile.accent} as React.CSSProperties}>{isImage?<img src={profile.avatar} alt={`Avatar de ${profile.name}`} decoding="async"/>:<b>{profile.avatar||profile.name[0]?.toUpperCase()}</b>}</span>;
}
