export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
    </div>
  );
}
