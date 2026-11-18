import { Laptop, Radio, Wifi } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { copyText } from "../lib/format";
import { useToast } from "./Toast";
import { Button, CopyButton, Modal } from "./ui";

export function ShareModal() {
  const { activeModal, closeModal, systemInfo } = useApp();
  const { pushToast } = useToast();
  const t = useT();
  const open = activeModal === "share";

  const lanUrls = systemInfo?.lanUrls || [];
  const primary = systemInfo?.primaryUrl || "";
  const hasLan = lanUrls.length > 0;

  const copyAll = async () => {
    if (!primary) return;
    await copyText(primary);
    pushToast(t("share.copiedToast"), "success");
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title={t("share.title")}
      description={t("share.description")}
      footer={
        <>
          <span className="hint" style={{ marginRight: "auto" }}>
            <Radio size={11} style={{ display: "inline", marginRight: 5 }} />
            {t("share.sameWifiRequired")}
          </span>
          <Button variant="secondary" onClick={closeModal}>
            {t("common.done")}
          </Button>
          <Button variant="primary" onClick={copyAll} disabled={!hasLan}>
            {t("share.copyNetworkLink")}
          </Button>
        </>
      }
    >
      {!hasLan ? (
        <div className="alert">
          <Wifi size={14} />
          <span>{t("share.noLan")}</span>
        </div>
      ) : (
        <div className="share-visual">
          <div className="qr-card">
            {systemInfo?.qrDataUrl ? (
              <img src={systemInfo.qrDataUrl} alt={t("share.qrAlt", { url: primary })} width={188} height={188} />
            ) : (
              <div className="skeleton" style={{ width: 188, height: 188 }} />
            )}
          </div>
          <div className="share-details">
            <div className="share-network">
              <span className="share-chip-dot" />
              <span>{systemInfo?.wifiName ? systemInfo.wifiName : t("share.localNetwork")}</span>
            </div>
            <a className="share-url" href={primary} target="_blank" rel="noreferrer">
              {primary.replace(/^https?:\/\//, "")}
            </a>
            <p className="hint" style={{ maxWidth: 280 }}>
              {t("share.scanHint")}
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
              <Laptop size={13} /> {t("share.thisMachine")}
            </span>
            <span className="share-row-value mono">{systemInfo.localUrl}</span>
            <CopyButton value={systemInfo.localUrl} label="" className="btn btn-sm btn-ghost" />
          </div>
        )}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        {t("share.boundHint", { port: systemInfo?.port ?? "—" })}
      </p>
    </Modal>
  );
}
