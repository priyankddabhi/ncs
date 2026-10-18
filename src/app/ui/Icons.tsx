/** Small inline SVG icons (hand-written, 1.75 px strokes, currentColor). Decorative: hidden from screen readers. */
import type { ReactNode } from "react";

function Svg({ size = 20, weight = 1.75, children, className }: { size?: number; weight?: number; children: ReactNode; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}
    >
      {children}
    </svg>
  );
}

/** The logo mark: a rising line in a rounded square. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" />
      <path d="M6.5 15.5l3.5-3.5 2.75 2.25L17.5 9" />
      <path d="M14.25 9h3.25v3.25" />
    </Svg>
  );
}

export const MenuIcon = () => <Svg><path d="M4 7h16M4 12h16M4 17h10" /></Svg>;

export const BellIcon = () => (
  <Svg>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const CloseIcon = ({ size = 20 }: { size?: number }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>;

export const RefreshIcon = ({ className }: { className?: string }) => (
  <Svg size={18} className={className}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);

export const ChevronIcon = ({ className }: { className?: string }) => (
  <Svg size={16} className={className}><path d="M6 9l6 6 6-6" /></Svg>
);

export const PlusIcon = ({ className }: { className?: string }) => (
  <Svg size={16} className={className}><path d="M12 5v14" className="plusV" /><path d="M5 12h14" /></Svg>
);

export const WarnIcon = () => (
  <Svg size={16}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
);

/** Trend arrow: up, down or sideways. */
export function TrendArrow({ trend }: { trend: string }) {
  const d = trend === "UP" ? "M12 18V6M7 11l5-5 5 5" : trend === "DOWN" ? "M12 6v12M7 13l5 5 5-5" : "M6 12h12M13 7l5 5-5 5";
  return <Svg size={13} weight={2.5}><path d={d} /></Svg>;
}
