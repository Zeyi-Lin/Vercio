import { QrCode, Wifi } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { Button, CopyButton } from "./ui";

export function ShareCard({ compact = false }: { compact?: boolean }) {
  const { systemInfo, openModal } = useApp();
  const t = useT();
  const primary = systemInfo?.primaryUrl || "";
  return (
    <section className={"card share-card" + (compact ? " share-card-compact" : "")}>
      <div className="share-card-head">
        <span className="share-card-icon"><Wifi size={15} /></span>
        <div>
          <h3 className="card-title">{t("share.cardTitle")}</h3>
          <p className="card-subtitle">
            {systemInfo?.wifiName ? systemInfo.wifiName : t("share.wifiFallback")}
          </p>
        </div>
        <span className="share-chip-dot" style={{ marginLeft: "auto" }} />
      </div>
      <div className="share-card-body">
        {!compact && systemInfo?.qrDataUrl && (
          <div className="share-card-qr">
            <img src={systemInfo.qrDataUrl} alt={t("share.qrAlt", { url: primary })} width={104} height={104} />
          </div>
        )}
        <div className="share-card-info">
          <span className="share-card-label">{t("share.networkAddress")}</span>
          <a
            className="share-card-url mono"
            href={primary || "#"}
            target="_blank"
            rel="noreferrer"
          >
            {primary.replace(/^https?:\/\//, "") || t("share.noLanAddress")}
          </a>
          <p className="hint">{t("share.cardDesc")}</p>
          <div className="share-card-actions">
            {primary && <CopyButton value={primary} label={t("common.copyLink")} className="btn btn-sm btn-secondary" />}
            <Button size="sm" variant="ghost" icon={<QrCode size={13} />} onClick={() => openModal("share")}>
              {t("common.showQr")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
