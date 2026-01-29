"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "#111",
          color: "#eee",
        }}
      >
        <div style={{ padding: 20, maxWidth: 600 }}>
          <h2 style={{ color: "#f87171" }}>Something went wrong</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              backgroundColor: "#1e1e1e",
              padding: 16,
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.5,
              overflow: "auto",
            }}
          >
            {error.message}
            {"\n\n"}
            {error.stack}
          </pre>
          {error.digest && <p style={{ fontSize: 12, color: "#888" }}>Digest: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 12,
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
