import { useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Modal } from "./Modal";

export function BarcodeScanner({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result && !stopped) {
          stopped = true;
          onScan(result.getText());
          onClose();
        }
      })
      .then((c) => {
        controls = c;
      })
      .catch(() => {
        /* camera unavailable */
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open, onScan, onClose]);

  return (
    <Modal open={open} title="Scan barcode" onClose={onClose}>
      <video
        ref={videoRef}
        style={{
          width: "100%",
          borderRadius: "var(--radius-md)",
          background: "#000",
          aspectRatio: "4 / 3",
          objectFit: "cover",
        }}
        muted
        playsInline
      />
      <p className="muted" style={{ fontSize: 12 }}>
        Point the camera at a product barcode. The matching SKU search runs
        automatically.
      </p>
    </Modal>
  );
}
