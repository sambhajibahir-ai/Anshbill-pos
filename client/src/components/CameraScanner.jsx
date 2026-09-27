import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Modal } from './ui.jsx';

/**
 * Scans barcodes with the device camera (phones/tablets/webcams).
 * USB / Bluetooth scanners need no special handling: they type into the scan box followed by Enter.
 */
export default function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const lastRef = useRef({ code: '', at: 0 });
  const cbRef = useRef(onDetected);
  cbRef.current = onDetected;

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls;
    let cancelled = false;
    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        // Debounce: ignore the same code seen within 1.5 s
        if (code === lastRef.current.code && now - lastRef.current.at < 1500) return;
        lastRef.current = { code, at: now };
        navigator.vibrate?.(60);
        cbRef.current(code);
      })
      .then((c) => { if (cancelled) c.stop(); else controls = c; })
      .catch((e) => setError(
        e?.name === 'NotAllowedError' ? 'Camera permission was denied.'
          : window.isSecureContext ? `Could not start camera: ${e?.message || e}`
            : 'Camera scanning needs HTTPS or localhost.',
      ));
    return () => { cancelled = true; controls?.stop(); };
  }, []);

  return (
    <Modal title="Scan with camera" onClose={onClose}>
      {error ? <div className="alert error">{error}</div> : (
        <div className="scanner">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-line" />
        </div>
      )}
      <p className="muted small">Point the camera at a barcode. Items are added automatically, and you can keep scanning.</p>
    </Modal>
  );
}
