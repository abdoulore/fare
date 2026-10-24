// A QR code drawn as SVG rectangles from the qrcode library's module matrix. Generated
// here, from nothing but the URI: no image request, no third party.

import QRCode from 'qrcode';

export function Qr({ text, label }: { text: string; label: string }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const rects = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!qr.modules.get(x, y)) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < n && qr.modules.get(x + w, y)) w++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={w} height={1} />);
      x += w;
    }
  }
  return (
    <svg className="qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      {rects}
    </svg>
  );
}
