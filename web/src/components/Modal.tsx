import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  meta?: string;
  body: string;
  onClose: () => void;
};

export function Modal({ open, title, meta, body, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className="modal">
        <header>
          <h3>{title}</h3>
          <button type="button" className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="modal-body">
          {meta ? <div className="muted small">{meta}</div> : null}
          <pre>{body}</pre>
        </div>
      </div>
    </div>
  );
}
