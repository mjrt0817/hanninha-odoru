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

  const illustration = card.illustration;

  return (
    <div className={`digitalCard ${compact ? "compact" : ""} ${className}`} style={style}>
      <div className="digitalCardGlow" />
      <div className="digitalCardTop">
        <div className="digitalCardSymbol">{card.symbol}</div>
        <div className="digitalCardTitle">{card.name}</div>
      </div>
      <div className="digitalCardArt">
        <div className="digitalCardArtHalo" />
        {illustration.kind === "image" ? (
          // public/ 配下の画像は /card-art/xxx.webp のようなURLで指定できます。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="cardArtImage"
            src={illustration.src}
            alt={illustration.alt ?? `${card.name}のイラスト`}
            style={{ objectFit: illustration.fit ?? "contain", objectPosition: illustration.position ?? "center" }}
          />
        ) : (
          <RoleIllustration type={illustration.key ?? card.type} />
        )}
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
