import { QrCode, Wifi } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Button, CopyButton } from "./ui";

export function ShareCard({ compact = false }: { compact?: boolean }) {
  const { systemInfo, openModal } = useApp();
  const primary = systemInfo?.primaryUrl || "";
  return (
    <section className={"card share-card" + (compact ? " share-card-compact" : "")}>
      <div className="share-card-head">
        <span className="share-card-icon"><Wifi size={15} /></span>
        <div>
          <h3 className="card-title">Share on your network</h3>
          <p className="card-subtitle">
            {systemInfo?.wifiName ? systemInfo.wifiName : "Same Wi-Fi, any device"}
          </p>
        </div>
        <span className="share-chip-dot" style={{ marginLeft: "auto" }} />
      </div>
      <div className="share-card-body">
        {!compact && systemInfo?.qrDataUrl && (
          <div className="share-card-qr">
            <img src={systemInfo.qrDataUrl} alt="QR code for the Vercio network URL" width={104} height={104} />
          </div>
        )}
        <div className="share-card-info">
          <span className="share-card-label">Network address</span>
          <a
            className="share-card-url mono"
            href={primary || "#"}
            target="_blank"
            rel="noreferrer"
          >
            {primary.replace(/^https?:\/\//, "") || "No LAN address"}
          </a>
          <p className="hint">
            Anyone on this Wi-Fi can open Vercio, switch branches and leave notes.
          </p>
          <div className="share-card-actions">
            {primary && <CopyButton value={primary} label="Copy link" className="btn btn-sm btn-secondary" />}
            <Button size="sm" variant="ghost" icon={<QrCode size={13} />} onClick={() => openModal("share")}>
              Show QR
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
