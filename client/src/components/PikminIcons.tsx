import type { PikminCategory } from '../types';

export function DrakeEmblemIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="15" stroke="#53d8e2" strokeWidth="1.8" strokeOpacity="0.55" />
      <path
        d="M18 6C21.8 10.6 24 15.3 24 20.4C24 23.8 21.3 26.5 18 26.5C14.7 26.5 12 23.8 12 20.4C12 15.3 14.2 10.6 18 6Z"
        fill="url(#drakeHull)"
      />
      <circle cx="18" cy="17.5" r="3.4" fill="#06212e" stroke="#ffd479" strokeWidth="1.5" />
      <path d="M12.5 22L8.5 26.5L13.5 25.4" fill="#f7b34d" />
      <path d="M23.5 22L27.5 26.5L22.5 25.4" fill="#f7b34d" />
      <path d="M15.8 27.2L18 31.5L20.2 27.2" fill="#7ce063" />
      <defs>
        <linearGradient id="drakeHull" x1="18" y1="6" x2="18" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e8fcff" />
          <stop offset="1" stopColor="#53d8e2" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function PikminSproutIcon({
  category,
  size = 28,
}: {
  category: PikminCategory;
  size?: number;
}) {
  if (category === 'dining') {
    // Red Pikmin (pointed nose + leaf)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 14C18 9 19 6 24 5" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="25.5" cy="5.5" rx="4.5" ry="2.4" transform="rotate(-18 25.5 5.5)" fill="#7ce063" />
        <ellipse cx="18" cy="22.5" rx="7.2" ry="8.5" fill="#ef5350" />
        <path d="M24.2 21.2L29.5 22.8L24.2 24.4Z" fill="#ef5350" />
        <circle cx="15.5" cy="20.2" r="2.1" fill="#fff" />
        <circle cx="20.4" cy="20.2" r="2.1" fill="#fff" />
        <circle cx="15.8" cy="20.3" r="1" fill="#101820" />
        <circle cx="20.7" cy="20.3" r="1" fill="#101820" />
      </svg>
    );
  }
  if (category === 'shopping') {
    // Yellow Pikmin (big ears + glowing bud)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 14C18 9.5 17 7 14 5.5" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="13" cy="5.5" r="3" fill="#fff3b0" />
        <path d="M11 20L5.5 16.5L9.5 23.5Z" fill="#facc15" />
        <path d="M25 20L30.5 16.5L26.5 23.5Z" fill="#facc15" />
        <ellipse cx="18" cy="22.5" rx="7.2" ry="8.4" fill="#facc15" />
        <circle cx="15.4" cy="20.5" r="2.1" fill="#fff" />
        <circle cx="20.6" cy="20.5" r="2.1" fill="#fff" />
        <circle cx="15.5" cy="20.6" r="1" fill="#101820" />
        <circle cx="20.7" cy="20.6" r="1" fill="#101820" />
      </svg>
    );
  }
  if (category === 'groceries') {
    // Blue Pikmin (cheerful gill smile + white flower)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 14V7.5" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="18" cy="5.5" r="2.2" fill="#facc15" />
        <circle cx="15" cy="5.5" r="1.8" fill="#ffffff" />
        <circle cx="21" cy="5.5" r="1.8" fill="#ffffff" />
        <circle cx="18" cy="2.8" r="1.8" fill="#ffffff" />
        <circle cx="18" cy="8.2" r="1.8" fill="#ffffff" />
        <ellipse cx="18" cy="23" rx="7.5" ry="8.2" fill="#38bdf8" />
        <circle cx="15.3" cy="20.5" r="2.1" fill="#fff" />
        <circle cx="20.7" cy="20.5" r="2.1" fill="#fff" />
        <circle cx="15.4" cy="20.6" r="1" fill="#101820" />
        <circle cx="20.8" cy="20.6" r="1" fill="#101820" />
        <path d="M16 25.2C17 26.6 19 26.6 20 25.2" stroke="#083344" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (category === 'bills') {
    // Rock Pikmin (faceted obsidian crystal body)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 13C18 9 20 6.8 23.5 6" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="25" cy="6.2" rx="4" ry="2.2" transform="rotate(-15 25 6.2)" fill="#7ce063" />
        <polygon points="18,12.5 27,17 25.5,27.5 18,31 10.5,27.5 9,17" fill="#64748b" />
        <polygon points="18,12.5 27,17 21.5,21 14,19" fill="#94a3b8" fillOpacity="0.55" />
        <circle cx="15.2" cy="21" r="2.1" fill="#fff" />
        <circle cx="20.8" cy="21" r="2.1" fill="#fff" />
        <circle cx="15.4" cy="21" r="1" fill="#0f172a" />
        <circle cx="20.9" cy="21" r="1" fill="#0f172a" />
      </svg>
    );
  }
  // Winged Pikmin (pink + translucent wings)
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="18.5" rx="6" ry="3.2" transform="rotate(-24 10 18.5)" fill="#bae6fd" fillOpacity="0.72" />
      <ellipse cx="26" cy="18.5" rx="6" ry="3.2" transform="rotate(24 26 18.5)" fill="#bae6fd" fillOpacity="0.72" />
      <path d="M18 14.5V8" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="18" cy="6.2" r="2.8" fill="#fbcfe8" />
      <circle cx="18" cy="22.8" r="7.4" fill="#f472b6" />
      <circle cx="15.3" cy="21.5" r="2.4" fill="#38bdf8" />
      <circle cx="20.7" cy="21.5" r="2.4" fill="#38bdf8" />
      <circle cx="14.7" cy="20.7" r="0.9" fill="#fff" />
      <circle cx="20.1" cy="20.7" r="0.9" fill="#fff" />
    </svg>
  );
}

export function FruitSpecimenIcon({
  category,
  size = 28,
}: {
  category: PikminCategory;
  size?: number;
}) {
  if (category === 'dining') {
    // Sunseed Berry (Strawberry)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 8C23 8 27 12.2 26.2 18.5C25.4 24.4 21.4 30 18 30C14.6 30 10.6 24.4 9.8 18.5C9 12.2 13 8 18 8Z" fill="#ef5350" />
        <path d="M13 10.5L18 6.5L23 10.5L19.8 11.8L18 9.8L16.2 11.8Z" fill="#7ce063" />
        <circle cx="15" cy="17" r="1.1" fill="#ffe599" />
        <circle cx="21" cy="17" r="1.1" fill="#ffe599" />
        <circle cx="18" cy="21.5" r="1.1" fill="#ffe599" />
        <circle cx="15.2" cy="24.5" r="1" fill="#ffe599" />
        <circle cx="20.8" cy="24.5" r="1" fill="#ffe599" />
      </svg>
    );
  }
  if (category === 'shopping') {
    // Citrus Lump (Golden Orange/Lemon)
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <circle cx="18" cy="20" r="10.5" fill="#facc15" />
        <circle cx="18" cy="20" r="7.8" fill="#fef08a" fillOpacity="0.4" />
        <path d="M18 9.5C18.5 6.5 21.2 5 24 5.5" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="23.5" cy="8.2" rx="4" ry="2" transform="rotate(-18 23.5 8.2)" fill="#7ce063" />
        <path d="M13.5 16.5C14.5 14.5 16.2 13.8 18 13.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.65" />
      </svg>
    );
  }
  if (category === 'groceries') {
    // Dewdrop Melon / Berry Cluster
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 10V6" stroke="#7ce063" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="14.2" cy="17.5" r="5.5" fill="#38bdf8" />
        <circle cx="21.8" cy="17.5" r="5.5" fill="#0ea5e9" />
        <circle cx="18" cy="23.5" r="5.8" fill="#7dd3fc" />
        <circle cx="12.5" cy="15.5" r="1.4" fill="#fff" fillOpacity="0.65" />
        <circle cx="16.4" cy="21.5" r="1.5" fill="#fff" fillOpacity="0.65" />
      </svg>
    );
  }
  if (category === 'bills') {
    // Rocket Fuel / Mineral Orb
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <polygon points="18,6 28,12 28,24 18,30 8,24 8,12" fill="#64748b" stroke="#cbd5e1" strokeWidth="1.5" />
        <polygon points="18,10.5 23.5,14 23.5,22 18,25.5 12.5,22 12.5,14" fill="#53d8e2" fillOpacity="0.45" />
        <circle cx="18" cy="18" r="3" fill="#e2e8f0" />
      </svg>
    );
  }
  // Blossom Peach (Leisure)
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 11C13 9 8.5 13 9 19C9.6 25.5 15 29.8 18 30.5C21 29.8 26.4 25.5 27 19C27.5 13 23 9 18 11Z" fill="#f472b6" />
      <path d="M18 11.5C18 18 18 24 18 30" stroke="#fbcfe8" strokeWidth="1.5" strokeOpacity="0.55" />
      <ellipse cx="22.5" cy="8.5" rx="4.2" ry="2.2" transform="rotate(-24 22.5 8.5)" fill="#7ce063" />
    </svg>
  );
}

export function CaptainPortrait({ captain }: { captain: 'alph' | 'brittany' | 'charlie' }) {
  const palette =
    captain === 'brittany'
      ? { suit: '#f472b6', antenna: '#f9a8d4', hair: '#fb7185', visor: '#38bdf8' }
      : captain === 'charlie'
        ? { suit: '#4ade80', antenna: '#86efac', hair: '#f59e0b', visor: '#53d8e2' }
        : { suit: '#38bdf8', antenna: '#7dd3fc', hair: '#3b82f6', visor: '#53d8e2' };

  return (
    <svg width="46" height="46" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* Koppai Space Helmet */}
      <line x1="24" y1="7" x2="24" y2="2" stroke={palette.antenna} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="24" cy="2.5" r="2.2" fill={palette.antenna} />
      <circle cx="24" cy="23" r="15.5" fill="rgba(220, 250, 255, 0.14)" stroke={palette.visor} strokeWidth="2" />
      {/* Suit Collar */}
      <path d="M11 41C13.5 34.5 18 32 24 32C30 32 34.5 34.5 37 41" fill={palette.suit} />
      {/* Face */}
      <circle cx="24" cy="24" r="9.8" fill="#ffe1c4" />
      {/* Hair / Cap accent */}
      {captain === 'brittany' ? (
        <path d="M14.2 22C15 15.2 20 13 24 13C28 13 33 15.2 33.8 22C31 18.8 27.5 18 24 18C20.5 18 17 18.8 14.2 22Z" fill={palette.hair} />
      ) : captain === 'charlie' ? (
        <>
          <path d="M15 21C16 15.5 20 14 24 14C28 14 32 15.5 33 21" fill="#52525b" />
          <path d="M19 28.5C21 27 27 27 29 28.5" stroke="#92400e" strokeWidth="2.4" strokeLinecap="round" />
        </>
      ) : (
        <path d="M14.8 21.5C15.5 15 20.5 13 25 13.5C29.5 14 33 17 33.2 21.5C29.5 18.2 20.5 18.2 14.8 21.5Z" fill={palette.hair} />
      )}
      {/* Eyes */}
      <circle cx="20.4" cy="23.5" r="1.5" fill="#10212b" />
      <circle cx="27.6" cy="23.5" r="1.5" fill="#10212b" />
      {/* Smile */}
      <path d="M21.2 27.5C22.4 29 25.6 29 26.8 27.5" stroke="#9a4b38" strokeWidth="1.5" strokeLinecap="round" />
      {/* Helmet Glare */}
      <path d="M13 17C14.5 13.5 17.5 11.2 21 10.6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.45" />
    </svg>
  );
}
