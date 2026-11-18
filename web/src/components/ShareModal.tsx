import { Laptop, Radio, Wifi } from "lucide-react";
import { useApp } from "../context/AppContext";
import { copyText } from "../lib/format";
import { useToast } from "./Toast";
import { Button, CopyButton, Modal } from "./ui";

export function ShareModal() {
  const { activeModal, closeModal, systemInfo } = useApp();
  const { pushToast } = useToast();
  const open = activeModal === "share";

  const lanUrls = systemInfo?.lanUrls || [];
  const primary = systemInfo?.primaryUrl || "";
  const hasLan = lanUrls.length > 0;

  const copyAll = async () => {
    if (!primary) return;
    await copyText(primary);
    pushToast("Network link copied", "success");
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="Share on your network"
      description="Open Vercio from any device on this Wi-Fi. Branch previews stream live from this machine — nothing is uploaded."
      footer={
        <>
          <span className="hint" style={{ marginRight: "auto" }}>
            <Radio size={11} style={{ display: "inline", marginRight: 5 }} />
            Same Wi-Fi required
          </span>
          <Button variant="secondary" onClick={closeModal}>
            Done
          </Button>
          <Button variant="primary" onClick={copyAll} disabled={!hasLan}>
            Copy network link
          </Button>
        </>
      }
    >
      {!hasLan ? (
        <div className="alert">
          <Wifi size={14} />
          <span>
            No local network address was detected. Connect this machine to Wi-Fi and make sure it is
            reachable from other devices.
          </span>
        </div>
      ) : (
        <div className="share-visual">
          <div className="qr-card">
            {systemInfo?.qrDataUrl ? (
              <img src={systemInfo.qrDataUrl} alt={"QR code for " + primary} width={188} height={188} />
            ) : (
              <div className="skeleton" style={{ width: 188, height: 188 }} />
            )}
          </div>
          <div className="share-details">
            <div className="share-network">
              <span className="share-chip-dot" />
              <span>{systemInfo?.wifiName ? systemInfo.wifiName : "Local network"}</span>
            </div>
            <a className="share-url" href={primary} target="_blank" rel="noreferrer">
              {primary.replace(/^https?:\/\//, "")}
            </a>
            <p className="hint" style={{ maxWidth: 280 }}>
              Scan the QR code or open the address on a phone or a teammate&apos;s laptop.
            </p>
          </div>
        </div>
      )}

      <div className="share-rows">
        {lanUrls.map((entry) => (
          <div className="share-row" key={entry.address}>
            <span className="share-row-label">
              <Wifi size={13} /> {entry.name}
            </span>
            <span className="share-row-value mono">{entry.url}</span>
            <CopyButton value={entry.url} label="" className="btn btn-sm btn-ghost" />
          </div>
        ))}
        {systemInfo && (
          <div className="share-row">
            <span className="share-row-label">
              <Laptop size={13} /> This machine
            </span>
            <span className="share-row-value mono">{systemInfo.localUrl}</span>
            <CopyButton value={systemInfo.localUrl} label="" className="btn btn-sm btn-ghost" />
          </div>
        )}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        Vercio is bound to port {systemInfo?.port ?? "—"} on all interfaces. Previews use their own
        isolated ports and are proxied through stable <span className="mono">/preview/</span> URLs.
      </p>
    </Modal>
  );
}
