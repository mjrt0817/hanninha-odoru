import type { CardType } from "@/lib/cards";

export function RoleIllustration({ type }: { type: CardType }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg className="roleIllustration" viewBox="0 0 160 120" aria-hidden="true">
      {type === "culprit" && <>
        <path {...common} d="M38 86c8-28 22-42 42-42s34 14 42 42" />
        <path {...common} d="M56 48c7-20 41-20 48 0" />
        <path {...common} d="M48 51h64" />
        <path {...common} d="M59 66c12-9 30-9 42 0-1 13-9 23-21 23S60 79 59 66Z" />
        <path {...common} d="M68 68h3M89 68h3" />
      </>}
      {type === "first-discoverer" && <>
        <path {...common} d="M80 18v20M80 82v20M22 60h20M118 60h20M39 19l14 14M107 87l14 14M121 19l-14 14M53 87l-14 14" />
        <path {...common} d="M80 42c-12 0-22 9-22 20 0 8 5 14 12 18h20c7-4 12-10 12-18 0-11-10-20-22-20Z" />
        <path {...common} d="M72 89h16M74 98h12" />
      </>}
      {type === "dog" && <>
        <path {...common} d="M53 43 35 29l3 31M107 43l18-14-3 31" />
        <path {...common} d="M45 57c0-22 16-36 35-36s35 14 35 36v15c0 20-14 33-35 33S45 92 45 72Z" />
        <path {...common} d="M66 58h2M92 58h2" />
        <path {...common} d="M73 72c4-5 10-5 14 0-1 7-5 11-7 11s-6-4-7-11Z" />
        <path {...common} d="M67 89c8 5 18 5 26 0" />
      </>}
      {type === "boy" && <>
        <circle {...common} cx="80" cy="59" r="31" />
        <path {...common} d="M49 49c9-24 50-32 65-6-11-2-20-9-26-18-8 10-20 18-39 24Z" />
        <path {...common} d="M68 61h2M90 61h2M70 78c7 5 13 5 20 0" />
        <path {...common} d="M58 103c5-13 16-19 22-19s17 6 22 19" />
      </>}
      {type === "rumor" && <>
        <path {...common} d="M26 35h63c9 0 16 7 16 16v13c0 9-7 16-16 16H57L40 96V80H26c-9 0-16-7-16-16V51c0-9 7-16 16-16Z" />
        <path {...common} d="M78 52h56c9 0 16 7 16 16v8c0 9-7 16-16 16h-12v14l-15-14H78" />
        <path {...common} d="M35 57h4M52 57h4M69 57h4M100 72h4M117 72h4" />
      </>}
      {type === "alibi" && <>
        <rect {...common} x="28" y="25" width="104" height="70" rx="12" />
        <circle {...common} cx="58" cy="56" r="13" />
        <path {...common} d="M40 82c3-10 10-15 18-15s15 5 18 15M88 46h26M88 60h26M88 74h18" />
        <circle {...common} cx="116" cy="92" r="18" />
        <path {...common} d="m107 92 6 6 12-14" />
      </>}
      {type === "detective" && <>
        <circle {...common} cx="68" cy="52" r="27" />
        <path {...common} d="m88 72 31 31" />
        <path {...common} d="M49 41c7-18 31-22 44-9" />
        <path {...common} d="M102 28c8 4 13 12 14 22" />
        <path {...common} d="M60 52h2M76 52h2M63 66c5 3 10 3 15 0" />
      </>}
      {type === "scheme" && <>
        <path {...common} d="M47 99h66M55 88h50" />
        <path {...common} d="M64 88c4-19 1-31-8-43l15-9 9 12 9-12 15 9c-9 12-12 24-8 43" />
        <circle {...common} cx="80" cy="24" r="8" />
        <path {...common} d="M31 54c10-12 20-18 29-18M129 54c-10-12-20-18-29-18" />
      </>}
      {type === "civilian" && <>
        <circle {...common} cx="80" cy="43" r="22" />
        <path {...common} d="M43 101c3-24 18-36 37-36s34 12 37 36" />
        <path {...common} d="M61 44h2M97 44h2M70 56c7 4 13 4 20 0" />
        <path {...common} d="M25 101h110" />
      </>}
      {type === "witness" && <>
        <path {...common} d="M19 60c17-24 37-35 61-35s44 11 61 35c-17 24-37 35-61 35S36 84 19 60Z" />
        <circle {...common} cx="80" cy="60" r="20" />
        <circle {...common} cx="80" cy="60" r="7" />
        <path {...common} d="M127 24l13-11M133 37l18-2M33 24 20-11M27 37 9 35" />
      </>}
      {type === "info" && <>
        <circle {...common} cx="80" cy="60" r="14" />
        <circle {...common} cx="35" cy="34" r="10" />
        <circle {...common} cx="125" cy="34" r="10" />
        <circle {...common} cx="35" cy="91" r="10" />
        <circle {...common} cx="125" cy="91" r="10" />
        <path {...common} d="M45 39 66 52M115 39 94 52M45 85 66 68M115 85 94 68" />
        <path {...common} d="M73 21c20-3 35 3 45 16M118 19v18h-18M87 100c-20 3-35-3-45-16M42 101V83h18" />
      </>}
      {type === "trade" && <>
        <path {...common} d="M26 51h75M90 39l13 12-13 12M134 78H59M70 66 57 78l13 12" />
        <rect {...common} x="21" y="31" width="32" height="42" rx="6" />
        <rect {...common} x="107" y="57" width="32" height="42" rx="6" />
      </>}
    </svg>
  );
}
