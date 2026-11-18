import { ArrowLeft } from "lucide-react";
import { Link } from "../lib/router";
import { LogoMark } from "../components/Logo";
import { useT } from "../i18n";

export function NotFound() {
  const t = useT();
  return (
    <div className="container notfound">
      <div className="notfound-mark"><LogoMark className="brand-mark" /></div>
      <span className="badge badge-mono">404</span>
      <h1>{t("notFound.title")}</h1>
      <p>{t("notFound.desc")}</p>
      <Link to="/" className="btn btn-secondary btn-sm" style={{ marginTop: 20 }}>
        <ArrowLeft size={13} /> {t("notFound.back")}
      </Link>
    </div>
  );
}
