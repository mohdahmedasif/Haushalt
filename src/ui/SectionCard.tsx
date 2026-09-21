import type { ReactNode } from "react";

export function SectionCard({
  title,
  extra,
  children,
  padded = true,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="section-card">
      {(title || extra) && (
        <header className="section-card-head">
          {title ? <h2>{title}</h2> : <span />}
          {extra}
        </header>
      )}
      <div className={padded ? "section-card-body" : "section-card-body flush"}>{children}</div>
    </section>
  );
}
