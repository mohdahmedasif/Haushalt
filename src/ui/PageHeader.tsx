import type { ReactNode } from "react";

export function PageHeader({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {children && <span className="page-subtitle">{children}</span>}
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </header>
  );
}
