import Link from "next/link";
import { DigitalCard } from "@/components/cards/DigitalCard";
import { CARDS } from "@/lib/cards";

export default function CardsPage() {
  return (
    <main className="page galleryPage">
      <div className="galleryShell">
        <Link className="topLink" href="/">← トップへ</Link>
        <div className="galleryHeader">
          <div>
            <div className="small">Ver.0.4 DIGITAL CARD SYSTEM</div>
            <h1 className="testTitle">デジタルカード一覧</h1>
            <p className="hint">カード定義＋共通テンプレートで描画します。標準のベクターイラストに加え、PNG / WebP / JPG / SVG画像へカード単位で差し替えできます。</p>
          </div>
          <Link className="button compact galleryTestLink" href="/test">PCテストへ</Link>
        </div>
        <div className="galleryGrid">
          {CARDS.map((card) => (
            <div className="galleryCardWrap" key={card.id}>
              <DigitalCard card={card} />
              <div className="galleryCardId">{card.id}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
