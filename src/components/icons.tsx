import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const PlayIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a.6.6 0 0 0 .92.5l10.3-6.5a.6.6 0 0 0 0-1L8.92 5a.6.6 0 0 0-.92.5Z" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

export const NextIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M6 5.8v12.4a.6.6 0 0 0 .93.5l8.6-6.2a.6.6 0 0 0 0-.98L6.93 5.3a.6.6 0 0 0-.93.5Z" />
    <rect x="17" y="5" width="2.2" height="14" rx="1.1" />
  </svg>
);

export const PrevIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M18 5.8v12.4a.6.6 0 0 1-.93.5l-8.6-6.2a.6.6 0 0 1 0-.98l8.6-6.22a.6.6 0 0 1 .93.5Z" />
    <rect x="4.8" y="5" width="2.2" height="14" rx="1.1" />
  </svg>
);

export const ShuffleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </svg>
);

export const RepeatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

export const RepeatOneIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v5" />
  </svg>
);

export const VolumeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const MuteIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m16 9 5 5" />
    <path d="m21 9-5 5" />
  </svg>
);

export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20.3 4.7 13a4.7 4.7 0 1 1 6.6-6.6l.7.7.7-.7a4.7 4.7 0 1 1 6.6 6.6Z" />
  </svg>
);

export const WaveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12h2" />
    <path d="M7 8v8" />
    <path d="M12 4v16" />
    <path d="M17 7v10" />
    <path d="M22 10v4" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const KeyboardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const LibraryIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4v16" />
    <path d="M10 4v16" />
    <path d="m14 5 4.5 15" />
  </svg>
);

export const SlidersIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </svg>
);

export const DiceIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

