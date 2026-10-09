export type Tier = 'high' | 'low';

export interface Quality {
  tier: Tier;
  touch: boolean;
  pixelRatio: number;
  maxPixelRatio: number;
  reflectionScale: number;
  dof: boolean;
  rays: boolean;          // volumetric light shafts
  shadows: number; // shadow map size, 0 = off
  trees: number;
  dust: number;
  rubble: number;
}

export function detectQuality(): Quality {
  const params = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
  const forced = params.get('q');
  const tier: Tier = forced === 'high' || forced === 'low' ? forced : touch ? 'low' : 'high';
  const dpr = window.devicePixelRatio || 1;

  if (tier === 'high') {
    return {
      tier, touch,
      // Starts at 1.5 (the post chain is costly per pixel); the adaptive resolution (main.ts) climbs
      // to maxPixelRatio when there is room.
      pixelRatio: Math.min(dpr, 1.5),
      maxPixelRatio: Math.min(dpr, 2),
      reflectionScale: 0.5,
      dof: true,
      rays: true,
      shadows: 2048,
      trees: 62,
      dust: 1400,
      rubble: 460,
    };
  }
  return {
    tier, touch,
    pixelRatio: Math.min(dpr, 1.25),
    maxPixelRatio: Math.min(dpr, 1.5),
    reflectionScale: 0.25,
    dof: false,
    rays: false,
    shadows: 1024,
    trees: 36,
    dust: 500,
    rubble: 220,
  };
}
