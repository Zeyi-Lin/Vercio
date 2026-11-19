import { GitBranch, Laptop, Radio, Wifi } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { copyText } from "../lib/format";
import { useToast } from "./Toast";
import { Button, CopyButton, Modal } from "./ui";

export function ShareModal() {
  const { activeModal, closeModal, systemInfo, shareTarget } = useApp();
  const { pushToast } = useToast();
  const t = useT();
  const open = activeModal === "share";

  const lanUrls = systemInfo?.lanUrls || [];
  const primary = systemInfo?.primaryUrl || "";
  const hasLan = lanUrls.length > 0;
  // A branch share keeps the workspace deep link: whoever opens it lands on the
  // previews tab with this branch already selected. The link is built from the
  // LAN origin so it works from any device on the same Wi-Fi.
  const branchPath = shareTarget
    ? "/p/" + shareTarget.projectId + "/previews?branch=" + encodeURIComponent(shareTarget.branch)
    : "";
  const branchUrl = shareTarget && primary ? primary + branchPath : "";
  const shareValue = shareTarget ? branchUrl : primary;
  const canCopy = hasLan && Boolean(shareValue);

  const copyAll = async () => {
    if (!shareValue) return;
    await copyText(shareValue);
    pushToast(t(shareTarget ? "share.branchCopiedToast" : "share.copiedToast"), "success");
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title={t(shareTarget ? "share.branchTitle" : "share.title")}
      description={
        shareTarget
          ? t("share.branchDescription", { branch: shareTarget.branch })
          : t("share.description")
      }
      footer={
        <>
          <span className="hint" style={{ marginRight: "auto" }}>
            <Radio size={11} style={{ display: "inline", marginRight: 5 }} />
            {t("share.sameWifiRequired")}
          </span>
          <Button variant="secondary" onClick={closeModal}>
            {t("common.done")}
          </Button>
          <Button variant="primary" onClick={copyAll} disabled={!canCopy}>
            {t(shareTarget ? "share.copyBranchLink" : "share.copyNetworkLink")}
          </Button>
        </>
      }
    >
      {!hasLan ? (
        <div className="alert">
          <Wifi size={14} />
          <span>{t("share.noLan")}</span>
        </div>
      ) : shareTarget ? (
        <div className="share-branch">
          <div className="share-branch-head">
            <span className="share-branch-icon">
              <GitBranch size={14} />
            </span>
            <div className="share-branch-meta">
              <span className="share-branch-label">{t("share.branchLinkLabel")}</span>
              <span className="share-branch-name mono">{shareTarget.branch}</span>
            </div>
            <span className="share-chip-dot" style={{ marginLeft: "auto" }} />
          </div>
          <a className="share-url" href={branchUrl} target="_blank" rel="noreferrer">
            {branchUrl.replace(/^https?:\/\//, "")}
          </a>
          <p className="hint">{t("share.branchHint")}</p>
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
        {lanUrls.map((entry) => {
          const url = shareTarget ? entry.url + branchPath : entry.url;
          return (
            <div className="share-row" key={entry.address}>
              <span className="share-row-label">
                <Wifi size={13} /> {entry.name}
              </span>
              <span className="share-row-value mono">{url}</span>
              <CopyButton value={url} label="" className="btn btn-sm btn-ghost" />
            </div>
          );
        })}
        {systemInfo && (
          <div className="share-row">
            <span className="share-row-label">
              <Laptop size={13} /> {t("share.thisMachine")}
            </span>
            <span className="share-row-value mono">
              {shareTarget ? systemInfo.localUrl + branchPath : systemInfo.localUrl}
            </span>
            <CopyButton
              value={shareTarget ? systemInfo.localUrl + branchPath : systemInfo.localUrl}
              label=""
              className="btn btn-sm btn-ghost"
            />
          </div>
        )}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        {t("share.boundHint", { port: systemInfo?.port ?? "—" })}
      </p>
    </Modal>
  );
}
