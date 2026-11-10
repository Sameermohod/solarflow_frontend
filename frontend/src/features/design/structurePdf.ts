import { svgToPngDataUrl } from './exporters';

/** Places the structure drawing sheet (SVG, 420 × 297 mm) on one A3 landscape page. */
export async function exportStructurePdf(svg: string, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const png = await svgToPngDataUrl(svg, 4800);
  doc.addImage(png.dataUrl, 'PNG', 0, 0, 420, 297, undefined, 'FAST');
  doc.save(fileName);
}
