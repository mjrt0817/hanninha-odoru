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
            <div className="small">Ver.0.3 DIGITAL CARD SYSTEM</div>
            <h1 className="testTitle">デジタルカード一覧</h1>
            <p className="hint">写真画像を使わず、カード定義＋共通テンプレート＋ベクターイラストで描画しています。新しいカードもデータ追加で増やせます。</p>
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
