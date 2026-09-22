import type { CSSProperties } from "react";
import type { CardDef } from "@/lib/cards";
import { RoleIllustration } from "./RoleIllustration";

type Props = {
  card: CardDef;
  compact?: boolean;
  className?: string;
};

export function DigitalCard({ card, compact = false, className = "" }: Props) {
  const style = {
    "--card-accent": card.accent,
    "--card-accent-2": card.accent2,
  } as CSSProperties;

  return (
    <div className={`digitalCard ${compact ? "compact" : ""} ${className}`} style={style}>
      <div className="digitalCardGlow" />
      <div className="digitalCardTop">
        <div className="digitalCardSymbol">{card.symbol}</div>
        <div className="digitalCardTitle">{card.name}</div>
      </div>
      <div className="digitalCardArt">
        <div className="digitalCardArtHalo" />
        <RoleIllustration type={card.type} />
      </div>
      <div className="digitalCardRule">{card.ruleText}</div>
      <div className="digitalCardFooter">
        <span>FAMILY EDITION</span>
        <span>{card.name}</span>
      </div>
    </div>
  );
}

export function DigitalCardBack({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`digitalCard cardBackDigital ${compact ? "compact" : ""}`}>
      <div className="backPattern" />
      <div className="backMark">?</div>
      <div className="backTitle">WHO?</div>
    </div>
  );
}
