import { ArrowLeft } from "lucide-react";
import { Link } from "../lib/router";
import { LogoMark } from "../components/Logo";

export function NotFound() {
  return (
    <div className="container notfound">
      <div className="notfound-mark"><LogoMark className="brand-mark" /></div>
      <span className="badge badge-mono">404</span>
      <h1>This page doesn&apos;t exist.</h1>
      <p>It may have been removed, or the link might be wrong.</p>
      <Link to="/" className="btn btn-secondary btn-sm" style={{ marginTop: 20 }}>
        <ArrowLeft size={13} /> Back to projects
      </Link>
    </div>
  );
}
