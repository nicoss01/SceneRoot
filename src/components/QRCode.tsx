import qrcode from 'qrcode-generator';

/** Renders a QR code as a themable SVG (no network, no canvas). */
export function QRCode({ value, size = 176 }: { value: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 2;
  const cell = size / (count + margin * 2);
  const rects: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) rects.push(`M${(col + margin) * cell},${(row + margin) * cell}h${cell}v${cell}h${-cell}z`);
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code vers ${value}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" rx={8} />
      <path d={rects.join('')} fill="#04121f" />
    </svg>
  );
}
