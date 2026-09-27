import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { isValidEan13 } from '@shared/gst.js';

export default function Barcode({ value, height = 40, width = 1.6, fontSize = 12 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: isValidEan13(value) ? 'EAN13' : 'CODE128',
        height, width, fontSize, margin: 4, displayValue: true,
      });
    } catch {
      ref.current.innerHTML = '';
    }
  }, [value, height, width, fontSize]);
  return <svg ref={ref} />;
}
