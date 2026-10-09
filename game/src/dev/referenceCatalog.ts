/** Originals stay outside public/: references are served only by the local dev server. */
export const REFERENCES = {
  front: { label: 'Front · proportions', file: 'model-reference/ChatGPT Image Sep 22, 2026, 05_53_17 PM (1).png', view: 'front' },
  artwork: { label: 'Key artwork · materials', file: 'ChatGPT Image Sep 22, 2026, 01_37_40 PM.png', view: 'three-quarter' },
  prologue: { label: 'Part I · visual continuity', file: 'ChatGPT Image Sep 19, 2026, 07_21_48 PM.png', view: 'portrait' },
  gate: { label: 'Part II · performance', file: 'ChatGPT Image Sep 22, 2026, 02_29_34 PM (1).png', view: 'side' },
} as const;
