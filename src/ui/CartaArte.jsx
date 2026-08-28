// Frente de carta POR CAPAS: fondo WebP (base+patrón+barra+figura) + título/flavor
// como texto vivo (SVG). Ver src/ui/cardLayout.js para la geometría.
import { useEffect, useMemo, useState } from "react";
import { cardArtSVG, cardFontsReady, poseFor, bgUrl, reversoUrl } from "./cardLayout";

let FONTS_READY = false;
cardFontsReady.then(() => { FONTS_READY = true; });

export default function CartaArte({ color, texto, flavor, anon }) {
  const [ready, setReady] = useState(FONTS_READY);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    cardFontsReady.then(() => alive && setReady(true));
    return () => { alive = false; };
  }, [ready]);

  const pose = useMemo(() => poseFor(color, texto), [color, texto]);
  const bg = bgUrl(color, pose);
  const svg = useMemo(
    () => (!anon && ready ? cardArtSVG({ color, texto, flavor }) : ""),
    [anon, ready, color, texto, flavor]
  );

  if (anon) {
    return <img className="carta__bg" src={reversoUrl(color)} alt="" draggable="false" />;
  }

  return (
    <>
      {bg && <img className="carta__bg" src={bg} alt="" draggable="false" />}
      {svg && <span className="carta__art" dangerouslySetInnerHTML={{ __html: svg }} />}
    </>
  );
}
